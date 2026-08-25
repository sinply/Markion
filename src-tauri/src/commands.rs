use crate::backlinks::{self, Backlink, GraphEdge, GraphNode};
use crate::docdb;
use crate::file_io;
use crate::image::{self, AssetsStrategy, PathStyle};
use crate::link_index::LinkIndex;
use crate::tree_index::{self, TreeNode};
use std::path::{Path, PathBuf};

/// Best-effort projection refresh after an in-app write (only `.md` files are
/// indexed). Failures are logged and ignored — the cache is rebuildable.
fn project_upsert(vault_root: &str, path: &str) {
    if path.to_lowercase().ends_with(".md") {
        if let Err(e) = docdb::update_one(Path::new(vault_root), path) {
            eprintln!("[docdb] update {path} failed: {e}");
        }
    }
}

/// Best-effort projection removal after an in-app delete/trash.
fn project_remove(vault_root: &str, path: &str) {
    if let Err(e) = docdb::remove_path(Path::new(vault_root), path) {
        eprintln!("[docdb] remove {path} failed: {e}");
    }
}

/// Managed state: the incremental link index for the current vault (None until
/// first use / watcher start).
pub type LinkIndexState = std::sync::Mutex<Option<LinkIndex>>;

/// Rebuild the index for `vault_root` if it is missing or belongs to another
/// vault. Returns the locked guard.
fn ensure_index<'a>(
    state: &'a LinkIndexState,
    vault_root: &str,
) -> Result<std::sync::MutexGuard<'a, Option<LinkIndex>>, String> {
    let mut guard = state.lock().unwrap();
    let needs_build = guard
        .as_ref()
        .map(|i| i.vault_root != Path::new(vault_root))
        .unwrap_or(true);
    if needs_build {
        *guard = Some(LinkIndex::build(Path::new(vault_root)).unwrap_or_else(|e| {
            eprintln!("[link_index] full build failed: {e}; queries fall back to on-demand scans");
            LinkIndex::empty(Path::new(vault_root).to_path_buf())
        }));
    }
    Ok(guard)
}

#[tauri::command]
pub fn read_file(vault_root: String, path: String) -> Result<String, String> {
    file_io::read_file(&Path::new(&vault_root).join(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file_atomic(vault_root: String, path: String, content: String) -> Result<(), String> {
    file_io::write_file_atomic(&Path::new(&vault_root).join(&path), &content)
        .map_err(|e| e.to_string())?;
    // Write-through projection refresh (md files only; best-effort).
    project_upsert(&vault_root, &path);
    Ok(())
}

#[tauri::command]
pub fn build_tree(vault_root: String) -> Result<TreeNode, String> {
    let index = tree_index::load_index(Path::new(&vault_root)).map_err(|e| e.to_string())?;
    Ok(tree_index::build_tree(Path::new(&vault_root), &index))
}

#[tauri::command]
pub fn reorder_in_folder(
    vault_root: String,
    folder_rel: String,
    name: String,
    new_index: usize,
) -> Result<(), String> {
    let mut index = tree_index::load_index(Path::new(&vault_root)).map_err(|e| e.to_string())?;
    tree_index::reorder(&mut index, &folder_rel, &name, new_index);
    tree_index::save_index(Path::new(&vault_root), &index).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_collapsed(
    vault_root: String,
    folder_rel: String,
    collapsed: bool,
) -> Result<(), String> {
    let mut index = tree_index::load_index(Path::new(&vault_root)).map_err(|e| e.to_string())?;
    tree_index::set_collapsed(&mut index, &folder_rel, collapsed);
    tree_index::save_index(Path::new(&vault_root), &index).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_node(
    vault_root: String,
    from_folder: String,
    from_name: String,
    to_folder: String,
    to_name: String,
) -> Result<(), String> {
    let root = Path::new(&vault_root);
    let from_path = root.join(&from_folder).join(&from_name);
    let to_path = root.join(&to_folder).join(&to_name);
    if let Some(parent) = to_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&from_path, &to_path).map_err(|e| e.to_string())?;
    let mut index = tree_index::load_index(root).map_err(|e| e.to_string())?;
    tree_index::apply_move(&mut index, &from_folder, &from_name, &to_folder, &to_name);
    tree_index::save_index(root, &index).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_image(
    vault_root: String,
    bytes: Vec<u8>,
    ext: String,
    doc_rel: String,
    strategy: String,
    path_style: String,
    date: String,
) -> Result<String, String> {
    let strategy = match strategy.as_str() {
        "vault-assets" => AssetsStrategy::VaultAssets,
        "doc-assets" => AssetsStrategy::DocAssets,
        s if s.starts_with("custom:") => AssetsStrategy::Custom(PathBuf::from(&s[7..])),
        _ => AssetsStrategy::VaultAssets,
    };
    let style = if path_style == "absolute" {
        PathStyle::Absolute
    } else {
        PathStyle::Relative
    };
    image::save_image(
        &bytes,
        &ext,
        Path::new(&vault_root),
        Path::new(&doc_rel),
        &strategy,
        style,
        &date,
    )
    .map_err(|e| e.to_string())
}

use crate::config;

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn create_file_makes_dirs_and_empty_file() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        create_file(root.clone(), "notes/new.md".to_string()).unwrap();
        let p = dir.path().join("notes/new.md");
        assert!(p.exists());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "");
    }

    #[test]
    fn create_file_does_not_overwrite() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        std::fs::write(dir.path().join("existing.md"), "keep me").unwrap();
        create_file(root.clone(), "existing.md".to_string()).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join("existing.md")).unwrap(),
            "keep me"
        );
    }

    #[test]
    fn create_folder_makes_nested_dirs_and_is_idempotent() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        create_folder(root.clone(), "books/chapter-1".to_string()).unwrap();
        assert!(dir.path().join("books/chapter-1").is_dir());
        // Creating again succeeds (no "already exists" error).
        create_folder(root, "books/chapter-1".to_string()).unwrap();
        assert!(dir.path().join("books/chapter-1").is_dir());
    }

    #[test]
    fn delete_path_missing_path_is_error() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let err = delete_path(root, "nope.md".to_string()).unwrap_err();
        assert!(err.contains("does not exist"), "unexpected error: {err}");
    }

    #[test]
    fn delete_path_file_moves_to_trash() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        std::fs::write(dir.path().join("gone.md"), "bye").unwrap();
        // Environments without a trash service (headless CI) cannot run this;
        // skip rather than fail - the Windows/macOS desktop paths are the target.
        match delete_path(root, "gone.md".to_string()) {
            Ok(()) => assert!(!dir.path().join("gone.md").exists()),
            Err(e) => eprintln!("skipped (no trash service): {e}"),
        }
    }

    #[test]
    fn delete_path_folder_moves_to_trash() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        std::fs::create_dir_all(dir.path().join("folder")).unwrap();
        std::fs::write(dir.path().join("folder/inner.md"), "x").unwrap();
        match delete_path(root, "folder".to_string()) {
            Ok(()) => assert!(!dir.path().join("folder").exists()),
            Err(e) => eprintln!("skipped (no trash service): {e}"),
        }
    }

    #[test]
    fn trash_path_moves_into_vault_trash() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        std::fs::write(dir.path().join("gone.md"), "bye").unwrap();
        trash_path(root.clone(), "gone.md".to_string()).unwrap();
        assert!(!dir.path().join("gone.md").exists());
        assert!(dir.path().join(".markion/trash/gone.md").exists());
    }

    #[test]
    fn trash_path_clash_appends_suffix() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        std::fs::write(dir.path().join("a.md"), "1").unwrap();
        trash_path(root.clone(), "a.md".to_string()).unwrap();
        // Trash the same relative path again -> clash with the first copy.
        std::fs::write(dir.path().join("a.md"), "2").unwrap();
        trash_path(root.clone(), "a.md".to_string()).unwrap();
        let trashed: Vec<_> = list_trash(root.clone())
            .unwrap()
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert!(trashed.contains(&"a.md".to_string()));
        assert!(trashed.iter().any(|p| p.contains("a (trashed")));
    }

    #[test]
    fn list_trash_returns_nothing_when_empty() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        assert!(list_trash(root).unwrap().is_empty());
    }

    #[test]
    fn restore_trash_moves_back_to_original_path() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        std::fs::write(dir.path().join("gone.md"), "bye").unwrap();
        trash_path(root.clone(), "gone.md".to_string()).unwrap();
        restore_trash(root.clone(), "gone.md".to_string()).unwrap();
        assert!(dir.path().join("gone.md").exists());
        assert_eq!(std::fs::read_to_string(dir.path().join("gone.md")).unwrap(), "bye");
        assert!(!dir.path().join(".markion/trash/gone.md").exists());
    }

    #[test]
    fn restore_trash_fails_when_destination_occupied() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        std::fs::write(dir.path().join("gone.md"), "bye").unwrap();
        trash_path(root.clone(), "gone.md".to_string()).unwrap();
        std::fs::write(dir.path().join("gone.md"), "new").unwrap();
        let err = restore_trash(root.clone(), "gone.md".to_string()).unwrap_err();
        assert!(err.contains("already exists"), "unexpected error: {err}");
    }

    #[test]
    fn write_file_base64_roundtrip() {
        use base64::Engine as _;
        let dir = tempdir().unwrap();
        let path = dir.path().join("out.png").to_string_lossy().to_string();
        let bytes = vec![0x89u8, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        write_file_base64(path.clone(), b64).unwrap();
        assert_eq!(std::fs::read(dir.path().join("out.png")).unwrap(), bytes);
    }

    #[test]
    fn write_file_base64_rejects_invalid_base64() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("out.png").to_string_lossy().to_string();
        assert!(write_file_base64(path, "!!!not-base64!!!".to_string()).is_err());
    }
}

#[tauri::command]
pub fn find_backlinks(
    vault_root: String,
    target: String,
    index: tauri::State<'_, LinkIndexState>,
) -> Result<Vec<Backlink>, String> {
    let guard = ensure_index(index.inner(), &vault_root)?;
    let idx = guard.as_ref().unwrap();
    if idx.is_empty() {
        // Index empty (e.g. initial build failed) — fall back to a full scan.
        return backlinks::find_backlinks(Path::new(&vault_root), &target)
            .map_err(|e| e.to_string());
    }
    Ok(idx.backlinks(&target))
}

#[tauri::command]
pub fn scan_graph(
    vault_root: String,
    index: tauri::State<'_, LinkIndexState>,
) -> Result<(Vec<GraphNode>, Vec<GraphEdge>), String> {
    let guard = ensure_index(index.inner(), &vault_root)?;
    let idx = guard.as_ref().unwrap();
    if idx.is_empty() {
        // Index empty (e.g. initial build failed) — fall back to a full scan.
        return backlinks::scan_graph(Path::new(&vault_root)).map_err(|e| e.to_string());
    }
    Ok(idx.graph())
}

/// Full-text search across all `.md` files in the vault. `case_sensitive`,
/// `use_regex`, and `max_hits` are optional; an invalid regex pattern returns
/// an error surfaced to the frontend.
#[tauri::command]
pub fn search_vault(
    vault_root: String,
    query: String,
    case_sensitive: Option<bool>,
    use_regex: Option<bool>,
    max_hits: Option<usize>,
) -> Result<Vec<crate::search::SearchHit>, String> {
    crate::search::search_vault(
        Path::new(&vault_root),
        &query,
        case_sensitive.unwrap_or(false),
        use_regex.unwrap_or(false),
        max_hits.unwrap_or(crate::search::DEFAULT_MAX_HITS),
    )
    .map_err(|e| e.to_string())
}

/// Replace `query` with `replacement` across all `.md` files in the vault.
/// Returns how many files changed and how many replacements were made.
#[tauri::command]
pub fn replace_in_vault(
    vault_root: String,
    query: String,
    replacement: String,
    case_sensitive: Option<bool>,
    use_regex: Option<bool>,
) -> Result<crate::search::ReplaceResult, String> {
    crate::search::replace_in_vault(
        Path::new(&vault_root),
        &query,
        &replacement,
        case_sensitive.unwrap_or(false),
        use_regex.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

/// Scan the vault for `#tag` occurrences (skipping fenced code, inline code,
/// and wiki links). Returns one entry per (tag, file) pair.
#[tauri::command]
pub fn scan_tags(vault_root: String) -> Result<Vec<crate::tags::TagEntry>, String> {
    crate::tags::scan_tags(Path::new(&vault_root)).map_err(|e| e.to_string())
}

/// Create an empty markdown file at `path` (relative to vault root). Parent
/// directories are created as needed. Never overwrites an existing file.
#[tauri::command]
pub fn create_file(vault_root: String, path: String) -> Result<(), String> {
    let full = Path::new(&vault_root).join(&path);
    if full.exists() {
        return Ok(()); // already there — treat as success
    }
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(full, "").map_err(|e| e.to_string())?;
    project_upsert(&vault_root, &path);
    Ok(())
}

/// Create a folder at `path` (relative to vault root). Idempotent: creating
/// an existing folder succeeds, mirroring `create_file` semantics.
#[tauri::command]
pub fn create_folder(vault_root: String, path: String) -> Result<(), String> {
    let full = Path::new(&vault_root).join(&path);
    std::fs::create_dir_all(full).map_err(|e| e.to_string())
}

/// Move a file or folder (relative to vault root) to the OS trash/recycle
/// bin. Never hard-deletes: on failure the on-disk data is untouched.
#[tauri::command]
pub fn delete_path(vault_root: String, path: String) -> Result<(), String> {
    let full = Path::new(&vault_root).join(&path);
    if !full.exists() {
        return Err(format!("path does not exist: {}", path));
    }
    trash::delete(&full).map_err(|e| e.to_string())?;
    project_remove(&vault_root, &path);
    Ok(())
}

/// The vault-internal trash directory: `<root>/.markion/trash`.
fn trash_dir(root: &Path) -> PathBuf {
    root.join(".markion").join("trash")
}

/// Move a file or folder into the vault-internal trash (`.markion/trash/...`),
/// preserving its relative path so it can be restored. On a name clash inside
/// the trash a numeric suffix is appended.
#[tauri::command]
pub fn trash_path(vault_root: String, path: String) -> Result<(), String> {
    let root = Path::new(&vault_root);
    let full = root.join(&path);
    if !full.exists() {
        return Err(format!("path does not exist: {}", path));
    }
    let dest = trash_dir(root).join(&path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if dest.exists() {
        let stem = dest
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "item".into());
        let ext = dest
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        for i in 1.. {
            let cand = dest.with_file_name(format!("{stem} (trashed {i}){ext}"));
            if !cand.exists() {
                std::fs::rename(&full, &cand).map_err(|e| e.to_string())?;
                project_remove(&vault_root, &path);
                return Ok(());
            }
        }
    }
    std::fs::rename(&full, &dest).map_err(|e| e.to_string())?;
    project_remove(&vault_root, &path);
    Ok(())
}

/// One entry in the vault-internal trash.
#[derive(serde::Serialize)]
pub struct TrashEntry {
    /// Path relative to the trash dir (== original vault-relative path,
    /// possibly suffixed on clash).
    pub path: String,
    pub name: String,
    pub kind: String,
    /// Last-modified unix seconds, newest first in list_trash.
    pub modified: u64,
}

/// List the vault-internal trash, newest first.
#[tauri::command]
pub fn list_trash(vault_root: String) -> Result<Vec<TrashEntry>, String> {
    let root = Path::new(&vault_root);
    let dir = trash_dir(root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in walkdir::WalkDir::new(&dir)
        .min_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let abs = entry.path();
        let rel = abs
            .strip_prefix(&dir)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let modified = abs
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        entries.push(TrashEntry {
            name: abs
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: rel,
            kind: if abs.is_dir() { "folder".into() } else { "file".into() },
            modified,
        });
    }
    entries.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(entries)
}

/// Restore an entry from the vault-internal trash back to its original
/// vault-relative location (the `path` returned by list_trash). Fails if the
/// destination is already occupied.
#[tauri::command]
pub fn restore_trash(vault_root: String, rel_path: String) -> Result<(), String> {
    let root = Path::new(&vault_root);
    let src = trash_dir(root).join(&rel_path);
    if !src.exists() {
        return Err(format!("not in trash: {}", rel_path));
    }
    let dest = root.join(&rel_path);
    if dest.exists() {
        return Err(format!("destination already exists: {}", rel_path));
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&src, &dest).map_err(|e| e.to_string())
}

/// Rename/move a file or folder and rewrite every `[[oldstem]]` reference in
/// the vault to the new name. Returns the number of files rewritten.
#[tauri::command]
pub fn rename_with_links(
    vault_root: String,
    old_path: String,
    new_path: String,
    index: tauri::State<'_, LinkIndexState>,
) -> Result<usize, String> {
    let mut guard = ensure_index(index.inner(), &vault_root)?;
    let idx = guard.as_mut().unwrap();
    if idx.is_empty() {
        // Index unavailable (build failed earlier) — rebuild once so the
        // referrer lookup is still O(referrers) instead of a full scan.
        *idx = LinkIndex::build(Path::new(&vault_root)).map_err(|e| e.to_string())?;
    }
    let count = idx
        .rename_with_links(Path::new(&vault_root), &old_path, &new_path)
        .map_err(|e| e.to_string())?;
    // Projection sync: drop the old path (prefix-aware for folders), then
    // re-index the new location — walking the subtree when a folder moved.
    project_remove(&vault_root, &old_path);
    let new_abs = Path::new(&vault_root).join(&new_path);
    if new_abs.is_dir() {
        let prefix = format!("{}/", new_path);
        for f in docdb::walk_md(Path::new(&vault_root)) {
            if f == new_path || f.starts_with(&prefix) {
                project_upsert(&vault_root, &f);
            }
        }
    } else {
        project_upsert(&vault_root, &new_path);
    }
    Ok(count)
}

/// Write `content` to an arbitrary absolute path (used by export). Parent
/// directories are created as needed. The path comes from the frontend's
/// save dialog, so no vault-relative handling is applied.
#[tauri::command]
pub fn export_file(path: String, content: String) -> Result<(), String> {
    let full = Path::new(&path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    file_io::write_file_atomic(full, &content).map_err(|e| e.to_string())
}

/// Size in bytes of a vault-relative file (for the large-file open warning).
#[tauri::command]
pub fn file_size(vault_root: String, path: String) -> Result<u64, String> {
    let full = Path::new(&vault_root).join(&path);
    std::fs::metadata(&full)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

/// Read a file from an absolute path and return its base64 contents (used to
/// inline local images into exported HTML).
#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    use base64::Engine as _;
    let bytes = std::fs::read(Path::new(&path)).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Write base64-encoded binary content to an absolute path (used by PDF/image
/// export, which produce binary buffers).
#[tauri::command]
pub fn write_file_base64(path: String, base64_data: String) -> Result<(), String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| e.to_string())?;
    let full = Path::new(&path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(full, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_config(vault_root: String) -> Result<config::Settings, String> {
    config::load_config(Path::new(&vault_root)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_config(vault_root: String, settings: config::Settings) -> Result<(), String> {
    config::save_config(Path::new(&vault_root), &settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_vault_watch(
    vault_root: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Mutex<Option<notify::RecommendedWatcher>>>,
) -> Result<(), String> {
    use tauri::Emitter;
    use tauri::Manager;
    let root = std::path::PathBuf::from(&vault_root);
    let (watcher, rx) = crate::watcher::start_watcher(&root, std::time::Duration::from_millis(200))
        .map_err(|e| e.to_string())?;
    // Replace any previous watcher (dropping the old one stops its watch).
    *state.lock().unwrap() = Some(watcher);
    let app_handle = app.clone();
    std::thread::spawn(move || {
        // rx.recv blocks until the watcher is dropped (app exit) or events arrive.
        while let Ok(paths) = rx.recv() {
            if paths.is_empty() {
                continue;
            }
            // Incrementally sync the link index with watcher events, so
            // backlinks/graph queries never re-scan the whole vault.
            {
                let index_state = app_handle.state::<LinkIndexState>();
                let mut guard = index_state.lock().unwrap();
                match guard.as_mut() {
                    Some(idx) if idx.vault_root == root => idx.update(&root, &paths),
                    _ => {
                        *guard = Some(LinkIndex::build(&root).unwrap_or_else(|e| {
                            eprintln!("[link_index] watcher build failed: {e}");
                            LinkIndex::empty(root.clone())
                        }));
                    }
                }
            }
            // Sync the document projection with external (or missed) changes.
            for p in &paths {
                let abs = root.join(p);
                if !p.to_lowercase().ends_with(".md") {
                    // Folder-level event (create/delete/move): drop the subtree
                    // from the projection; per-file events fill creations in.
                    let _ = docdb::remove_path(&root, p);
                } else if abs.exists() {
                    let _ = docdb::update_one(&root, p);
                } else {
                    let _ = docdb::remove_path(&root, p);
                }
            }
            let _ = app_handle.emit("vault-changed", paths);
        }
    });
    Ok(())
}

/// Library home data: document cards (newest first), optionally scoped to a
/// folder. Served from the SQLite projection, which self-heals when stale.
/// A cold start (first open) rebuilds the projection; progress is streamed to
/// the frontend as `index-progress` events for the loading bar.
#[tauri::command]
pub fn query_library(
    app: tauri::AppHandle,
    vault_root: String,
    folder: Option<String>,
) -> Result<Vec<docdb::LibraryEntry>, String> {
    use tauri::Emitter;
    let root = Path::new(&vault_root);
    docdb::ensure_ready_with_progress(root, Some(&|done, total| {
        let _ = app.emit("index-progress", serde_json::json!({ "done": done, "total": total }));
    }))?;
    let _ = app.emit("index-progress", serde_json::json!({ "done": -1, "total": -1 }));
    docdb::query_library_ready(root, folder.as_deref())
}

/// Folder table view: direct `.md` children as rows, frontmatter keys as
/// auto-inferred columns (read from disk so brand-new notes appear at once).
#[tauri::command]
pub fn query_folder_table(vault_root: String, folder: String) -> Result<docdb::FolderTable, String> {
    docdb::query_folder_table(Path::new(&vault_root), &folder)
}

/// Dataview ```table queries: recursive .md walk under a folder with
/// mtime/size plus frontmatter pairs per row.
#[tauri::command]
pub fn query_dataview_rows(vault_root: String, folder: String) -> Result<Vec<docdb::DataviewRow>, String> {
    docdb::query_dataview_rows(Path::new(&vault_root), &folder)
}
