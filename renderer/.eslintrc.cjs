module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'jsx-a11y'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
    'prettier',
  ],
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
    'react-hooks/set-state-in-effect': 'off',
    'react-hooks/preserve-manual-memoization': 'off',
    'react/no-unescaped-entities': 'off',
    'prefer-const': 'off',
    'no-case-declarations': 'off',
    'no-constant-condition': 'off',
    'no-constant-binary-expression': 'off',
    'no-extra-boolean-cast': 'off',
  },
};
