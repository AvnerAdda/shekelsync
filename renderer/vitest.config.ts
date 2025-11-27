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
      '@mui/material': path.resolve(__dirname, 'node_modules/@mui/material'),
      '@mui/icons-material': path.resolve(__dirname, 'node_modules/@mui/icons-material'),
      '@mui/x-charts': path.resolve(__dirname, 'node_modules/@mui/x-charts'),
      '@mui/x-date-pickers': path.resolve(__dirname, 'node_modules/@mui/x-date-pickers'),
      '@mui/styled-engine-sc': path.resolve(__dirname, 'node_modules/@mui/styled-engine-sc'),
      '@mui/system': path.resolve(__dirname, 'node_modules/@mui/system'),
      '@emotion/react': path.resolve(__dirname, 'node_modules/@emotion/react'),
      '@emotion/styled': path.resolve(__dirname, 'node_modules/@emotion/styled'),
      '@fontsource/roboto': path.resolve(__dirname, 'node_modules/@fontsource/roboto'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react-dom/client': path.resolve(__dirname, 'node_modules/react-dom/client'),
      'react-dom/test-utils': path.resolve(__dirname, 'node_modules/react-dom/test-utils'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime'),
    },
    dedupe: ['react', 'react-dom'],
    ssr: {
      noExternal: ['date-fns'],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    server: {
      deps: {
        inline: [
          'react',
          'react-dom',
          '@mui/material',
          '@mui/icons-material',
          '@mui/x-date-pickers',
          '@mui/x-charts',
          '@mui/system',
          '@emotion/react',
          '@emotion/styled',
        ],
      },
    },
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
