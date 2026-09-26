import { defineConfig } from 'vite';

// Weight discipline, no quality cost:
//  - terser with 2 passes beats esbuild's default minifier on a bundle this size
//  - esnext target: stop downlevelling syntax every browser since 2021 supports
//  - manualChunks: the 1.2MB engine changes far less often than our game code,
//    so a tweak does not invalidate the whole cached vendor blob
//  - no sourcemaps in the build (they were never on) and no legacy polyfills
export default defineConfig({
  server: { port: 5173 },
  build: {
    target: 'esnext',
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2, drop_debugger: true, unsafe_math: true, pure_getters: true },
      format: { comments: false },
    },
    cssCodeSplit: true,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('phaser')) return 'phaser';
            if (id.includes('colyseus')) return 'net';
          }
          return undefined;
        },
      },
    },
  },
});
