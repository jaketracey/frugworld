//! Audio state management
//!
//! Tracks the current state of all audio channels including volumes,
//! mute states, and currently playing tracks.

/// Audio state struct that holds all audio-related settings
#[derive(Debug, Clone)]
pub struct AudioState {
    /// Master volume (0.0 to 1.0) - affects all audio
    pub master_volume: f32,

    /// Music volume (0.0 to 1.0) - for background MIDI music
    pub music_volume: f32,

    /// Ambient volume (0.0 to 1.0) - for biome ambient sounds
    pub ambient_volume: f32,

    /// Dialogue volume (0.0 to 1.0) - for NPC/TTS audio
    pub dialogue_volume: f32,

    /// Whether music is muted
    pub music_muted: bool,

    /// Whether ambient audio is muted
    pub ambient_muted: bool,

    /// Whether dialogue audio is enabled
    pub dialogue_enabled: bool,

    /// Currently playing music track ID
    pub current_music_track: Option<String>,

    /// Currently playing ambient biome ID
    pub current_ambient_biome: Option<String>,
}

impl Default for AudioState {
    fn default() -> Self {
        Self {
            master_volume: 1.0,
            music_volume: 0.6,
            ambient_volume: 0.5,
            dialogue_volume: 1.0,
            music_muted: false,
            ambient_muted: false,
            dialogue_enabled: true,
            current_music_track: None,
            current_ambient_biome: None,
        }
    }
}

impl AudioState {
    /// Create a new audio state with default values
    pub fn new() -> Self {
        Self::default()
    }

    /// Get the effective music volume (accounting for mute)
    pub fn effective_music_volume(&self) -> f32 {
        if self.music_muted {
            0.0
        } else {
            self.music_volume * self.master_volume
        }
    }

    /// Get the effective ambient volume (accounting for mute)
    pub fn effective_ambient_volume(&self) -> f32 {
        if self.ambient_muted {
            0.0
        } else {
            self.ambient_volume * self.master_volume
        }
    }

    /// Get the effective dialogue volume
    pub fn effective_dialogue_volume(&self) -> f32 {
        if self.dialogue_enabled {
            self.dialogue_volume * self.master_volume
        } else {
            0.0
        }
    }

    /// Check if any music is currently playing
    pub fn is_music_playing(&self) -> bool {
        self.current_music_track.is_some()
    }

    /// Check if any ambient audio is currently playing
    pub fn is_ambient_playing(&self) -> bool {
        self.current_ambient_biome.is_some()
    }

    /// Reset all volumes to default
    pub fn reset_volumes(&mut self) {
        self.master_volume = 1.0;
        self.music_volume = 0.6;
        self.ambient_volume = 0.5;
        self.dialogue_volume = 1.0;
        self.music_muted = false;
        self.ambient_muted = false;
        self.dialogue_enabled = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_state() {
        let state = AudioState::default();
        assert_eq!(state.master_volume, 1.0);
        assert_eq!(state.music_volume, 0.6);
        assert!(!state.music_muted);
        assert!(state.dialogue_enabled);
    }

    #[test]
    fn test_effective_volumes() {
        let mut state = AudioState::default();
        state.master_volume = 0.5;
        state.music_volume = 0.8;

        // 0.5 * 0.8 = 0.4
        assert!((state.effective_music_volume() - 0.4).abs() < f32::EPSILON);

        state.music_muted = true;
        assert_eq!(state.effective_music_volume(), 0.0);
    }

    #[test]
    fn test_reset_volumes() {
        let mut state = AudioState::default();
        state.master_volume = 0.3;
        state.music_muted = true;

        state.reset_volumes();

        assert_eq!(state.master_volume, 1.0);
        assert!(!state.music_muted);
    }
}
