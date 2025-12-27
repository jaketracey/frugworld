import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['.ngrok.app', '.ngrok-free.app'],
    fs: {
      // Allow serving files from graph-client/pkg via symlink
      allow: ['..'],
    },
    // Disable caching for WASM files during development
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  build: {
    target: 'ES2022',
    sourcemap: true,
  },
});
