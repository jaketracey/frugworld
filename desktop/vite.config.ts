import { defineConfig } from 'vite';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  // Prevent vite from obscuring rust errors
  clearScreen: false,

  // Tauri expects a fixed port, fail if not available
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    // Enable CORS for Tauri
    cors: true,
    // Allow serving files from parent directories
    fs: {
      allow: ['..', '../client'],
    },
    watch: {
      // Watch the client directory for changes
      ignored: ['**/src-tauri/**'],
    },
  },

  // Env variables starting with TAURI_ are passed to the client
  envPrefix: ['VITE_', 'TAURI_'],

  resolve: {
    alias: {
      // Map @client to the shared client source
      '@client': resolve(__dirname, '../client/src'),
      '@': resolve(__dirname, 'src'),
    },
  },

  build: {
    // Tauri supports ES2021
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
    // Don't minify for better debugging
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
    // Output directory for Tauri
    outDir: 'dist',
    // Empty the output directory before building
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },

  // Define global constants
  define: {
    // Inject Tauri platform info
    __TAURI_PLATFORM__: JSON.stringify(process.env.TAURI_PLATFORM || 'unknown'),
    __TAURI_ARCH__: JSON.stringify(process.env.TAURI_ARCH || 'unknown'),
    __TAURI_FAMILY__: JSON.stringify(process.env.TAURI_FAMILY || 'unknown'),
    __TAURI_DEBUG__: JSON.stringify(!!process.env.TAURI_DEBUG),
  },
});
