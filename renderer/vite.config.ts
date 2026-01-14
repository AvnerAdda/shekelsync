import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const COMMONJS_EXPORTS = [
  'CREDIT_CARD_VENDORS',
  'BANK_VENDORS',
  'SPECIAL_BANK_VENDORS',
  'OTHER_BANK_VENDORS',
  'ALL_VENDORS',
  'STALE_SYNC_THRESHOLD_MS',
  'ACCOUNT_CATEGORIES',
  'INVESTMENT_ACCOUNT_TYPES',
  'getAccountCategory',
  'getAccountSubcategory',
  'getInstitutionByVendorCode',
  'getInstitutionById',
  'getInstitutionsByType',
  'getInstitutionsByCategory',
  'getScrapableInstitutions',
  'getAllInstitutions',
];

function commonjsToEsm(): Plugin {
  const constantsPath = path.resolve(__dirname, '../app/utils/constants.js');

  return {
    name: 'commonjs-to-esm',
    transform(code, id) {
      if (id === constantsPath) {
        const exportList = COMMONJS_EXPORTS.join(',\n  ');
        const transformed = `
const __cjs_module__ = { exports: {} };
const __cjs_exports__ = __cjs_module__.exports;
(function (module, exports) {
${code}
})(__cjs_module__, __cjs_exports__);

const {
  ${exportList}
} = __cjs_module__.exports;

export {
  ${exportList}
};

export default __cjs_module__.exports;
`;

        return { code: transformed, map: null };
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
  ssr: {
    noExternal: ['@mui/material', '@mui/system', '@mui/icons-material'],
  },
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, '../app'),
      '@': path.resolve(__dirname, '../app'),
      '@renderer': path.resolve(__dirname, 'src'),
      '@fontsource/roboto': path.resolve(__dirname, 'node_modules/@fontsource/roboto'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react-dom/client': path.resolve(__dirname, 'node_modules/react-dom/client'),
      'react-dom/test-utils': path.resolve(
        __dirname,
        'node_modules/react-dom/test-utils',
      ),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime'),
      'react/jsx-dev-runtime': path.resolve(
        __dirname,
        'node_modules/react/jsx-dev-runtime',
      ),
    },
    dedupe: [
      'react',
      'react-dom',
      '@mui/material',
      '@mui/system',
      '@emotion/react',
      '@emotion/styled',
    ],
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  optimizeDeps: {
    include: [
      '@app/utils/constants',
    ],
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
