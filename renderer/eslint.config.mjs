import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';

export default [
  {
    // Mirrors the former .eslintignore: legacy renderer features are excluded
    // until their lint debt is addressed. Keep in sync when un-ignoring.
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/features/breakdown/**',
      'src/features/budgets/pages/**',
      'src/features/chatbot/**',
      'src/features/dashboard/**',
      'src/features/investments/**',
      'src/features/layout/**',
      'src/features/notifications/**',
      'src/features/settings/**',
      'src/features/shared/**',
      'src/features/website/**',
      'src/shared/**',
      '!src/shared/empty-state/LockedPagePlaceholder.tsx',
      'src/types/**',
      '!src/types/budget-intelligence.ts',
      '!src/types/quests.ts',
      '!src/types/spending-categories.ts',
      '!src/types/accounts.ts',
      'src/App.tsx',
      'src/main.tsx',
      'src/vite-env.d.ts',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  react.configs.flat.recommended,
  reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
  prettier,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      // React-Compiler-era advisory rules added by eslint-plugin-react-hooks
      // v7; not enforced pre-upgrade. Disabled to preserve the prior lint
      // contract (rules-of-hooks and exhaustive-deps stay on). Lint debt.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/static-components': 'off',
      'react/no-unescaped-entities': 'off',
      'prefer-const': 'off',
      'no-case-declarations': 'off',
      'no-constant-condition': 'off',
      'no-constant-binary-expression': 'off',
      'no-extra-boolean-cast': 'off',
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@mui/icons-material',
          message: 'Import icons from @mui/icons-material/<IconName> to avoid loading the full catalog.',
        }],
      }],
    },
  },
];
