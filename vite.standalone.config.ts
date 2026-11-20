import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The normal vite.config.ts keeps diagrams split into lazy chunks. This optional
// build embeds every chunk so a downloaded HTML file needs no local web server.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'standalone',
    cssCodeSplit: false,
    assetsInlineLimit: 20_000_000,
    modulePreload: false,
    sourcemap: false,
    chunkSizeWarningLimit: 10_000,
    rolldownOptions: {
      output: { codeSplitting: false },
    },
  },
});
