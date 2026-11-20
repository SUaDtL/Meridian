import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative assets allow the same build to live at /diagrams/ or any Pages path.
export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      // React Refresh injects a development-only inline preamble. Production
      // keeps the strict external-script policy declared in index.html.
      return html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';").replace("connect-src 'self';", "connect-src 'self' ws: wss:;");
    },
  }],
  build: { target: 'es2022', chunkSizeWarningLimit: 1800, manifest: true, modulePreload: false },
  server: { allowedHosts: true },
});
