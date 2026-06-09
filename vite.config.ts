import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    legacy({
      targets: ['defaults', 'not IE 11', 'Chrome >= 60', 'Firefox >= 60', 'Safari >= 12', 'Edge >= 79'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      modernPolyfills: true,
    }),
  ],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    // The app intentionally ships as a single-screen SPA with legacy browser support.
    // Keep the warning threshold aligned with the current split chunks so Vite still
    // reports genuinely outsized future bundles without flagging the expected entry.
    chunkSizeWarningLimit: 2500,
    rolldownOptions: {
      checks: {
        // The legacy plugin dominates production build time by design; this diagnostic
        // is useful when profiling, but too noisy for normal release builds.
        pluginTimings: false,
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'ui-vendor';
          }
        },
      },
    },
  },
});
