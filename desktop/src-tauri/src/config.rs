//! Configuration management for the Frugworld desktop application.
//!
//! Handles persistent storage of application settings, model paths,
//! and AI provider preferences using the system's standard app data directory.

use crate::error::{ConfigError, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;

/// Application configuration stored on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    /// Path to the models directory (LLM, TTS, etc.).
    pub models_path: PathBuf,

    /// AI provider mode: controls local vs cloud priority.
    pub provider_mode: ProviderMode,

    /// HTTP port for the AI service.
    pub ai_service_port: u16,

    /// Whether to auto-start the AI service on application launch.
    pub auto_start_ai: bool,

    /// LLM model configuration.
    pub llm: LlmConfig,

    /// TTS model configuration.
    pub tts: TtsConfig,

    /// Developer mode settings.
    pub dev: DevConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            models_path: default_models_path(),
            provider_mode: ProviderMode::LocalFirst,
            ai_service_port: 3002,
            auto_start_ai: true,
            llm: LlmConfig::default(),
            tts: TtsConfig::default(),
            dev: DevConfig::default(),
        }
    }
}

/// AI provider priority mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderMode {
    /// Prefer local providers (Ollama, Piper), fall back to cloud.
    LocalFirst,
    /// Prefer cloud providers (OpenAI, ElevenLabs), fall back to local.
    CloudFirst,
    /// Only use local providers, fail if unavailable.
    LocalOnly,
    /// Only use cloud providers, fail if unavailable.
    CloudOnly,
}

impl ProviderMode {
    /// Returns the environment variable value for this mode.
    #[must_use]
    pub fn as_env_value(&self) -> &'static str {
        match self {
            Self::LocalFirst => "local-first",
            Self::CloudFirst => "cloud-first",
            Self::LocalOnly => "local-only",
            Self::CloudOnly => "cloud-only",
        }
    }
}

/// LLM-specific configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LlmConfig {
    /// Model name for NPC dialogue generation.
    pub dialogue_model: String,
    /// Model name for blueprint/planning generation.
    pub blueprint_model: String,
    /// Model name for conversation summarization.
    pub summary_model: String,
    /// Model name for NPC replanning.
    pub replan_model: String,
    /// Ollama server URL (for local mode).
    pub ollama_url: String,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            dialogue_model: "llama3.2:3b".to_string(),
            blueprint_model: "qwen2.5:7b".to_string(),
            summary_model: "llama3.2:3b".to_string(),
            replan_model: "llama3.2:3b".to_string(),
            ollama_url: "http://localhost:11434".to_string(),
        }
    }
}

/// TTS-specific configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TtsConfig {
    /// Whether TTS is enabled.
    pub enabled: bool,
    /// Default Piper voice name.
    pub default_voice: String,
}

impl Default for TtsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            default_voice: "en_US-lessac-medium".to_string(),
        }
    }
}

/// Developer-mode settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DevConfig {
    /// Enable verbose logging.
    pub verbose_logging: bool,
    /// Keep AI service running after app closes (for debugging).
    pub keep_service_on_exit: bool,
}

impl Default for DevConfig {
    fn default() -> Self {
        Self {
            verbose_logging: false,
            keep_service_on_exit: false,
        }
    }
}

/// Returns the default models path within the app data directory.
fn default_models_path() -> PathBuf {
    get_app_data_dir()
        .map(|p| p.join("models"))
        .unwrap_or_else(|| PathBuf::from("./models"))
}

/// Returns the application data directory for Frugworld.
///
/// - macOS: `~/Library/Application Support/com.frugworld.app`
/// - Windows: `%APPDATA%/Frugworld`
/// - Linux: `~/.local/share/frugworld`
#[must_use]
pub fn get_app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|p| {
        #[cfg(target_os = "macos")]
        {
            p.join("com.frugworld.app")
        }
        #[cfg(target_os = "windows")]
        {
            p.join("Frugworld")
        }
        #[cfg(target_os = "linux")]
        {
            p.join("frugworld")
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            p.join("frugworld")
        }
    })
}

/// Returns the path to the configuration file.
fn get_config_path() -> Result<PathBuf> {
    get_app_data_dir()
        .map(|p| p.join("config.json"))
        .ok_or(ConfigError::DataDirNotFound.into())
}

/// Loads the application configuration from disk.
///
/// If the configuration file does not exist, returns the default configuration.
///
/// # Errors
///
/// Returns an error if the configuration file exists but cannot be read or parsed.
pub async fn load_config() -> Result<AppConfig> {
    let config_path = get_config_path()?;

    if !config_path.exists() {
        return Ok(AppConfig::default());
    }

    let contents = fs::read_to_string(&config_path)
        .await
        .map_err(ConfigError::ReadFailed)?;

    let config: AppConfig = serde_json::from_str(&contents)?;
    Ok(config)
}

/// Saves the application configuration to disk.
///
/// Creates the parent directory if it does not exist.
///
/// # Errors
///
/// Returns an error if the configuration cannot be serialized or written.
pub async fn save_config(config: &AppConfig) -> Result<()> {
    let config_path = get_config_path()?;

    // Ensure parent directory exists
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).await?;
    }

    let contents = serde_json::to_string_pretty(config)?;
    fs::write(&config_path, contents)
        .await
        .map_err(ConfigError::WriteFailed)?;

    Ok(())
}

/// Validates that the models path exists and is accessible.
///
/// # Errors
///
/// Returns an error if the path does not exist or is not a directory.
#[allow(dead_code)]
pub async fn validate_models_path(path: &Path) -> Result<()> {
    if !path.exists() {
        return Err(ConfigError::ModelsPathNotFound {
            path: path.display().to_string(),
        }
        .into());
    }

    let metadata = fs::metadata(path).await?;
    if !metadata.is_dir() {
        return Err(ConfigError::InvalidConfig {
            message: format!("{} is not a directory", path.display()),
        }
        .into());
    }

    Ok(())
}

/// Ensures the models directory structure exists.
///
/// Creates the following subdirectories if they don't exist:
/// - `llm/` - LLM model files
/// - `tts/` - TTS voice models
///
/// # Errors
///
/// Returns an error if directories cannot be created.
#[allow(dead_code)]
pub async fn ensure_models_dir(base_path: &Path) -> Result<()> {
    let subdirs = ["llm", "tts"];

    for subdir in &subdirs {
        let path = base_path.join(subdir);
        if !path.exists() {
            fs::create_dir_all(&path).await?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert_eq!(config.ai_service_port, 3002);
        assert!(config.auto_start_ai);
        assert_eq!(config.provider_mode, ProviderMode::LocalFirst);
    }

    #[test]
    fn test_provider_mode_env_value() {
        assert_eq!(ProviderMode::LocalFirst.as_env_value(), "local-first");
        assert_eq!(ProviderMode::CloudFirst.as_env_value(), "cloud-first");
        assert_eq!(ProviderMode::LocalOnly.as_env_value(), "local-only");
        assert_eq!(ProviderMode::CloudOnly.as_env_value(), "cloud-only");
    }

    #[test]
    fn test_config_serialization() {
        let config = AppConfig::default();
        let json = serde_json::to_string(&config).expect("should serialize");
        let parsed: AppConfig = serde_json::from_str(&json).expect("should deserialize");
        assert_eq!(parsed.ai_service_port, config.ai_service_port);
    }
}
