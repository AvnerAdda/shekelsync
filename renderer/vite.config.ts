import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, '../app'),
      '@': path.resolve(__dirname, '../app'),
      '@renderer': path.resolve(__dirname, 'src'),
      '@mui/material': path.resolve(__dirname, '../app/node_modules/@mui/material'),
      '@mui/icons-material': path.resolve(
        __dirname,
        '../app/node_modules/@mui/icons-material',
      ),
      '@mui/x-date-pickers': path.resolve(
        __dirname,
        '../app/node_modules/@mui/x-date-pickers',
      ),
      '@mui/x-charts': path.resolve(__dirname, '../app/node_modules/@mui/x-charts'),
      '@mui/styled-engine-sc': path.resolve(
        __dirname,
        '../app/node_modules/@mui/styled-engine-sc',
      ),
      '@emotion/react': path.resolve(__dirname, '../app/node_modules/@emotion/react'),
      '@emotion/styled': path.resolve(__dirname, '../app/node_modules/@emotion/styled'),
      'date-fns': path.resolve(__dirname, '../app/node_modules/date-fns'),
      '@fontsource/roboto': path.resolve(__dirname, '../app/node_modules/@fontsource/roboto'),
    },
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true, // Fail if port is already in use instead of trying another port
    fs: {
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, '..'),
        path.resolve(__dirname, '../app'),
        path.resolve(__dirname, '../app/node_modules'),
      ],
    },
  },
});
