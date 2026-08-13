pub mod backlinks;
pub mod commands;
pub mod config;
pub mod file_io;
pub mod image;
pub mod link_index;
pub mod tree_index;
pub mod watcher;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(None::<notify::RecommendedWatcher>))
        .manage(Mutex::new(None::<link_index::LinkIndex>))
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file_atomic,
            commands::build_tree,
            commands::reorder_in_folder,
            commands::set_collapsed,
            commands::move_node,
            commands::save_image,
            commands::create_file,
            commands::find_backlinks,
            commands::scan_graph,
            commands::read_config,
            commands::save_config,
            commands::start_vault_watch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
