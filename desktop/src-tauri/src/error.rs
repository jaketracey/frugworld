//! Custom error types for the Frugworld desktop application.
//!
//! Provides a unified error type that encompasses all possible failure modes
//! when managing the AI service and application configuration.

use std::fmt;

/// Result type alias using our custom error type.
pub type Result<T> = std::result::Result<T, AppError>;

/// Unified error type for the Frugworld desktop application.
#[derive(Debug)]
pub enum AppError {
    /// AI service failed to start or crashed unexpectedly.
    AiService(AiServiceError),
    /// Configuration file read/write or validation error.
    Config(ConfigError),
    /// Generic I/O error.
    Io(std::io::Error),
    /// JSON serialization/deserialization error.
    Json(serde_json::Error),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AiService(e) => write!(f, "AI service error: {e}"),
            Self::Config(e) => write!(f, "Configuration error: {e}"),
            Self::Io(e) => write!(f, "I/O error: {e}"),
            Self::Json(e) => write!(f, "JSON error: {e}"),
        }
    }
}

impl std::error::Error for AppError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::AiService(e) => Some(e),
            Self::Config(e) => Some(e),
            Self::Io(e) => Some(e),
            Self::Json(e) => Some(e),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::Json(err)
    }
}

impl From<AiServiceError> for AppError {
    fn from(err: AiServiceError) -> Self {
        Self::AiService(err)
    }
}

impl From<ConfigError> for AppError {
    fn from(err: ConfigError) -> Self {
        Self::Config(err)
    }
}

/// Errors specific to AI service management.
#[derive(Debug)]
pub enum AiServiceError {
    /// Failed to spawn the Node.js child process.
    SpawnFailed(std::io::Error),
    /// The AI service process exited unexpectedly.
    ProcessExited { exit_code: Option<i32> },
    /// Timeout waiting for the AI service to become ready.
    StartupTimeout { timeout_secs: u64 },
    /// Health check failed after the service was started.
    HealthCheckFailed { message: String },
    /// The service is not currently running.
    NotRunning,
    /// Node.js runtime was not found on the system.
    NodeNotFound,
    /// The ai-service directory was not found.
    AiServiceNotFound { path: String },
    /// HTTP request to the AI service failed.
    HttpError { message: String },
}

impl fmt::Display for AiServiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SpawnFailed(e) => write!(f, "failed to spawn AI service process: {e}"),
            Self::ProcessExited { exit_code } => match exit_code {
                Some(code) => write!(f, "AI service exited with code {code}"),
                None => write!(f, "AI service was terminated by signal"),
            },
            Self::StartupTimeout { timeout_secs } => {
                write!(f, "AI service did not become ready within {timeout_secs}s")
            }
            Self::HealthCheckFailed { message } => {
                write!(f, "AI service health check failed: {message}")
            }
            Self::NotRunning => write!(f, "AI service is not running"),
            Self::NodeNotFound => write!(f, "Node.js runtime not found in PATH"),
            Self::AiServiceNotFound { path } => {
                write!(f, "ai-service directory not found at: {path}")
            }
            Self::HttpError { message } => write!(f, "HTTP error: {message}"),
        }
    }
}

impl std::error::Error for AiServiceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::SpawnFailed(e) => Some(e),
            _ => None,
        }
    }
}

/// Errors specific to configuration management.
#[derive(Debug)]
pub enum ConfigError {
    /// Failed to determine the application data directory.
    DataDirNotFound,
    /// Configuration file is malformed or contains invalid values.
    InvalidConfig { message: String },
    /// Failed to read the configuration file.
    ReadFailed(std::io::Error),
    /// Failed to write the configuration file.
    WriteFailed(std::io::Error),
    /// The specified models path does not exist.
    ModelsPathNotFound { path: String },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DataDirNotFound => write!(f, "could not determine application data directory"),
            Self::InvalidConfig { message } => write!(f, "invalid configuration: {message}"),
            Self::ReadFailed(e) => write!(f, "failed to read configuration: {e}"),
            Self::WriteFailed(e) => write!(f, "failed to write configuration: {e}"),
            Self::ModelsPathNotFound { path } => {
                write!(f, "models directory not found: {path}")
            }
        }
    }
}

impl std::error::Error for ConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::ReadFailed(e) | Self::WriteFailed(e) => Some(e),
            _ => None,
        }
    }
}
