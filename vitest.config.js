export default {
  test: {
    // Test environment
    environment: 'node',

    // Include patterns
    include: [
      '**/__tests__/**/*.js',
      '**/?(*.)+(spec|test).js',
    ],

    // Exclude patterns
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/renderer/**',
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'app/lib/server/**/*.js',
        'app/server/**/*.js',
        'electron/**/*.js',
      ],
      exclude: [
        '**/__tests__/**',
        '**/node_modules/**',
        '**/coverage/**',
        '**/dist/**',
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 85,
        statements: 85,
      },
    },

    // Global setup
    setupFiles: ['./vitest.setup.js'],

    // Globals
    globals: true,

    // Clear mocks
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,

    // Timeout
    testTimeout: 10000,
  },
};
