import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';
const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };

/** In dev, serve the overlay entry for /overlay/<token> just like the Fastify server does in production. */
const overlayDevRoute = (): Plugin => ({
  name: 'waviloop-overlay-dev-route',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/overlay/')) req.url = '/overlay.html';
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), overlayDevRoute()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), overlay: resolve(import.meta.dirname, 'overlay.html') },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/auth': backend,
      '/uploads': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
});
