const crypto = require('crypto');
const securityLogger = globalThis.__SHEKELSYNC_SECURITY_LOGGER__ || require('./security-logger');
const { logAuthSuccess, logAuthFailure, logRateLimitExceeded } = securityLogger;

/**
 * API Security Middleware
 * Implements authentication and authorization for the internal Electron API server
 * Protects against unauthorized access from malicious local processes
 */

// Store of valid API tokens (in-memory, generated on app start)
const validTokens = new Set();
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const tokenMetadata = new Map(); // token -> { created, lastUsed }

// Rate limiting per endpoint
const rateLimitStore = new Map(); // token -> { endpoint -> { count, resetAt } }
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMITS = {
  '/api/credentials': { max: 30, window: RATE_LIMIT_WINDOW_MS },
  '/api/scrape': { max: 10, window: 5 * RATE_LIMIT_WINDOW_MS },
  '/api/transactions': { max: 100, window: RATE_LIMIT_WINDOW_MS },
  'default': { max: 200, window: RATE_LIMIT_WINDOW_MS },
};

/**
 * Generate a secure API token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Create a new API token (called from main process for renderer)
 */
function createToken() {
  const token = generateToken();
  validTokens.add(token);
  tokenMetadata.set(token, {
    created: Date.now(),
    lastUsed: Date.now(),
  });
  return token;
}

/**
 * Validate an API token
 */
function validateToken(token) {
  if (!token || typeof token !== 'string') {
    return false;
  }

  if (!validTokens.has(token)) {
    return false;
  }

  const metadata = tokenMetadata.get(token);
  if (!metadata) {
    return false;
  }

  // Check if token has expired
  const age = Date.now() - metadata.created;
  if (age > TOKEN_EXPIRY_MS) {
    validTokens.delete(token);
    tokenMetadata.delete(token);
    rateLimitStore.delete(token);
    return false;
  }

  // Update last used
  metadata.lastUsed = Date.now();
  return true;
}

/**
 * Revoke a token
 */
function revokeToken(token) {
  validTokens.delete(token);
  tokenMetadata.delete(token);
  rateLimitStore.delete(token);
}

/**
 * Revoke all tokens (e.g., on app restart)
 */
function revokeAllTokens() {
  validTokens.clear();
  tokenMetadata.clear();
  rateLimitStore.clear();
}

/**
 * Check rate limit for a token and endpoint
 */
function checkRateLimit(token, endpoint) {
  // Find matching rate limit config
  let limitConfig = RATE_LIMITS.default;
  for (const [pattern, config] of Object.entries(RATE_LIMITS)) {
    if (pattern !== 'default' && endpoint.startsWith(pattern)) {
      limitConfig = config;
      break;
    }
  }

  // Get or create rate limit entry for this token
  if (!rateLimitStore.has(token)) {
    rateLimitStore.set(token, new Map());
  }
  const tokenLimits = rateLimitStore.get(token);

  // Get or create entry for this endpoint
  const now = Date.now();
  let endpointLimit = tokenLimits.get(endpoint);

  if (!endpointLimit || now >= endpointLimit.resetAt) {
    // Create new or reset expired limit
    endpointLimit = {
      count: 0,
      resetAt: now + limitConfig.window,
    };
    tokenLimits.set(endpoint, endpointLimit);
  }

  // Check if limit exceeded
  if (endpointLimit.count >= limitConfig.max) {
    return {
      allowed: false,
      limit: limitConfig.max,
      remaining: 0,
      resetAt: endpointLimit.resetAt,
    };
  }

  // Increment counter
  endpointLimit.count++;

  return {
    allowed: true,
    limit: limitConfig.max,
    remaining: limitConfig.max - endpointLimit.count,
    resetAt: endpointLimit.resetAt,
  };
}

/**
 * Authentication middleware
 * Checks for valid API token in Authorization header
 */
function authenticationMiddleware(req, res, next) {
  // Skip auth for health check endpoints
  if (req.path === '/health' || req.path === '/healthz') {
    return next();
  }

  // Extract token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing Authorization header',
    });
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid Authorization header format. Use: Bearer <token>',
    });
  }

  // Validate token
  if (!validateToken(token)) {
    logAuthFailure({
      path: req.path,
      method: req.method,
      reason: 'Invalid or expired token',
    });

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }

  // Log successful authentication (only for sensitive endpoints)
  if (req.path.startsWith('/api/credentials') || req.path.startsWith('/api/scrape')) {
    logAuthSuccess({
      path: req.path,
      method: req.method,
    });
  }

  // Store token in request for rate limiting
  req.apiToken = token;
  next();
}

/**
 * Rate limiting middleware
 * Must be used after authentication middleware
 */
function rateLimitMiddleware(req, res, next) {
  // Skip rate limiting for health checks
  if (req.path === '/health' || req.path === '/healthz') {
    return next();
  }

  const token = req.apiToken;
  if (!token) {
    // Should not happen if auth middleware is working
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Rate limiting requires authentication',
    });
  }

  const result = checkRateLimit(token, req.path);

  // Set rate limit headers
  res.set({
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': new Date(result.resetAt).toISOString(),
  });

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    res.set('Retry-After', retryAfter.toString());

    logRateLimitExceeded({
      path: req.path,
      method: req.method,
      limit: result.limit,
      retryAfter,
    });

    return res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      retryAfter,
    });
  }

  next();
}

/**
 * Security headers middleware
 */
function securityHeadersMiddleware(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none';",
  });
  next();
}

/**
 * Get token statistics (for debugging)
 */
function getTokenStats() {
  return {
    activeTokens: validTokens.size,
    tokens: Array.from(tokenMetadata.entries()).map(([token, metadata]) => ({
      token: token.substring(0, 8) + '...', // Only show first 8 chars
      age: Date.now() - metadata.created,
      lastUsed: Date.now() - metadata.lastUsed,
    })),
  };
}

module.exports = {
  createToken,
  validateToken,
  revokeToken,
  revokeAllTokens,
  authenticationMiddleware,
  rateLimitMiddleware,
  securityHeadersMiddleware,
  getTokenStats,
};
