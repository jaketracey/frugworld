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
  },
  build: {
    target: 'ES2022',
    sourcemap: true,
  },
});
