import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const base = process.env.GITHUB_PAGES === 'true' ? '/soroban-game/' : '/';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'origin, content-type, accept'
};

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    cors: true,
    headers: corsHeaders
  },
  preview: {
    cors: true,
    headers: corsHeaders
  },
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'index.html'),
        cad: resolve(__dirname, 'cad.html')
      }
    }
  }
});
