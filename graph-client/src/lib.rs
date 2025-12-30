//! Frugworld Graph Client - WASM 2D visualization of NPC relationships
//!
//! This crate provides a WebAssembly-based graph visualization client that displays
//! NPCs as nodes and their relationships as edges. It connects to the same SpacetimeDB
//! server as the Three.js client.

use wasm_bindgen::prelude::*;

mod app;
pub mod audio;
mod connection;
mod graph;
mod input;
mod player;
mod render;
mod ui;

pub use app::GraphApp;

/// Initialize panic hook and logging for WASM
fn init_wasm() {
    console_error_panic_hook::set_once();
    // Use .ok() to ignore error if logger is already initialized
    let _ = console_log::init_with_level(log::Level::Info);
}

/// Main entry point called from JavaScript
#[wasm_bindgen(start)]
pub fn wasm_main() {
    init_wasm();
    log::info!("Frugworld Graph Client initialized");
}

/// Create and run the graph application
#[wasm_bindgen]
pub async fn run_graph_app(canvas_id: &str, spacetime_url: &str) -> Result<(), JsValue> {
    init_wasm();

    log::info!("Starting graph app with canvas: {}, url: {}", canvas_id, spacetime_url);

    // Set up dialogue callback to receive responses from JS bridge
    connection::spacetime::setup_dialogue_callback();

    let app = GraphApp::new(canvas_id, spacetime_url).await
        .map_err(|e| JsValue::from_str(&format!("Failed to create app: {}", e)))?;

    app.run().await
        .map_err(|e| JsValue::from_str(&format!("App error: {}", e)))?;

    Ok(())
}
