/**
 * Type declarations for the Frugworld Graph WASM module
 */
declare module '/graph-wasm/frugworld_graph.js' {
  /**
   * Initialize the WASM module
   */
  export default function init(): Promise<void>;

  /**
   * Create and run the graph application
   * @param canvasId - The ID of the canvas element to render to
   * @param spacetimeUrl - The WebSocket URL of the SpacetimeDB server
   */
  export function run_graph_app(canvasId: string, spacetimeUrl: string): Promise<void>;

  /**
   * Main entry point called from JavaScript
   */
  export function wasm_main(): void;
}
