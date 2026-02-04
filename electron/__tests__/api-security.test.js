/**
 * Security Tests for API Security Middleware
 * Tests authentication, rate limiting, and security headers
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

const securityLogger = {
  logAuthSuccess: vi.fn(),
  logAuthFailure: vi.fn(),
  logRateLimitExceeded: vi.fn(),
};

describe('API Security', () => {
  let createToken;
  let validateToken;
  let revokeToken;
  let revokeAllTokens;
  let authenticationMiddleware;
  let rateLimitMiddleware;
  let securityHeadersMiddleware;
  let getTokenStats;

  beforeEach(async () => {
    vi.clearAllMocks();
    globalThis.__SHEKELSYNC_SECURITY_LOGGER__ = securityLogger;
    const apiSecurity = await import('../api-security.js');
    ({
      createToken,
      validateToken,
      revokeToken,
      revokeAllTokens,
      authenticationMiddleware,
      rateLimitMiddleware,
      securityHeadersMiddleware,
      getTokenStats,
    } = apiSecurity);
    revokeAllTokens(); // Clear tokens between tests
  });

  describe('Token Management', () => {
    test('should create valid token', () => {
      const token = createToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(20);
      expect(validateToken(token)).toBe(true);
    });

    test('should create unique tokens', () => {
      const token1 = createToken();
      const token2 = createToken();

      expect(token1).not.toBe(token2);
    });

    test('should validate existing token', () => {
      const token = createToken();
      expect(validateToken(token)).toBe(true);
    });

    test('should reject invalid token', () => {
      expect(validateToken('invalid-token')).toBe(false);
    });

    test('should reject null/undefined token', () => {
      expect(validateToken(null)).toBe(false);
      expect(validateToken(undefined)).toBe(false);
    });

    test('should revoke token', () => {
      const token = createToken();
      expect(validateToken(token)).toBe(true);

      revokeToken(token);
      expect(validateToken(token)).toBe(false);
    });

    test('should revoke all tokens', () => {
      const token1 = createToken();
      const token2 = createToken();

      expect(validateToken(token1)).toBe(true);
      expect(validateToken(token2)).toBe(true);

      revokeAllTokens();

      expect(validateToken(token1)).toBe(false);
      expect(validateToken(token2)).toBe(false);
    });
  });

  describe('Authentication Middleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        headers: {},
        path: '/api/credentials',
        method: 'GET',
      };
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      next = vi.fn();
    });

    test('should allow health check without auth', () => {
      req.path = '/health';

      authenticationMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should reject request without Authorization header', () => {
      authenticationMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Missing Authorization header',
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('should reject invalid Authorization format', () => {
      req.headers.authorization = 'InvalidFormat';

      authenticationMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid Authorization header format. Use: Bearer <token>',
      });
    });

    test('should reject invalid token', () => {
      req.headers.authorization = 'Bearer invalid-token';

      authenticationMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
      expect(securityLogger.logAuthFailure).toHaveBeenCalled();
    });

    test('should accept valid token', () => {
      const token = createToken();
      req.headers.authorization = `Bearer ${token}`;

      authenticationMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(req.apiToken).toBe(token);
    });

    test('should log auth success for sensitive endpoints', () => {
      const token = createToken();
      req.headers.authorization = `Bearer ${token}`;
      req.path = '/api/credentials';

      authenticationMiddleware(req, res, next);

      expect(securityLogger.logAuthSuccess).toHaveBeenCalledWith({
        path: '/api/credentials',
        method: 'GET',
      });
    });

    test('should not log auth success for non-sensitive endpoints', () => {
      const token = createToken();
      req.headers.authorization = `Bearer ${token}`;
      req.path = '/api/transactions';

      authenticationMiddleware(req, res, next);

      expect(securityLogger.logAuthSuccess).not.toHaveBeenCalled();
    });
  });

  describe('Rate Limiting Middleware', () => {
    let req, res, next;

    beforeEach(() => {
      const token = createToken();
      req = {
        path: '/api/credentials',
        method: 'GET',
        apiToken: token,
      };
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        set: vi.fn(),
      };
      next = vi.fn();
    });

    test('should allow requests within rate limit', () => {
      rateLimitMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'X-RateLimit-Limit': expect.any(String),
          'X-RateLimit-Remaining': expect.any(String),
          'X-RateLimit-Reset': expect.any(String),
        })
      );
    });

    test('should block requests exceeding rate limit', () => {
      // Make 31 requests (limit is 30 for credentials)
      for (let i = 0; i < 31; i++) {
        rateLimitMiddleware(req, res, next);
      }

      // Last request should be blocked
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Too Many Requests',
        })
      );
      expect(securityLogger.logRateLimitExceeded).toHaveBeenCalled();
    });

    test('should set Retry-After header when rate limited', () => {
      // Exceed rate limit
      for (let i = 0; i < 31; i++) {
        rateLimitMiddleware(req, res, next);
      }

      expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
    });

    test('should have different limits for different endpoints', () => {
      const token = createToken();

      // Credentials endpoint (30/min)
      const credReq = { ...req, path: '/api/credentials', apiToken: token };
      for (let i = 0; i < 30; i++) {
        rateLimitMiddleware(credReq, res, next);
      }
      expect(next).toHaveBeenCalledTimes(30);

      // Scraping endpoint (10/5min)
      next.mockClear();
      const scrapeReq = { ...req, path: '/api/scrape', apiToken: token };
      for (let i = 0; i < 10; i++) {
        rateLimitMiddleware(scrapeReq, res, next);
      }
      expect(next).toHaveBeenCalledTimes(10);
    });

    test('should allow health check without rate limiting', () => {
      req.path = '/health';
      delete req.apiToken;

      rateLimitMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('Security Headers Middleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = {};
      res = {
        set: vi.fn(),
      };
      next = vi.fn();
    });

    test('should set all security headers', () => {
      securityHeadersMiddleware(req, res, next);

      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'X-XSS-Protection': '1; mode=block',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Permissions-Policy': expect.stringContaining('geolocation=()'),
          'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        })
      );
      expect(next).toHaveBeenCalled();
    });

    test('should set CSP with proper directives', () => {
      securityHeadersMiddleware(req, res, next);

      const calls = res.set.mock.calls[0][0];
      const csp = calls['Content-Security-Policy'];

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("frame-src 'none'");
      expect(csp).toContain("object-src 'none'");
    });
  });

  describe('Token Statistics', () => {
    test('should return token statistics', () => {
      createToken();
      createToken();

      const stats = getTokenStats();

      expect(stats.activeTokens).toBe(2);
      expect(stats.tokens).toHaveLength(2);
      expect(stats.tokens[0]).toHaveProperty('token');
      expect(stats.tokens[0]).toHaveProperty('age');
      expect(stats.tokens[0]).toHaveProperty('lastUsed');
    });

    test('should truncate token in statistics', () => {
      createToken();

      const stats = getTokenStats();

      expect(stats.tokens[0].token).toMatch(/^.{8}\.\.\./);
      expect(stats.tokens[0].token.length).toBeLessThan(20);
    });
  });

  describe('Token Expiry', () => {
    test('should expire tokens after 24 hours', async () => {
      const token = createToken();

      // Mock Date to simulate time passing
      const originalNow = Date.now;
      const twentyFiveHoursLater = originalNow() + 25 * 60 * 60 * 1000;
      Date.now = vi.fn(() => twentyFiveHoursLater);

      expect(validateToken(token)).toBe(false);

      // Restore Date.now
      Date.now = originalNow;
    });
  });

  describe('Security - Token Generation Quality', () => {
    test('should generate cryptographically secure tokens', () => {
      const tokens = new Set();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        tokens.add(createToken());
      }

      // All tokens should be unique
      expect(tokens.size).toBe(iterations);
    });

    test('should not contain predictable patterns', () => {
      const token1 = createToken();
      const token2 = createToken();

      // Tokens should not be sequential or have obvious patterns
      expect(token1).not.toMatch(/^[0-9]+$/);
      expect(token2).not.toMatch(/^[0-9]+$/);
      expect(token1).not.toMatch(/(.)\1{5,}/); // No repeated characters
    });
  });
});
