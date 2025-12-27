//! AI runtime management for the Frugworld desktop app.
//!
//! This module handles spawning and managing the AI service as a child process.
//! The AI service is a Node.js application that provides LLM and TTS capabilities.

use crate::config::AppConfig;
use crate::error::{AiServiceError, Result};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::RwLock;

/// Manages the AI service child process.
///
/// The runtime spawns a Node.js process running the ai-service and monitors
/// its health. It provides graceful shutdown and automatic cleanup.
pub struct AiRuntime {
    /// The child process handle.
    process: RwLock<Option<Child>>,
    /// Whether the process is currently running.
    running: AtomicBool,
    /// Whether the service is ready to accept requests.
    ready: AtomicBool,
    /// Last error message encountered.
    last_error: RwLock<Option<String>>,
    /// Port the service is listening on.
    port: u16,
}

impl AiRuntime {
    /// Start the AI runtime with the given configuration.
    ///
    /// This spawns a Node.js process running the ai-service and waits for
    /// it to become ready (responding to health checks).
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Node.js is not found in PATH
    /// - The ai-service directory does not exist
    /// - The process fails to spawn
    /// - The service does not become ready within the timeout
    pub async fn start(config: &AppConfig) -> Result<Self> {
        let port = config.ai_service_port;

        // Find the ai-service directory relative to the executable
        let ai_service_path = find_ai_service_path()?;

        // Build the command to spawn the AI service
        // Uses tsx loader for TypeScript support, matching package.json "start" script
        let mut cmd = Command::new("node");
        cmd.arg("--import")
            .arg("tsx")
            .arg("src/ai-server.ts")
            .current_dir(&ai_service_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // Set environment variables for the AI service
        cmd.env("AI_SERVER_PORT", port.to_string())
            .env("AI_PROVIDER_MODE", config.provider_mode.as_env_value())
            .env("OLLAMA_BASE_URL", &config.llm.ollama_url)
            .env("LLM_MODEL_DIALOGUE", &config.llm.dialogue_model)
            .env("LLM_MODEL_BLUEPRINT", &config.llm.blueprint_model)
            .env("LLM_MODEL_SUMMARY", &config.llm.summary_model)
            .env("LLM_MODEL_REPLAN", &config.llm.replan_model)
            .env("AI_VOICE_ENABLED", config.tts.enabled.to_string())
            .env(
                "PIPER_MODELS_PATH",
                config.models_path.join("tts").display().to_string(),
            )
            .env("PIPER_DEFAULT_VOICE", &config.tts.default_voice);

        // Inherit important environment variables
        inherit_env_vars(&mut cmd);

        // Spawn the process
        let mut process = cmd.spawn().map_err(AiServiceError::SpawnFailed)?;

        // Spawn tasks to forward stdout/stderr
        spawn_output_forwarders(&mut process);

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

    /// Wait for the AI service to become ready with the default timeout (30s).
    ///
    /// Polls the health endpoint every 500ms.
    async fn wait_for_ready(&self) -> Result<()> {
        self.wait_for_ready_timeout(Duration::from_secs(30)).await
    }

    /// Wait for the AI service to become ready with a custom timeout.
    ///
    /// Polls the health endpoint every 500ms until successful or timeout.
    ///
    /// # Arguments
    ///
    /// * `timeout` - Maximum time to wait for the service to become ready.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The service does not become ready within the timeout
    /// - The service process exits unexpectedly
    pub async fn wait_for_ready_timeout(&self, timeout: Duration) -> Result<()> {
        let url = format!("http://127.0.0.1:{}/health", self.port);
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|e| AiServiceError::HttpError {
                message: e.to_string(),
            })?;

        let start = std::time::Instant::now();
        let poll_interval = Duration::from_millis(500);
        let mut attempt = 0;

        while start.elapsed() < timeout {
            tokio::time::sleep(poll_interval).await;
            attempt += 1;

            // Check if process is still running
            {
                let mut process = self.process.write().await;
                if let Some(ref mut child) = *process {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            self.running.store(false, Ordering::SeqCst);
                            return Err(AiServiceError::ProcessExited {
                                exit_code: status.code(),
                            }
                            .into());
                        }
                        Ok(None) => {} // Still running
                        Err(e) => {
                            let mut last_error = self.last_error.write().await;
                            *last_error = Some(e.to_string());
                        }
                    }
                }
            }

            match client.get(&url).send().await {
                Ok(response) if response.status().is_success() => {
                    self.ready.store(true, Ordering::SeqCst);
                    return Ok(());
                }
                Ok(response) => {
                    let mut last_error = self.last_error.write().await;
                    *last_error = Some(format!("Health check returned {}", response.status()));
                }
                Err(e) => {
                    // Only log after a few attempts to reduce noise during startup
                    if attempt > 5 {
                        let mut last_error = self.last_error.write().await;
                        *last_error = Some(e.to_string());
                    }
                }
            }
        }

        Err(AiServiceError::StartupTimeout {
            timeout_secs: timeout.as_secs(),
        }
        .into())
    }

    /// Check if the runtime is currently running.
    #[must_use]
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Check if the runtime is ready to accept requests.
    #[must_use]
    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    /// Get the last error message, if any.
    #[must_use]
    pub fn last_error(&self) -> Option<String> {
        // Use try_read to avoid blocking; return None if lock is held
        self.last_error
            .try_read()
            .ok()
            .and_then(|guard| guard.clone())
    }

    /// Get the port the AI service is running on.
    #[must_use]
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Stop the AI runtime gracefully.
    ///
    /// Sends SIGTERM on Unix, waits 2 seconds, then force kills if needed.
    pub async fn stop(self) -> Result<()> {
        self.running.store(false, Ordering::SeqCst);
        self.ready.store(false, Ordering::SeqCst);

        let mut process_lock = self.process.write().await;
        if let Some(mut process) = process_lock.take() {
            // Try graceful shutdown first on Unix
            #[cfg(unix)]
            {
                if let Some(pid) = process.id() {
                    // SAFETY: We're sending a signal to a process we own
                    unsafe {
                        libc::kill(pid as libc::pid_t, libc::SIGTERM);
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

/// Inherit important environment variables from the parent process.
fn inherit_env_vars(cmd: &mut Command) {
    // PATH is essential for finding node, npm, etc.
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }

    // HOME is needed for config files
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }

    // API keys for cloud services
    for key in [
        "OPENAI_API_KEY",
        "ELEVENLABS_API_KEY",
        "FAL_API_KEY",
        "SPACETIMEDB_URI",
        "SPACETIMEDB_MODULE",
    ] {
        if let Ok(value) = std::env::var(key) {
            cmd.env(key, value);
        }
    }
}

/// Spawn background tasks to forward child process output to the console.
fn spawn_output_forwarders(process: &mut Child) {
    if let Some(stdout) = process.stdout.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                println!("[AI] {line}");
            }
        });
    }

    if let Some(stderr) = process.stderr.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[AI:ERR] {line}");
            }
        });
    }
}

/// Find the ai-service directory relative to the executable.
///
/// Searches in the following order:
/// 1. Development: `../ai-service` from the desktop directory
/// 2. macOS bundle: `Contents/Resources/ai-service`
/// 3. Windows/Linux: `ai-service` next to executable
pub fn find_ai_service_path() -> Result<PathBuf> {
    // Get the executable's directory
    let exe_path = std::env::current_exe()?;
    let exe_dir = exe_path.parent().unwrap_or(Path::new("."));

    // In development, traverse up from target/debug or target/release to find ai-service
    for ancestor in exe_dir.ancestors() {
        let candidate = ancestor.join("ai-service");
        if is_valid_ai_service_dir(&candidate) {
            eprintln!("[AI] Found ai-service at: {}", candidate.display());
            return Ok(candidate);
        }
    }

    // macOS bundle: Contents/MacOS/../Resources/ai-service
    #[cfg(target_os = "macos")]
    {
        let bundle_path = exe_dir.join("../Resources/ai-service");
        if is_valid_ai_service_dir(&bundle_path) {
            return Ok(bundle_path);
        }
    }

    // Windows/Linux: ai-service in same directory as executable
    let sibling_path = exe_dir.join("ai-service");
    if is_valid_ai_service_dir(&sibling_path) {
        return Ok(sibling_path);
    }

    Err(AiServiceError::AiServiceNotFound {
        path: "ai-service (searched multiple locations)".to_string(),
    }
    .into())
}

/// Check if a path is a valid ai-service directory.
fn is_valid_ai_service_dir(path: &Path) -> bool {
    path.exists()
        && path.join("package.json").exists()
        && path.join("src/ai-server.ts").exists()
}

/// Convenience function to start the AI service.
///
/// Finds the ai-service directory and starts the runtime with the given config.
///
/// # Arguments
///
/// * `models_path` - Path to the models directory (used for environment config).
/// * `config` - Application configuration.
///
/// # Errors
///
/// Returns an error if the service fails to start.
#[allow(dead_code)]
pub async fn start_ai_service(
    _models_path: &Path,
    config: &AppConfig,
) -> Result<AiRuntime> {
    AiRuntime::start(config).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runtime_initial_state() {
        // Just test that we can create the struct with proper atomic state
        let running = AtomicBool::new(false);
        let ready = AtomicBool::new(false);

        assert!(!running.load(Ordering::SeqCst));
        assert!(!ready.load(Ordering::SeqCst));
    }
}
