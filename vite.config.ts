import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'origin, content-type, accept'
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'removed-cad-page',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === '/cad.html') {
            response.statusCode = 404;
            response.end('Not found');
            return;
          }

          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === '/cad.html') {
            response.statusCode = 404;
            response.end('Not found');
            return;
          }

          next();
        });
      }
    }
  ],
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
        app: resolve(__dirname, 'index.html')
      }
    }
  }
});
