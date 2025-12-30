//! JavaScript bridge bindings for audio control
//!
//! Uses wasm_bindgen to call the JavaScript audio bridge (window.frugworldAudio).
//! Follows the pattern established in connection/spacetime.rs.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

// ============================================================================
// JavaScript Bridge Bindings (WASM only)
// ============================================================================

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    // === INITIALIZATION ===

    /// Initialize the audio system (returns Promise<boolean>)
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = initialize, catch)]
    pub async fn js_audio_initialize() -> Result<JsValue, JsValue>;

    /// Check if audio is initialized
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = isInitialized)]
    pub fn js_audio_is_initialized() -> bool;

    /// Resume audio context after user interaction
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = resumeContext)]
    pub fn js_audio_resume_context();

    // === MUSIC CONTROLS ===

    /// Load a music track from URL (returns Promise<boolean>)
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = loadMusic, catch)]
    pub async fn js_audio_load_music(url: &str, track_id: &str) -> Result<JsValue, JsValue>;

    /// Play a loaded music track with fade-in
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = playMusic)]
    pub fn js_audio_play_music(track_id: &str, fade_ms: u32);

    /// Stop music with fade-out
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = stopMusic)]
    pub fn js_audio_stop_music(fade_ms: u32);

    /// Pause music playback
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = pauseMusic)]
    pub fn js_audio_pause_music();

    /// Resume music playback
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = resumeMusic)]
    pub fn js_audio_resume_music();

    /// Set music volume (0.0 to 1.0)
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = setMusicVolume)]
    pub fn js_audio_set_music_volume(volume: f32);

    /// Get music volume
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = getMusicVolume)]
    pub fn js_audio_get_music_volume() -> f32;

    /// Check if music is playing
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = isMusicPlaying)]
    pub fn js_audio_is_music_playing() -> bool;

    /// Get current music track ID
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = getCurrentMusicTrack)]
    pub fn js_audio_get_current_music_track() -> JsValue;

    // === AMBIENT CONTROLS ===

    /// Load an ambient track from URL (returns Promise<boolean>)
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = loadAmbient, catch)]
    pub async fn js_audio_load_ambient(url: &str, biome_id: &str) -> Result<JsValue, JsValue>;

    /// Play ambient audio for a biome with crossfade
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = playAmbient)]
    pub fn js_audio_play_ambient(biome_id: &str, crossfade_ms: u32);

    /// Stop ambient audio with fade-out
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = stopAmbient)]
    pub fn js_audio_stop_ambient(fade_ms: u32);

    /// Set ambient volume (0.0 to 1.0)
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = setAmbientVolume)]
    pub fn js_audio_set_ambient_volume(volume: f32);

    /// Get ambient volume
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = getAmbientVolume)]
    pub fn js_audio_get_ambient_volume() -> f32;

    /// Get current ambient biome ID
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = getCurrentAmbientBiome)]
    pub fn js_audio_get_current_ambient_biome() -> JsValue;

    // === DIALOGUE CONTROLS ===

    /// Play dialogue audio from URL
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = playDialogue)]
    pub fn js_audio_play_dialogue(audio_url: &str);

    /// Stop dialogue audio
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = stopDialogue)]
    pub fn js_audio_stop_dialogue();

    /// Set dialogue volume (0.0 to 1.0)
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = setDialogueVolume)]
    pub fn js_audio_set_dialogue_volume(volume: f32);

    /// Get dialogue volume
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = getDialogueVolume)]
    pub fn js_audio_get_dialogue_volume() -> f32;

    /// Check if dialogue is playing
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = isDialoguePlaying)]
    pub fn js_audio_is_dialogue_playing() -> bool;

    // === MASTER VOLUME CONTROLS ===

    /// Set master volume (0.0 to 1.0)
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = setMasterVolume)]
    pub fn js_audio_set_master_volume(volume: f32);

    /// Get master volume
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = getMasterVolume)]
    pub fn js_audio_get_master_volume() -> f32;

    /// Mute all audio
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = muteAll)]
    pub fn js_audio_mute_all();

    /// Unmute all audio
    #[wasm_bindgen(js_namespace = ["window", "frugworldAudio"], js_name = unmuteAll)]
    pub fn js_audio_unmute_all();
}

// ============================================================================
// Non-WASM Stubs (for native compilation, testing)
// ============================================================================

#[cfg(not(target_arch = "wasm32"))]
pub async fn js_audio_initialize() -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_is_initialized() -> bool {
    false
}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_resume_context() {}

#[cfg(not(target_arch = "wasm32"))]
pub async fn js_audio_load_music(_url: &str, _track_id: &str) -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_play_music(_track_id: &str, _fade_ms: u32) {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_stop_music(_fade_ms: u32) {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_pause_music() {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_resume_music() {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_set_music_volume(_volume: f32) {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_get_music_volume() -> f32 {
    0.0
}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_is_music_playing() -> bool {
    false
}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_get_current_music_track() -> Option<String> {
    None
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn js_audio_load_ambient(_url: &str, _biome_id: &str) -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_play_ambient(_biome_id: &str, _crossfade_ms: u32) {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_stop_ambient(_fade_ms: u32) {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_set_ambient_volume(_volume: f32) {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_get_ambient_volume() -> f32 {
    0.0
}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_get_current_ambient_biome() -> Option<String> {
    None
}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_play_dialogue(_audio_url: &str) {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_stop_dialogue() {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_set_dialogue_volume(_volume: f32) {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_get_dialogue_volume() -> f32 {
    0.0
}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_is_dialogue_playing() -> bool {
    false
}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_set_master_volume(_volume: f32) {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_get_master_volume() -> f32 {
    0.0
}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_mute_all() {}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_audio_unmute_all() {}
