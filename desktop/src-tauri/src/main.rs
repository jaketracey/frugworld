#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
#![warn(clippy::all, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

mod ai_runtime;
mod commands;
mod config;
mod error;

use config::AppConfig;
use tauri::Manager;
use tokio::sync::RwLock;

/// Application state shared across Tauri commands.
pub struct AppState {
    /// Application configuration.
    pub config: RwLock<AppConfig>,
    /// AI runtime manager (None if not started).
    pub ai_runtime: RwLock<Option<ai_runtime::AiRuntime>>,
}

fn main() {
    // Initialize the Tokio runtime for async operations
    let runtime = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");

    // Load configuration synchronously at startup
    let config = runtime.block_on(async { config::load_config().await.unwrap_or_default() });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            config: RwLock::new(config),
            ai_runtime: RwLock::new(None),
        })
        .setup(|app| {
            // Get the main window
            if let Some(window) = app.get_webview_window("main") {
                // Set window title with version
                let version = app.package_info().version.to_string();
                let _ = window.set_title(&format!("Frugworld v{version}"));

                #[cfg(debug_assertions)]
                {
                    // Open devtools in development
                    window.open_devtools();
                }
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
            commands::start_ai,
            commands::stop_ai,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
