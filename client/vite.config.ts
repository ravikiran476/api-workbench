import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // The browser-only build is hosted under a sub-path on GitHub Pages (/api-workbench/),
  // so it uses relative asset URLs. The server build is always served from the root.
  base: mode === 'standalone' ? './' : '/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
    },
  },
}));
