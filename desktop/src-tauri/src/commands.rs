//! Tauri IPC command handlers for the Frugworld desktop app.
//!
//! These commands are invoked from the frontend via Tauri's IPC mechanism.

use crate::ai_runtime::AiRuntime;
use crate::config::{self, AppConfig};
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

/// Status of the AI runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiStatus {
    /// Whether the AI service process is running.
    pub running: bool,
    /// Whether the AI service is ready to accept requests.
    pub ready: bool,
    /// Last error message, if any.
    pub error: Option<String>,
    /// Port the AI service is listening on.
    pub port: Option<u16>,
}

/// Status of downloaded models.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStatus {
    /// Whether an LLM model is configured.
    pub llm_configured: bool,
    /// The configured LLM dialogue model.
    pub llm_dialogue_model: String,
    /// The configured LLM blueprint model.
    pub llm_blueprint_model: String,
    /// Whether TTS is enabled.
    pub tts_enabled: bool,
    /// The configured TTS voice.
    pub tts_voice: String,
}

/// Model download progress information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    /// Name of the model being downloaded.
    pub model_name: String,
    /// Download progress (0.0 - 1.0).
    pub progress: f32,
    /// Human-readable status message.
    pub status: String,
}

/// Check if the AI runtime is running and ready.
#[tauri::command]
pub async fn get_ai_status(state: State<'_, AppState>) -> Result<AiStatus, String> {
    let runtime = state.ai_runtime.read().await;

    match runtime.as_ref() {
        Some(rt) => Ok(AiStatus {
            running: rt.is_running(),
            ready: rt.is_ready(),
            error: rt.last_error(),
            port: Some(rt.port()),
        }),
        None => Ok(AiStatus {
            running: false,
            ready: false,
            error: None,
            port: None,
        }),
    }
}

/// Check which models are configured.
#[tauri::command]
pub async fn get_model_status(state: State<'_, AppState>) -> Result<ModelStatus, String> {
    let config = state.config.read().await;

    Ok(ModelStatus {
        llm_configured: !config.llm.dialogue_model.is_empty(),
        llm_dialogue_model: config.llm.dialogue_model.clone(),
        llm_blueprint_model: config.llm.blueprint_model.clone(),
        tts_enabled: config.tts.enabled,
        tts_voice: config.tts.default_voice.clone(),
    })
}

/// Download a model by name.
///
/// This initiates the download process and returns immediately.
/// Progress updates are sent via Tauri events.
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
    // 4. Emit progress events to the frontend

    Ok(DownloadProgress {
        model_name,
        progress: 0.0,
        status: format!("Starting download of {model_type} model..."),
    })
}

/// Get the current application configuration.
#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let config = state.config.read().await;
    Ok(config.clone())
}

/// Update the application configuration.
#[tauri::command]
pub async fn set_config(new_config: AppConfig, state: State<'_, AppState>) -> Result<(), String> {
    // Save to disk first
    config::save_config(&new_config)
        .await
        .map_err(|e| e.to_string())?;

    // Update in-memory state
    let mut config = state.config.write().await;
    *config = new_config;

    Ok(())
}

/// Start the AI runtime.
#[tauri::command]
pub async fn start_ai_runtime(state: State<'_, AppState>) -> Result<(), String> {
    let config = state.config.read().await;
    let mut runtime_lock = state.ai_runtime.write().await;

    if runtime_lock.is_some() {
        return Err("AI runtime is already running".to_string());
    }

    let runtime = AiRuntime::start(&config).await.map_err(|e| e.to_string())?;

    *runtime_lock = Some(runtime);
    Ok(())
}

/// Stop the AI runtime.
#[tauri::command]
pub async fn stop_ai_runtime(state: State<'_, AppState>) -> Result<(), String> {
    let mut runtime_lock = state.ai_runtime.write().await;

    if let Some(runtime) = runtime_lock.take() {
        runtime.stop().await.map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Start the AI service (alias for `start_ai_runtime`).
#[tauri::command]
pub async fn start_ai(state: State<'_, AppState>) -> Result<(), String> {
    start_ai_runtime(state).await
}

/// Stop the AI service (alias for `stop_ai_runtime`).
#[tauri::command]
pub async fn stop_ai(state: State<'_, AppState>) -> Result<(), String> {
    stop_ai_runtime(state).await
}
