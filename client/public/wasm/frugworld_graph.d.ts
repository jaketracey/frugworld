/* tslint:disable */
/* eslint-disable */

/**
 * Create and run the graph application
 */
export function run_graph_app(canvas_id: string, spacetime_url: string): Promise<void>;

/**
 * Main entry point called from JavaScript
 */
export function wasm_main(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly run_graph_app: (a: number, b: number, c: number, d: number) => any;
  readonly wasm_main: () => void;
  readonly wasm_bindgen__convert__closures_____invoke__h21660dfc314d2e28: (a: number, b: number, c: any, d: any) => void;
  readonly wasm_bindgen__closure__destroy__h1042a5cf627c2b13: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h6c18194ba59624b3: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__closure__destroy__h1f6bea0ca7bc8263: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h068d83d7f0020249: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h7b09a4b111a0bf90: (a: number, b: number) => void;
  readonly wasm_bindgen__convert__closures_____invoke__h432b9d399eea16cd: (a: number, b: number, c: any, d: any) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
