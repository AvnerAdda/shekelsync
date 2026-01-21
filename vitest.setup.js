/**
 * Vitest Setup File
 * Runs before each test suite
 */
import { beforeAll, afterAll, vi } from 'vitest';

// Set test environment
process.env.NODE_ENV = 'test';

// Disable keytar by default in tests (can be overridden in individual tests)
if (!process.env.KEYTAR_DISABLE) {
  process.env.KEYTAR_DISABLE = 'true';
}

// Global test utilities
global.testUtils = {
  // Generate random hex string of specified byte length
  randomHex: (bytes) => {
    const crypto = require('crypto');
    return crypto.randomBytes(bytes).toString('hex');
  },

  // Create a valid encryption key
  createValidKey: () => {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
  },

  // Create mock request object
  createMockRequest: (overrides = {}) => ({
    headers: {},
    path: '/api/test',
    method: 'GET',
    body: {},
    ...overrides,
  }),

  // Create mock response object
  createMockResponse: () => {
    const res = {
      statusCode: 200,
      headers: {},
    };
    res.status = vi.fn((code) => {
      res.statusCode = code;
      return res;
    });
    res.json = vi.fn((data) => {
      res.body = data;
      return res;
    });
    res.send = vi.fn((data) => {
      res.body = data;
      return res;
    });
    res.set = vi.fn((headers) => {
      Object.assign(res.headers, headers);
      return res;
    });
    return res;
  },

  // Create mock next function
  createMockNext: () => vi.fn(),

  // Wait for specified milliseconds
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// Console output helpers for cleaner test output
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// Suppress expected error/warn messages in tests
console.error = (...args) => {
  const message = args[0]?.toString() || '';

  // Suppress expected security test errors
  if (
    message.includes('[SECURITY]') ||
    message.includes('CRITICAL:') ||
    message.includes('Failed to decrypt') ||
    message.includes('Keychain error')
  ) {
    return;
  }

  originalConsoleError.apply(console, args);
};

console.warn = (...args) => {
  const message = args[0]?.toString() || '';

  // Suppress expected security test warnings
  if (
    message.includes('Using development fallback') ||
    message.includes('Removing legacy encryption key')
  ) {
    return;
  }

  originalConsoleWarn.apply(console, args);
};

// Restore console methods after all tests
afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});
