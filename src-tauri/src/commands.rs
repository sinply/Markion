use crate::backlinks::{self, Backlink};
use crate::file_io;
use crate::image::{self, AssetsStrategy, PathStyle};
use crate::tree_index::{self, TreeNode};
use std::path::{Path, PathBuf};

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
    let index =
        tree_index::load_index(Path::new(&vault_root)).map_err(|e| e.to_string())?;
    Ok(tree_index::build_tree(Path::new(&vault_root), &index))
}

#[tauri::command]
pub fn reorder_in_folder(
    vault_root: String,
    folder_rel: String,
    name: String,
    new_index: usize,
) -> Result<(), String> {
    let mut index =
        tree_index::load_index(Path::new(&vault_root)).map_err(|e| e.to_string())?;
    tree_index::reorder(&mut index, &folder_rel, &name, new_index);
    tree_index::save_index(Path::new(&vault_root), &index).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_collapsed(
    vault_root: String,
    folder_rel: String,
    collapsed: bool,
) -> Result<(), String> {
    let mut index =
        tree_index::load_index(Path::new(&vault_root)).map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn find_backlinks(vault_root: String, target: String) -> Result<Vec<Backlink>, String> {
    backlinks::find_backlinks(Path::new(&vault_root), &target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_config(vault_root: String) -> Result<config::Settings, String> {
    config::load_config(&std::path::Path::new(&vault_root)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_config(vault_root: String, settings: config::Settings) -> Result<(), String> {
    config::save_config(&std::path::Path::new(&vault_root), &settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_vault_watch(
    vault_root: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Mutex<Option<notify::RecommendedWatcher>>>,
) -> Result<(), String> {
    use tauri::Emitter;
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
            let _ = app_handle.emit("vault-changed", paths);
        }
    });
    Ok(())
}
