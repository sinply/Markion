use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    File,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    pub children: Vec<TreeNode>,
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct FolderMeta {
    #[serde(default)]
    pub order: Vec<String>,
    #[serde(default)]
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct IndexFile {
    pub version: u32,
    #[serde(default)]
    pub folders: HashMap<String, FolderMeta>,
}

const INDEX_PATH: &str = ".markion/index.json";
const HIDDEN_DIRS: &[&str] = &[".markion"];

pub fn merge_order(fs_children: &[String], index_order: &[String]) -> Vec<String> {
    let fs_set: HashSet<&String> = fs_children.iter().collect();
    let index_set: HashSet<&String> = index_order.iter().collect();

    let mut result: Vec<String> = index_order
        .iter()
        .filter(|name| fs_set.contains(*name))
        .cloned()
        .collect();

    let mut new_items: Vec<String> = fs_children
        .iter()
        .filter(|name| !index_set.contains(*name))
        .cloned()
        .collect();
    new_items.sort();

    result.extend(new_items);
    result
}

pub fn build_tree(vault_root: &Path, index: &IndexFile) -> TreeNode {
    build_folder(vault_root, "", index)
}

fn build_folder(root: &Path, rel_dir: &str, index: &IndexFile) -> TreeNode {
    let abs_dir = if rel_dir.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel_dir)
    };

    // Collect visible children together with their file type. DirEntry's
    // `file_type()` does NOT follow symlinks, so junction/symlink directory
    // cycles (a common recursion bomb on Windows) are skipped entirely.
    let fs_entries: Vec<(String, std::fs::FileType)> = match std::fs::read_dir(&abs_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let ft = e.file_type().ok()?;
                let name = e.file_name().to_string_lossy().to_string();
                Some((name, ft))
            })
            .filter(|(name, ft)| !HIDDEN_DIRS.contains(&name.as_str()) && !ft.is_symlink())
            .collect(),
        Err(_) => vec![],
    };
    let fs_children: Vec<String> = fs_entries.iter().map(|(n, _)| n.clone()).collect();

    let meta = index.folders.get(rel_dir);
    let order: &[String] = meta.map(|m| m.order.as_slice()).unwrap_or(&[]);
    let display_order = merge_order(&fs_children, order);

    let ft_of: HashMap<&str, std::fs::FileType> =
        fs_entries.iter().map(|(n, ft)| (n.as_str(), *ft)).collect();

    let children: Vec<TreeNode> = display_order
        .iter()
        .map(|name| {
            let child_rel = if rel_dir.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", rel_dir, name)
            };
            match ft_of.get(name.as_str()) {
                Some(ft) if ft.is_dir() => build_folder(root, &child_rel, index),
                _ => TreeNode {
                    name: name.clone(),
                    path: child_rel,
                    kind: NodeKind::File,
                    children: vec![],
                    collapsed: false,
                },
            }
        })
        .collect();

    let name = if rel_dir.is_empty() {
        root.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        rel_dir.rsplit('/').next().unwrap_or(rel_dir).to_string()
    };

    TreeNode {
        name,
        path: rel_dir.to_string(),
        kind: NodeKind::Folder,
        children,
        collapsed: meta.map(|m| m.collapsed).unwrap_or(false),
    }
}

pub fn load_index(vault_root: &Path) -> std::io::Result<IndexFile> {
    let path = vault_root.join(INDEX_PATH);
    match std::fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str::<IndexFile>(&s) {
            Ok(parsed) => Ok(parsed),
            Err(e) => {
                eprintln!(
                    "[tree_index] corrupt index at {:?}: {}; quarantining and falling back to default",
                    path, e
                );
                // Quarantine the unreadable file (best-effort; ignore rename
                // failure) so the next successful save cannot silently destroy
                // whatever data it still held.
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                let quarantine = vault_root.join(format!("{INDEX_PATH}.corrupt-{stamp}"));
                let _ = std::fs::rename(&path, quarantine);
                Ok(IndexFile::default())
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(IndexFile::default()),
        Err(e) => Err(e),
    }
}

pub fn save_index(vault_root: &Path, index: &IndexFile) -> std::io::Result<()> {
    let dir = vault_root.join(".markion");
    std::fs::create_dir_all(&dir)?;
    let path = vault_root.join(INDEX_PATH);
    let json = serde_json::to_string_pretty(index)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    crate::file_io::write_file_atomic(&path, &json)
}

pub fn reorder(index: &mut IndexFile, folder_rel: &str, name: &str, new_index: usize) {
    let meta = index.folders.entry(folder_rel.to_string()).or_default();
    if let Some(pos) = meta.order.iter().position(|n| n == name) {
        let item = meta.order.remove(pos);
        let insert_at = new_index.min(meta.order.len());
        meta.order.insert(insert_at, item);
    } else {
        let insert_at = new_index.min(meta.order.len());
        meta.order.insert(insert_at, name.to_string());
    }
}

pub fn set_collapsed(index: &mut IndexFile, folder_rel: &str, collapsed: bool) {
    let meta = index.folders.entry(folder_rel.to_string()).or_default();
    meta.collapsed = collapsed;
}

pub fn apply_move(
    index: &mut IndexFile,
    from_folder: &str,
    from_name: &str,
    to_folder: &str,
    to_name: &str,
) {
    if let Some(from_meta) = index.folders.get_mut(from_folder) {
        from_meta.order.retain(|n| n != from_name);
    }
    let to_meta = index.folders.entry(to_folder.to_string()).or_default();
    if !to_meta.order.contains(&to_name.to_string()) {
        to_meta.order.push(to_name.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn merge_empty_fs_empty_index() {
        assert_eq!(merge_order(&[], &[]), Vec::<String>::new());
    }

    #[test]
    fn merge_index_empty_returns_fs_sorted() {
        let fs = vec!["b.md".into(), "a.md".into(), "c".into()];
        assert_eq!(
            merge_order(&fs, &[]),
            vec!["a.md".to_string(), "b.md".to_string(), "c".to_string()]
        );
    }

    #[test]
    fn merge_index_matches_fs_uses_index_order() {
        let fs = vec!["a.md".into(), "b.md".into()];
        let idx = vec!["b.md".into(), "a.md".into()];
        assert_eq!(
            merge_order(&fs, &idx),
            vec!["b.md".to_string(), "a.md".to_string()]
        );
    }

    #[test]
    fn merge_drops_index_entries_missing_from_fs() {
        let fs = vec!["a.md".into()];
        let idx = vec!["deleted.md".into(), "a.md".into()];
        assert_eq!(merge_order(&fs, &idx), vec!["a.md".to_string()]);
    }

    #[test]
    fn merge_appends_new_fs_items_sorted_after_indexed() {
        let fs = vec![
            "old.md".into(),
            "z.md".into(),
            "new2.md".into(),
            "new1.md".into(),
        ];
        let idx = vec!["old.md".into(), "z.md".into()];
        assert_eq!(
            merge_order(&fs, &idx),
            vec![
                "old.md".to_string(),
                "z.md".to_string(),
                "new1.md".to_string(),
                "new2.md".to_string()
            ]
        );
    }

    fn write_vault(root: &Path, layout: &[(&str, &str)]) {
        for (rel, content) in layout {
            let p = root.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, content).unwrap();
        }
    }

    #[test]
    fn build_tree_empty_vault() {
        let dir = tempdir().unwrap();
        let tree = build_tree(dir.path(), &IndexFile::default());
        assert_eq!(tree.kind, NodeKind::Folder);
        assert!(tree.children.is_empty());
    }

    #[test]
    fn build_tree_uses_index_order() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[("a.md", ""), ("b.md", ""), ("notes/c.md", "")],
        );
        let mut index = IndexFile::default();
        index.folders.insert(
            "".to_string(),
            FolderMeta {
                order: vec!["b.md".into(), "notes".into(), "a.md".into()],
                collapsed: false,
            },
        );
        let tree = build_tree(dir.path(), &index);
        let names: Vec<&str> = tree.children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["b.md", "notes", "a.md"]);
    }

    #[test]
    fn build_tree_hides_markion_dir() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", ""), (".markion/index.json", "{}")]);
        let tree = build_tree(dir.path(), &IndexFile::default());
        let names: Vec<&str> = tree.children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["a.md"]);
    }

    #[test]
    fn save_then_load_index_roundtrip() {
        let dir = tempdir().unwrap();
        let mut index = IndexFile::default();
        index.version = 1;
        index.folders.insert(
            "".to_string(),
            FolderMeta {
                order: vec!["b.md".into(), "a.md".into()],
                collapsed: true,
            },
        );
        save_index(dir.path(), &index).unwrap();
        let loaded = load_index(dir.path()).unwrap();
        assert_eq!(loaded, index);
    }

    #[test]
    fn load_index_missing_returns_default() {
        let dir = tempdir().unwrap();
        let loaded = load_index(dir.path()).unwrap();
        assert_eq!(loaded, IndexFile::default());
    }

    #[test]
    fn load_index_corrupt_returns_default() {
        let dir = tempdir().unwrap();
        let idx_path = dir.path().join(".markion/index.json");
        fs::create_dir_all(idx_path.parent().unwrap()).unwrap();
        fs::write(&idx_path, "not valid json {{{").unwrap();
        let loaded = load_index(dir.path()).unwrap();
        assert_eq!(loaded, IndexFile::default());
    }

    #[test]
    fn load_index_corrupt_file_is_quarantined() {
        let dir = tempdir().unwrap();
        let idx_path = dir.path().join(".markion/index.json");
        fs::create_dir_all(idx_path.parent().unwrap()).unwrap();
        fs::write(&idx_path, "not valid json {{{").unwrap();
        load_index(dir.path()).unwrap();
        // The corrupt file is renamed away, not deleted or overwritten.
        assert!(!idx_path.exists(), "corrupt index.json still in place");
        let quarantined: Vec<String> = fs::read_dir(idx_path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with("index.json.corrupt-"))
            .collect();
        assert_eq!(quarantined.len(), 1, "quarantine files: {:?}", quarantined);
    }

    #[cfg(windows)]
    #[test]
    fn build_tree_skips_symlinked_dirs() {
        let dir = tempdir().unwrap();
        let real = dir.path().join("real");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("note.md"), "").unwrap();
        // Creating symlinks on Windows requires admin/dev-mode privileges;
        // skip gracefully when unavailable.
        if std::os::windows::fs::symlink_dir(&real, dir.path().join("link")).is_err() {
            eprintln!("skipped: symlink_dir needs elevated privilege or dev mode");
            return;
        }
        let tree = build_tree(dir.path(), &IndexFile::default());
        let names: Vec<&str> = tree.children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["real"],
            "symlinked dir must be skipped entirely"
        );
    }

    #[cfg(unix)]
    #[test]
    fn build_tree_skips_symlinked_dirs() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let real = dir.path().join("real");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("note.md"), "").unwrap();
        symlink(&real, dir.path().join("link")).unwrap();
        let tree = build_tree(dir.path(), &IndexFile::default());
        let names: Vec<&str> = tree.children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["real"],
            "symlinked dir must be skipped entirely"
        );
    }

    #[test]
    fn reorder_within_folder_updates_index_order() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", ""), ("b.md", ""), ("c.md", "")]);
        let mut index = IndexFile::default();
        index.folders.insert(
            "".to_string(),
            FolderMeta {
                order: vec!["a.md".into(), "b.md".into(), "c.md".into()],
                collapsed: false,
            },
        );
        reorder(&mut index, "", "c.md", 0);
        assert_eq!(
            index.folders.get("").unwrap().order,
            vec!["c.md".to_string(), "a.md".to_string(), "b.md".to_string()]
        );
    }

    #[test]
    fn set_collapsed_persists() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("notes/a.md", "")]);
        let mut index = IndexFile::default();
        index
            .folders
            .insert("notes".to_string(), FolderMeta::default());
        set_collapsed(&mut index, "notes", true);
        assert!(index.folders.get("notes").unwrap().collapsed);
        set_collapsed(&mut index, "notes", false);
        assert!(!index.folders.get("notes").unwrap().collapsed);
    }
}
