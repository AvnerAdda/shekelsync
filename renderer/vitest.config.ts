import { defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineProject({
  plugins: [react()],
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, '../app'),
      '@': path.resolve(__dirname, '../app'),
      '@renderer': path.resolve(__dirname, 'src'),
      '@mui/material': path.resolve(__dirname, '../app/node_modules/@mui/material'),
      '@mui/icons-material': path.resolve(__dirname, '../app/node_modules/@mui/icons-material'),
      '@mui/x-charts': path.resolve(__dirname, '../app/node_modules/@mui/x-charts'),
    },
    ssr: {
      noExternal: ['date-fns'],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: [
      'src/hooks/**/__tests__/**/*.{test,spec}.{ts,tsx}',
      'src/features/**/__tests__/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['tests/**', 'node_modules/**', 'src/components/**', 'src/routes/**', 'src/pages/**'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
