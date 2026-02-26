import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    testTimeout: 20_000,
    include: [
      '**/*.{test,spec}.{js,ts,jsx,tsx}',
      '../renderer/src/components/__tests__/**/*.{test,spec}.{js,ts,jsx,tsx}',
      '../electron/__tests__/**/*.{test,spec}.{js,ts,jsx,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'json-summary'],
      // Avoid intermittent ENOENT reads from coverage/.tmp during large runs.
      cleanOnRerun: false,
    },
    // Enable mocking for server-side modules
    deps: {
      interopDefault: true,
    },
    server: {
      deps: {
        inline: [/server\/services\/chat/, 'openai'],
        fallbackCJS: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@app': path.resolve(__dirname, '.'),
      '@renderer': path.resolve(__dirname, '../renderer/src'),
      '@mui/material': path.resolve(__dirname, 'node_modules/@mui/material'),
      '@mui/icons-material': path.resolve(__dirname, 'node_modules/@mui/icons-material'),
      '@testing-library/react': path.resolve(__dirname, 'node_modules/@testing-library/react'),
      '@testing-library/jest-dom': path.resolve(__dirname, 'node_modules/@testing-library/jest-dom'),
      'date-fns': path.resolve(__dirname, 'node_modules/date-fns'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom'),
    },
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  server: {
    fs: {
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, '..'),
        path.resolve(__dirname, '../renderer'),
      ],
    },
  },
});
