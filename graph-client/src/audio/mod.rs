//! Audio system for the WASM graph client
//!
//! This module provides audio management through a JavaScript bridge, enabling:
//! - Background music (MIDI) playback with fade controls
//! - Ambient audio for biome-based soundscapes
//! - Dialogue/TTS audio for NPC conversations
//! - Volume controls for all audio channels

mod bridge;
mod state;

pub use bridge::*;
pub use state::*;

/// Audio manager that coordinates all audio through the JavaScript bridge
pub struct AudioManager {
    /// Current audio state (volumes, current tracks, etc.)
    pub state: AudioState,
    /// Whether the audio system has been initialized
    initialized: bool,
    /// Whether audio is currently muted
    muted: bool,
}

impl AudioManager {
    /// Create a new audio manager
    pub fn new() -> Self {
        Self {
            state: AudioState::default(),
            initialized: false,
            muted: false,
        }
    }

    /// Initialize the audio system (must be called after user interaction)
    #[cfg(target_arch = "wasm32")]
    pub async fn initialize(&mut self) -> bool {
        if self.initialized {
            return true;
        }

        match js_audio_initialize().await {
            Ok(result) => {
                self.initialized = result.as_bool().unwrap_or(false);
                if self.initialized {
                    log::info!("[Audio] Audio system initialized");
                    // Apply initial volume settings
                    self.apply_volumes();
                } else {
                    log::warn!("[Audio] Audio system initialization returned false");
                }
                self.initialized
            }
            Err(e) => {
                log::error!("[Audio] Failed to initialize audio: {:?}", e);
                false
            }
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub async fn initialize(&mut self) -> bool {
        false
    }

    /// Check if audio is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// Resume audio context (call on user interaction)
    #[cfg(target_arch = "wasm32")]
    pub fn resume_context(&self) {
        if self.initialized {
            js_audio_resume_context();
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn resume_context(&self) {}

    // =========================================================================
    // Music Controls
    // =========================================================================

    /// Load a music track from URL
    #[cfg(target_arch = "wasm32")]
    pub async fn load_music(&mut self, url: &str, track_id: &str) -> bool {
        match js_audio_load_music(url, track_id).await {
            Ok(result) => result.as_bool().unwrap_or(false),
            Err(e) => {
                log::warn!("[Audio] Failed to load music '{}': {:?}", track_id, e);
                false
            }
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub async fn load_music(&mut self, _url: &str, _track_id: &str) -> bool {
        false
    }

    /// Play a loaded music track
    #[cfg(target_arch = "wasm32")]
    pub fn play_music(&mut self, track_id: &str, fade_ms: u32) {
        if self.initialized && !self.state.music_muted {
            js_audio_play_music(track_id, fade_ms);
            self.state.current_music_track = Some(track_id.to_string());
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn play_music(&mut self, _track_id: &str, _fade_ms: u32) {}

    /// Stop music playback
    #[cfg(target_arch = "wasm32")]
    pub fn stop_music(&mut self, fade_ms: u32) {
        if self.initialized {
            js_audio_stop_music(fade_ms);
            self.state.current_music_track = None;
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn stop_music(&mut self, _fade_ms: u32) {}

    /// Pause music
    #[cfg(target_arch = "wasm32")]
    pub fn pause_music(&self) {
        if self.initialized {
            js_audio_pause_music();
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn pause_music(&self) {}

    /// Resume music
    #[cfg(target_arch = "wasm32")]
    pub fn resume_music(&self) {
        if self.initialized && !self.state.music_muted {
            js_audio_resume_music();
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn resume_music(&self) {}

    /// Set music volume (0.0 to 1.0)
    #[cfg(target_arch = "wasm32")]
    pub fn set_music_volume(&mut self, volume: f32) {
        self.state.music_volume = volume.clamp(0.0, 1.0);
        if self.initialized {
            js_audio_set_music_volume(self.state.music_volume);
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn set_music_volume(&mut self, volume: f32) {
        self.state.music_volume = volume.clamp(0.0, 1.0);
    }

    /// Toggle music mute
    pub fn toggle_music_mute(&mut self) {
        self.state.music_muted = !self.state.music_muted;
        #[cfg(target_arch = "wasm32")]
        {
            let vol = if self.state.music_muted {
                0.0
            } else {
                self.state.music_volume
            };
            if self.initialized {
                js_audio_set_music_volume(vol);
            }
        }
    }

    // =========================================================================
    // Ambient Controls
    // =========================================================================

    /// Load an ambient track for a biome
    #[cfg(target_arch = "wasm32")]
    pub async fn load_ambient(&mut self, url: &str, biome_id: &str) -> bool {
        match js_audio_load_ambient(url, biome_id).await {
            Ok(result) => result.as_bool().unwrap_or(false),
            Err(e) => {
                log::warn!("[Audio] Failed to load ambient '{}': {:?}", biome_id, e);
                false
            }
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub async fn load_ambient(&mut self, _url: &str, _biome_id: &str) -> bool {
        false
    }

    /// Play ambient audio for a biome
    #[cfg(target_arch = "wasm32")]
    pub fn play_ambient(&mut self, biome_id: &str, crossfade_ms: u32) {
        if self.initialized && !self.state.ambient_muted {
            js_audio_play_ambient(biome_id, crossfade_ms);
            self.state.current_ambient_biome = Some(biome_id.to_string());
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn play_ambient(&mut self, _biome_id: &str, _crossfade_ms: u32) {}

    /// Stop ambient audio
    #[cfg(target_arch = "wasm32")]
    pub fn stop_ambient(&mut self, fade_ms: u32) {
        if self.initialized {
            js_audio_stop_ambient(fade_ms);
            self.state.current_ambient_biome = None;
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn stop_ambient(&mut self, _fade_ms: u32) {}

    /// Set ambient volume (0.0 to 1.0)
    #[cfg(target_arch = "wasm32")]
    pub fn set_ambient_volume(&mut self, volume: f32) {
        self.state.ambient_volume = volume.clamp(0.0, 1.0);
        if self.initialized {
            js_audio_set_ambient_volume(self.state.ambient_volume);
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn set_ambient_volume(&mut self, volume: f32) {
        self.state.ambient_volume = volume.clamp(0.0, 1.0);
    }

    /// Toggle ambient mute
    pub fn toggle_ambient_mute(&mut self) {
        self.state.ambient_muted = !self.state.ambient_muted;
        #[cfg(target_arch = "wasm32")]
        {
            let vol = if self.state.ambient_muted {
                0.0
            } else {
                self.state.ambient_volume
            };
            if self.initialized {
                js_audio_set_ambient_volume(vol);
            }
        }
    }

    // =========================================================================
    // Dialogue Controls
    // =========================================================================

    /// Play dialogue audio from URL
    #[cfg(target_arch = "wasm32")]
    pub fn play_dialogue(&self, audio_url: &str) {
        if self.initialized && self.state.dialogue_enabled {
            js_audio_play_dialogue(audio_url);
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn play_dialogue(&self, _audio_url: &str) {}

    /// Stop dialogue audio
    #[cfg(target_arch = "wasm32")]
    pub fn stop_dialogue(&self) {
        if self.initialized {
            js_audio_stop_dialogue();
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn stop_dialogue(&self) {}

    /// Set dialogue volume (0.0 to 1.0)
    #[cfg(target_arch = "wasm32")]
    pub fn set_dialogue_volume(&mut self, volume: f32) {
        self.state.dialogue_volume = volume.clamp(0.0, 1.0);
        if self.initialized {
            js_audio_set_dialogue_volume(self.state.dialogue_volume);
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn set_dialogue_volume(&mut self, volume: f32) {
        self.state.dialogue_volume = volume.clamp(0.0, 1.0);
    }

    /// Toggle dialogue enabled
    pub fn toggle_dialogue_enabled(&mut self) {
        self.state.dialogue_enabled = !self.state.dialogue_enabled;
        if !self.state.dialogue_enabled {
            self.stop_dialogue();
        }
    }

    // =========================================================================
    // Master Volume Controls
    // =========================================================================

    /// Set master volume (0.0 to 1.0)
    #[cfg(target_arch = "wasm32")]
    pub fn set_master_volume(&mut self, volume: f32) {
        self.state.master_volume = volume.clamp(0.0, 1.0);
        if self.initialized {
            js_audio_set_master_volume(self.state.master_volume);
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn set_master_volume(&mut self, volume: f32) {
        self.state.master_volume = volume.clamp(0.0, 1.0);
    }

    /// Mute all audio
    #[cfg(target_arch = "wasm32")]
    pub fn mute_all(&mut self) {
        self.muted = true;
        if self.initialized {
            js_audio_mute_all();
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn mute_all(&mut self) {
        self.muted = true;
    }

    /// Unmute all audio
    #[cfg(target_arch = "wasm32")]
    pub fn unmute_all(&mut self) {
        self.muted = false;
        if self.initialized {
            js_audio_unmute_all();
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn unmute_all(&mut self) {
        self.muted = false;
    }

    /// Check if audio is muted
    pub fn is_muted(&self) -> bool {
        self.muted
    }

    /// Apply all current volume settings to JS bridge
    #[cfg(target_arch = "wasm32")]
    fn apply_volumes(&self) {
        js_audio_set_master_volume(self.state.master_volume);
        js_audio_set_music_volume(if self.state.music_muted {
            0.0
        } else {
            self.state.music_volume
        });
        js_audio_set_ambient_volume(if self.state.ambient_muted {
            0.0
        } else {
            self.state.ambient_volume
        });
        js_audio_set_dialogue_volume(self.state.dialogue_volume);
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn apply_volumes(&self) {}
}

impl Default for AudioManager {
    fn default() -> Self {
        Self::new()
    }
}
