//! AI runtime management for the Frugworld desktop app.
//!
//! This module handles spawning and managing the AI service as a child process.

use crate::config::AppConfig;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::RwLock;

/// Error type for AI runtime operations
#[derive(Debug, thiserror::Error)]
pub enum AiRuntimeError {
    #[error("Failed to spawn AI process: {0}")]
    SpawnError(#[from] std::io::Error),

    #[error("AI process exited unexpectedly")]
    ProcessExited,

    #[error("AI service not ready after timeout")]
    NotReady,

    #[error("Configuration error: {0}")]
    ConfigError(String),
}

/// Manages the AI service child process
pub struct AiRuntime {
    process: RwLock<Option<Child>>,
    running: AtomicBool,
    ready: AtomicBool,
    last_error: RwLock<Option<String>>,
    port: u16,
}

impl AiRuntime {
    /// Start the AI runtime with the given configuration
    pub async fn start(config: &AppConfig) -> Result<Self, AiRuntimeError> {
        let port = config.ai_service_port.unwrap_or(3001);

        // Determine the path to the AI service
        let ai_service_path = config
            .ai_service_path
            .clone()
            .unwrap_or_else(|| "ai-service".to_string());

        // Spawn the Node.js process running the AI service
        let process = Command::new("node")
            .arg(&ai_service_path)
            .env("PORT", port.to_string())
            .env("OLLAMA_HOST", config.ollama_host.as_deref().unwrap_or("http://127.0.0.1:11434"))
            .kill_on_drop(true)
            .spawn()?;

        let runtime = Self {
            process: RwLock::new(Some(process)),
            running: AtomicBool::new(true),
            ready: AtomicBool::new(false),
            last_error: RwLock::new(None),
            port,
        };

        // Wait for the service to become ready
        runtime.wait_for_ready().await?;

        Ok(runtime)
    }

    /// Wait for the AI service to become ready
    async fn wait_for_ready(&self) -> Result<(), AiRuntimeError> {
        let url = format!("http://127.0.0.1:{}/health", self.port);
        let client = reqwest::Client::new();

        for _ in 0..30 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            match client.get(&url).send().await {
                Ok(response) if response.status().is_success() => {
                    self.ready.store(true, Ordering::SeqCst);
                    return Ok(());
                }
                _ => continue,
            }
        }

        Err(AiRuntimeError::NotReady)
    }

    /// Check if the runtime is currently running
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Check if the runtime is ready to accept requests
    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    /// Get the last error message, if any
    pub fn last_error(&self) -> Option<String> {
        self.last_error.blocking_read().clone()
    }

    /// Get the port the AI service is running on
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Stop the AI runtime
    pub async fn stop(self) -> Result<(), AiRuntimeError> {
        self.running.store(false, Ordering::SeqCst);
        self.ready.store(false, Ordering::SeqCst);

        let mut process_lock = self.process.write().await;
        if let Some(mut process) = process_lock.take() {
            // Try graceful shutdown first
            #[cfg(unix)]
            {
                use tokio::signal::unix::{signal, SignalKind};
                if let Some(pid) = process.id() {
                    unsafe {
                        libc::kill(pid as i32, libc::SIGTERM);
                    }
                }
            }

            // Wait a bit for graceful shutdown
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;

            // Force kill if still running
            let _ = process.kill().await;
        }

        Ok(())
    }
}

impl Drop for AiRuntime {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        // The process will be killed on drop due to kill_on_drop(true)
    }
}
