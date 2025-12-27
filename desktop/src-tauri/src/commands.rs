//! Tauri IPC command handlers for the Frugworld desktop app.

use crate::config::AppConfig;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

/// Status of the AI runtime
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiStatus {
    pub running: bool,
    pub ready: bool,
    pub error: Option<String>,
}

/// Status of downloaded models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStatus {
    pub llm_installed: bool,
    pub llm_model: Option<String>,
    pub tts_installed: bool,
    pub tts_model: Option<String>,
}

/// Model download progress
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub model_name: String,
    pub progress: f32,
    pub status: String,
}

/// Check if the AI runtime is running and ready
#[tauri::command]
pub async fn get_ai_status(state: State<'_, AppState>) -> Result<AiStatus, String> {
    let runtime = state.ai_runtime.read().map_err(|e| e.to_string())?;

    match runtime.as_ref() {
        Some(rt) => Ok(AiStatus {
            running: rt.is_running(),
            ready: rt.is_ready(),
            error: rt.last_error().map(|s| s.to_string()),
        }),
        None => Ok(AiStatus {
            running: false,
            ready: false,
            error: None,
        }),
    }
}

/// Check which models are installed
#[tauri::command]
pub async fn get_model_status(state: State<'_, AppState>) -> Result<ModelStatus, String> {
    let config = state.config.read().map_err(|e| e.to_string())?;

    // TODO: Actually check if models exist at configured paths
    Ok(ModelStatus {
        llm_installed: config.llm_model.is_some(),
        llm_model: config.llm_model.clone(),
        tts_installed: config.tts_model.is_some(),
        tts_model: config.tts_model.clone(),
    })
}

/// Download a model by name
#[tauri::command]
pub async fn download_model(
    model_name: String,
    model_type: String,
    _state: State<'_, AppState>,
) -> Result<DownloadProgress, String> {
    // TODO: Implement actual model download
    // This would:
    // 1. Check if Ollama is installed
    // 2. Pull the model using Ollama CLI
    // 3. Or download GGUF directly for llama.cpp

    Ok(DownloadProgress {
        model_name,
        progress: 0.0,
        status: format!("Starting download of {} model...", model_type),
    })
}

/// Get the current application configuration
#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let config = state.config.read().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

/// Update the application configuration
#[tauri::command]
pub async fn set_config(new_config: AppConfig, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.write().map_err(|e| e.to_string())?;
    *config = new_config.clone();
    new_config.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Start the AI runtime
#[tauri::command]
pub async fn start_ai_runtime(state: State<'_, AppState>) -> Result<(), String> {
    let config = state.config.read().map_err(|e| e.to_string())?;
    let mut runtime_lock = state.ai_runtime.write().map_err(|e| e.to_string())?;

    if runtime_lock.is_some() {
        return Err("AI runtime is already running".to_string());
    }

    let runtime = crate::ai_runtime::AiRuntime::start(&config)
        .await
        .map_err(|e| e.to_string())?;

    *runtime_lock = Some(runtime);
    Ok(())
}

/// Stop the AI runtime
#[tauri::command]
pub async fn stop_ai_runtime(state: State<'_, AppState>) -> Result<(), String> {
    let mut runtime_lock = state.ai_runtime.write().map_err(|e| e.to_string())?;

    if let Some(runtime) = runtime_lock.take() {
        runtime.stop().await.map_err(|e| e.to_string())?;
    }

    Ok(())
}
