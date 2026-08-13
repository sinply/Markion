use crate::backlinks::{self, Backlink, GraphEdge, GraphNode};
use crate::file_io;
use crate::image::{self, AssetsStrategy, PathStyle};
use crate::link_index::LinkIndex;
use crate::tree_index::{self, TreeNode};
use std::path::{Path, PathBuf};

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
        .map_err(|e| e.to_string())
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
    std::fs::write(full, "").map_err(|e| e.to_string())
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
            let _ = app_handle.emit("vault-changed", paths);
        }
    });
    Ok(())
}
