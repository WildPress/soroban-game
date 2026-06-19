import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'origin, content-type, accept'
};

export default defineConfig({
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
