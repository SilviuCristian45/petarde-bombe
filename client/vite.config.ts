import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5173,
    // Same path as in production (Caddy handle_path): the prefix is stripped before the server.
    proxy: {
      '/colyseus': {
        target: 'http://127.0.0.1:2567',
        ws: true,
        rewrite: (path) => path.replace(/^\/colyseus/, ''),
      },
    },
  },
});
