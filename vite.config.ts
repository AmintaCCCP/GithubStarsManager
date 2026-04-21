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
  server: {
    proxy: {
      '/api/rss': {
        target: 'https://mshibanami.github.io/GitHubTrendingRSS',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/rss/, ''),
      },
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
    include: [
      'react',
      'react-dom',
      'zustand',
      'react-router-dom',
      'date-fns',
    ],
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'ui-vendor';
          }
          if (id.includes('node_modules/zustand')) {
            return 'zustand';
          }
          if (id.includes('node_modules/react-router-dom')) {
            return 'router';
          }
          if (id.includes('node_modules/date-fns')) {
            return 'date-fns';
          }
          if (id.includes('node_modules/react-markdown') || 
              id.includes('node_modules/rehype') || 
              id.includes('node_modules/remark')) {
            return 'markdown';
          }
          if (id.includes('node_modules/highlight.js')) {
            return 'highlight';
          }
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
    chunkSizeWarningLimit: 1000,
    reportCompressedSize: true,
  },
  css: {
    devSourcemap: false,
  },
});
