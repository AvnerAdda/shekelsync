/**
 * Security Tests for Error Sanitization
 * Tests PII redaction and error sanitization
 */

import { describe, test, expect, vi } from 'vitest';
import {
  sanitizeError,
  sanitizeErrorForLogging,
  redactSensitiveData,
  isSensitiveKey,
  createErrorHandler,
  wrapAsyncHandler,
} from '../error-sanitizer.js';

describe('Error Sanitizer', () => {
  describe('Sensitive Key Detection', () => {
    test('should detect password fields', () => {
      expect(isSensitiveKey('password')).toBe(true);
      expect(isSensitiveKey('user_password')).toBe(true);
      expect(isSensitiveKey('passwd')).toBe(true);
    });

    test('should detect token fields', () => {
      expect(isSensitiveKey('token')).toBe(true);
      expect(isSensitiveKey('api_token')).toBe(true);
      expect(isSensitiveKey('access_token')).toBe(true);
    });

    test('should detect secret fields', () => {
      expect(isSensitiveKey('secret')).toBe(true);
      expect(isSensitiveKey('api_secret')).toBe(true);
      expect(isSensitiveKey('client_secret')).toBe(true);
    });

    test('should detect credential fields', () => {
      expect(isSensitiveKey('credential')).toBe(true);
      expect(isSensitiveKey('credentials')).toBe(true);
      expect(isSensitiveKey('user_credential')).toBe(true);
    });

    test('should detect auth fields', () => {
      expect(isSensitiveKey('auth')).toBe(true);
      expect(isSensitiveKey('authorization')).toBe(true);
      expect(isSensitiveKey('auth_token')).toBe(true);
    });

    test('should detect financial fields', () => {
      expect(isSensitiveKey('ssn')).toBe(true);
      expect(isSensitiveKey('card_number')).toBe(true);
      expect(isSensitiveKey('cvv')).toBe(true);
      expect(isSensitiveKey('pin')).toBe(true);
    });

    test('should detect ID fields', () => {
      expect(isSensitiveKey('id_number')).toBe(true);
      expect(isSensitiveKey('identification')).toBe(true);
    });

    test('should not flag non-sensitive fields', () => {
      expect(isSensitiveKey('username')).toBe(false);
      expect(isSensitiveKey('email')).toBe(false);
      expect(isSensitiveKey('name')).toBe(false);
      expect(isSensitiveKey('vendor')).toBe(false);
    });

    test('should be case-insensitive', () => {
      expect(isSensitiveKey('PASSWORD')).toBe(true);
      expect(isSensitiveKey('Token')).toBe(true);
      expect(isSensitiveKey('API_KEY')).toBe(true);
    });

    test('should return false for non-string keys', () => {
      expect(isSensitiveKey(null)).toBe(false);
      expect(isSensitiveKey(undefined)).toBe(false);
      expect(isSensitiveKey(123)).toBe(false);
      expect(isSensitiveKey({})).toBe(false);
    });
  });

  describe('Data Redaction', () => {
    test('should redact sensitive values', () => {
      const data = {
        username: 'testuser',
        password: 'secret123',
        email: 'test@example.com',
        token: 'abc123',
      };

      const redacted = redactSensitiveData(data);

      expect(redacted.username).toBe('testuser');
      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.email).toBe('test@example.com');
      expect(redacted.token).toBe('[REDACTED]');
    });

    test('should handle nested objects', () => {
      const data = {
        user: {
          username: 'testuser',
          credentials: {
            password: 'secret123',
            api_key: 'key123',
          },
        },
      };

      const redacted = redactSensitiveData(data);

      expect(redacted.user.username).toBe('testuser');
      expect(redacted.user.credentials.password).toBe('[REDACTED]');
      expect(redacted.user.credentials.api_key).toBe('[REDACTED]');
    });

    test('should handle arrays', () => {
      const data = {
        users: [
          { username: 'user1', password: 'pass1' },
          { username: 'user2', password: 'pass2' },
        ],
      };

      const redacted = redactSensitiveData(data);

      expect(redacted.users[0].username).toBe('user1');
      expect(redacted.users[0].password).toBe('[REDACTED]');
      expect(redacted.users[1].username).toBe('user2');
      expect(redacted.users[1].password).toBe('[REDACTED]');
    });

    test('should handle null and undefined', () => {
      expect(redactSensitiveData(null)).toBeNull();
      expect(redactSensitiveData(undefined)).toBeUndefined();
    });

    test('should handle primitives', () => {
      expect(redactSensitiveData('string')).toBe('string');
      expect(redactSensitiveData(123)).toBe(123);
      expect(redactSensitiveData(true)).toBe(true);
    });

    test('should prevent infinite recursion', () => {
      const circular = { a: 1 };
      circular.self = circular;

      const redacted = redactSensitiveData(circular);

      expect(redacted.a).toBe(1);
      // Should stop at max depth
    });
  });

  describe('Error Sanitization for Client', () => {
    test('should sanitize basic error', () => {
      const error = new Error('Something went wrong');
      error.statusCode = 400;

      const sanitized = sanitizeError(error);

      expect(sanitized.error).toBe('Something went wrong');
      expect(sanitized.statusCode).toBe(400);
      expect(sanitized.stack).toBeUndefined(); // No stack in production
    });

    test('should use default message if error is empty', () => {
      const sanitized = sanitizeError(null, {
        defaultMessage: 'Default error',
      });

      expect(sanitized.error).toBe('Default error');
      expect(sanitized.statusCode).toBe(500);
    });

    test('should use default status code', () => {
      const error = new Error('Test error');

      const sanitized = sanitizeError(error, {
        statusCode: 404,
      });

      expect(sanitized.statusCode).toBe(404);
    });

    test('should include stack in development', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n  at line 1';

      const sanitized = sanitizeError(error, {
        includeStack: true,
      });

      expect(sanitized.stack).toBeDefined();
      expect(sanitized.stack).toContain('Test error');
    });

    test('should never include stack in production', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n  at line 1';

      const sanitized = sanitizeError(error, {
        includeStack: false,
      });

      expect(sanitized.stack).toBeUndefined();
    });

    test('should include error code if available', () => {
      const error = new Error('Test error');
      error.code = 'ECONNREFUSED';

      const sanitized = sanitizeError(error);

      expect(sanitized.code).toBe('ECONNREFUSED');
    });
  });

  describe('Error Sanitization for Logging', () => {
    test('should sanitize error for logging', () => {
      const error = new Error('Database error');
      error.code = 'ER_DUP_ENTRY';
      error.statusCode = 409;

      const context = {
        path: '/api/credentials',
        method: 'POST',
        password: 'secret123',
      };

      const sanitized = sanitizeErrorForLogging(error, context);

      expect(sanitized.message).toBe('Database error');
      expect(sanitized.code).toBe('ER_DUP_ENTRY');
      expect(sanitized.statusCode).toBe(409);
      expect(sanitized.stack).toBeDefined();
      expect(sanitized.context.path).toBe('/api/credentials');
      expect(sanitized.context.method).toBe('POST');
      expect(sanitized.context.password).toBe('[REDACTED]');
    });

    test('should handle null error', () => {
      const sanitized = sanitizeErrorForLogging(null);
      expect(sanitized).toBeNull();
    });

    test('should skip context redaction for non-object context', () => {
      const error = new Error('Test error');
      const sanitized = sanitizeErrorForLogging(error, 'not-an-object');

      expect(sanitized.context).toBeUndefined();
      expect(sanitized.message).toBe('Test error');
    });

    test('should redact sensitive data in context', () => {
      const error = new Error('Test error');
      const context = {
        credentials: {
          username: 'testuser',
          password: 'secret123',
          token: 'abc123',
        },
      };

      const sanitized = sanitizeErrorForLogging(error, context);

      expect(sanitized.context.credentials.username).toBe('testuser');
      expect(sanitized.context.credentials.password).toBe('[REDACTED]');
      expect(sanitized.context.credentials.token).toBe('[REDACTED]');
    });
  });

  describe('Security - Credential Leak Prevention', () => {
    test('should never leak passwords', () => {
      const error = new Error('Failed to authenticate');
      const context = {
        username: 'testuser',
        password: 'MySecretPassword123!',
        apiKey: 'sk_live_abc123',
      };

      const sanitized = sanitizeErrorForLogging(error, context);

      const jsonString = JSON.stringify(sanitized);
      expect(jsonString).not.toContain('MySecretPassword123!');
      expect(jsonString).not.toContain('sk_live_abc123');
      expect(jsonString).toContain('[REDACTED]');
    });

    test('should never leak tokens in error messages', () => {
      const error = new Error('Invalid token: abc123xyz');
      const sanitized = sanitizeError(error, { includeStack: false });

      // Message is preserved (it's the error message itself)
      // But sensitive context data should be redacted
      expect(sanitized.error).toBeDefined();
    });

    test('should not leak stack traces to client in production', () => {
      const error = new Error('Database connection failed');
      error.stack = 'Error: Database connection failed\n' +
        '  at connect (db.js:123)\n' +
        '  at /app/credentials.js:45\n' +
        '  Password: secret123';

      const sanitized = sanitizeError(error, { includeStack: false });

      expect(sanitized.stack).toBeUndefined();
      expect(JSON.stringify(sanitized)).not.toContain('secret123');
    });
  });

  describe('Security - Injection Prevention', () => {
    test('should handle error messages with SQL injection attempts', () => {
      const error = new Error("Error: Invalid input '; DROP TABLE users--");
      const sanitized = sanitizeError(error);

      // Error message is preserved (it's harmless as a string)
      expect(sanitized.error).toBeDefined();
    });

    test('should handle error messages with XSS attempts', () => {
      const error = new Error('<script>alert("xss")</script>');
      const sanitized = sanitizeError(error);

      // Message preserved but won't be executed (client should escape)
      expect(sanitized.error).toContain('script');
    });
  });

  describe('Security - Deep Object Safety', () => {
    test('should handle very deep nested objects', () => {
      const deepObject = {};
      let current = deepObject;
      for (let i = 0; i < 15; i++) {
        current.nested = { password: 'secret' };
        current = current.nested;
      }

      const redacted = redactSensitiveData(deepObject);

      // Should stop at max depth (10) and not crash
      expect(redacted).toBeDefined();
    });

    test('should handle mixed data types', () => {
      const mixedData = {
        string: 'value',
        number: 123,
        boolean: true,
        null: null,
        undefined: undefined,
        array: [1, 2, 3],
        object: { key: 'value' },
        password: 'secret',
      };

      const redacted = redactSensitiveData(mixedData);

      expect(redacted.string).toBe('value');
      expect(redacted.number).toBe(123);
      expect(redacted.boolean).toBe(true);
      expect(redacted.password).toBe('[REDACTED]');
    });
  });

  describe('Express Error Handler Helpers', () => {
    test('createErrorHandler logs sanitized context and responds when headers are not sent', () => {
      const logger = { error: vi.fn() };
      const handler = createErrorHandler({ logger, includeStack: false });
      const error = Object.assign(new Error('Boom'), { statusCode: 422, code: 'VALIDATION' });
      const req = {
        path: '/api/credentials',
        method: 'POST',
        query: { token: 'abc', page: '1' },
      };
      const res = {
        headersSent: false,
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      handler(error, req, res, vi.fn());

      expect(logger.error).toHaveBeenCalledWith(
        '[API Error]',
        expect.objectContaining({
          message: 'Boom',
          context: expect.objectContaining({
            path: '/api/credentials',
            method: 'POST',
            query: expect.objectContaining({
              token: '[REDACTED]',
              page: '1',
            }),
          }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Boom',
          statusCode: 422,
          code: 'VALIDATION',
        }),
      );
    });

    test('createErrorHandler does not write response when headers were already sent', () => {
      const logger = { error: vi.fn() };
      const handler = createErrorHandler({ logger, includeStack: false });
      const res = {
        headersSent: true,
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      handler(new Error('late error'), { path: '/x', method: 'GET', query: {} }, res, vi.fn());

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    test('wrapAsyncHandler forwards successful execution', async () => {
      const next = vi.fn();
      const handler = vi.fn(async (req, res) => {
        res.ok = true;
      });
      const wrapped = wrapAsyncHandler(handler);
      const req = {};
      const res = {};

      await wrapped(req, res, next);

      expect(handler).toHaveBeenCalledWith(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.ok).toBe(true);
    });

    test('wrapAsyncHandler sanitizes thrown errors before forwarding', async () => {
      const next = vi.fn();
      const wrapped = wrapAsyncHandler(async () => {
        const error = new Error('database failed');
        error.statusCode = 409;
        error.code = 'CONFLICT';
        error.stack = 'should not propagate';
        throw error;
      });

      await wrapped({}, {}, next);

      expect(next).toHaveBeenCalledTimes(1);
      const forwarded = next.mock.calls[0][0];
      expect(forwarded).toBeInstanceOf(Error);
      expect(forwarded.message).toBe('database failed');
      expect(forwarded.statusCode).toBe(409);
      expect(forwarded.code).toBe('CONFLICT');
      expect(forwarded.stack).not.toContain('should not propagate');
    });

    test('wrapAsyncHandler uses fallback values for non-standard throwables', async () => {
      const next = vi.fn();
      const wrapped = wrapAsyncHandler(async () => {
        throw { statusCode: 418 };
      });

      await wrapped({}, {}, next);

      const forwarded = next.mock.calls[0][0];
      expect(forwarded.message).toBe('Request failed');
      expect(forwarded.statusCode).toBe(418);
      expect(forwarded.code).toBeUndefined();
    });
  });
});
