import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

// Plugin to transform CommonJS constants.js to ES6 for Vite
function commonjsToEsm(): Plugin {
  const constantsPath = path.resolve(__dirname, '../app/utils/constants.js');

  return {
    name: 'commonjs-to-esm',
    transform(code, id) {
      if (id === constantsPath) {
        // Read the .d.ts file to get the export names
        const dtsPath = id.replace('.js', '.d.ts');
        if (fs.existsSync(dtsPath)) {
          // Transform CommonJS module.exports to ES6 export
          // We append ES6 exports that reference module.exports
          const transformed = code + `\n\n// Auto-generated ES6 exports for Vite
export const CREDIT_CARD_VENDORS = module.exports.CREDIT_CARD_VENDORS;
export const BANK_VENDORS = module.exports.BANK_VENDORS;
export const SPECIAL_BANK_VENDORS = module.exports.SPECIAL_BANK_VENDORS;
export const OTHER_BANK_VENDORS = module.exports.OTHER_BANK_VENDORS;
export const ALL_VENDORS = module.exports.ALL_VENDORS;
export const STALE_SYNC_THRESHOLD_MS = module.exports.STALE_SYNC_THRESHOLD_MS;
export const ACCOUNT_CATEGORIES = module.exports.ACCOUNT_CATEGORIES;
export const INVESTMENT_ACCOUNT_TYPES = module.exports.INVESTMENT_ACCOUNT_TYPES;
export const getAccountCategory = module.exports.getAccountCategory;
export const getAccountSubcategory = module.exports.getAccountSubcategory;
export const getInstitutionByVendorCode = module.exports.getInstitutionByVendorCode;
export const getInstitutionById = module.exports.getInstitutionById;
export const getInstitutionsByType = module.exports.getInstitutionsByType;
export const getInstitutionsByCategory = module.exports.getInstitutionsByCategory;
export const getScrapableInstitutions = module.exports.getScrapableInstitutions;
export const getAllInstitutions = module.exports.getAllInstitutions;
`;
          return { code: transformed, map: null };
        }
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    commonjsToEsm(),
  ],
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
      '@sentry/electron': path.resolve(__dirname, '../app/node_modules/@sentry/electron'),
    },
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  optimizeDeps: {
    include: ['@app/utils/constants'],
    esbuildOptions: {
      mainFields: ['module', 'main'],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true, // Fail if port is already in use instead of trying another port
    proxy: {
      '/api': {
        target: process.env.ELECTRON_API_URL || 'http://localhost:44373',
        changeOrigin: true,
        secure: false,
      },
    },
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
