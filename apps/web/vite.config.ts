import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // @decentralchain/waves-transactions ships without proper ESM entry —
      // point Vite at the UMD bundle so both dev and build can resolve it.
      '@decentralchain/waves-transactions': path.resolve(
        __dirname,
        'node_modules/@decentralchain/waves-transactions/dist/min/waves-transactions.min.js',
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
