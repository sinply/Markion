pub mod commands;
pub mod file_io;
pub mod image;
pub mod tree_index;
pub mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file_atomic,
            commands::build_tree,
            commands::reorder_in_folder,
            commands::set_collapsed,
            commands::move_node,
            commands::save_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
