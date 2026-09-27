import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@sim': path.resolve(__dirname, './src/sim'),
      '@render': path.resolve(__dirname, './src/render'),
      '@mods': path.resolve(__dirname, './src/mods'),
      '@tools': path.resolve(__dirname, './src/tools'),
    },
  },
  server: {
    port: 3000,
    open: false,
  },
});
