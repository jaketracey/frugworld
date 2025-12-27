#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod ai_runtime;
mod commands;
mod config;

use tauri::Manager;

/// Application state shared across commands
pub struct AppState {
    pub config: std::sync::RwLock<config::AppConfig>,
    pub ai_runtime: std::sync::RwLock<Option<ai_runtime::AiRuntime>>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Initialize application state
            let config = config::AppConfig::load().unwrap_or_default();

            app.manage(AppState {
                config: std::sync::RwLock::new(config),
                ai_runtime: std::sync::RwLock::new(None),
            });

            // Get the main window
            let window = app.get_webview_window("main").expect("main window not found");

            // Set window title with version
            let version = app.package_info().version.to_string();
            window.set_title(&format!("Frugworld v{}", version)).ok();

            #[cfg(debug_assertions)]
            {
                // Open devtools in development
                window.open_devtools();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_ai_status,
            commands::get_model_status,
            commands::download_model,
            commands::get_config,
            commands::set_config,
            commands::start_ai_runtime,
            commands::stop_ai_runtime,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
