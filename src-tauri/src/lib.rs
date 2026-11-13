#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Native Open/Save dialogs; files the user picks there become readable/writable.
    .plugin(tauri_plugin_dialog::init())
    // File access, scoped in capabilities/default.json to the app's own data folder
    // (recovery copies) plus whatever the user picks in a dialog.
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
