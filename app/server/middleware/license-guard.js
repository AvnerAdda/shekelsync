/**
 * License Guard Middleware
 *
 * Blocks write operations (POST, PUT, DELETE, PATCH) when the license
 * is in read-only mode (expired trial or offline grace expired).
 *
 * Uses a 5-minute cache to avoid checking license status on every request.
 * Fails open on database errors to avoid blocking users due to bugs.
 */

const { dialect } = require('../../lib/sql-dialect.js');
const database = require('../services/database.js');

// Cache for license status
let licenseStatusCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Trial period in days
const TRIAL_DAYS = 30;

// Protected routes that require write permission
const PROTECTED_ROUTES = [
  '/api/transactions',
  '/api/scrape',
  '/api/credentials',
  '/api/manual_transaction',
  '/api/categorization',
  '/api/budgets',
  '/api/investments',
  '/api/profile',
  '/api/accounts',
];

// HTTP methods that require write permission
const WRITE_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];

/**
 * Check if a route is protected and requires write permission.
 *
 * @param {string} path - Request path
 * @returns {boolean}
 */
function isProtectedRoute(path) {
  if (!path) return false;
  return PROTECTED_ROUTES.some(route =>
    path.startsWith(route) || path === route.slice(0, -1)
  );
}

/**
 * Get license status from database with caching.
 *
 * @returns {Promise<{isReadOnly: boolean, reason?: string}>}
 */
async function getLicenseStatus() {
  const now = Date.now();

  // Return cached value if still valid
  if (licenseStatusCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return licenseStatusCache;
  }

  try {
    const client = await database.getClient();

    try {
      const result = await client.query('SELECT * FROM license WHERE id = 1');

      if (result.rows.length === 0) {
        // No license registered - read-only mode
        licenseStatusCache = {
          isReadOnly: true,
          reason: 'No license registered',
        };
        cacheTimestamp = now;
        return licenseStatusCache;
      }

      const license = result.rows[0];

      // Pro license - always writable
      if (license.license_type === 'pro') {
        licenseStatusCache = { isReadOnly: false };
        cacheTimestamp = now;
        return licenseStatusCache;
      }

      // Check trial expiration
      const trialStart = new Date(license.trial_start_date);
      const trialEnd = new Date(trialStart);
      trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

      if (new Date() > trialEnd) {
        licenseStatusCache = {
          isReadOnly: true,
          reason: 'Trial period expired',
        };
        cacheTimestamp = now;
        return licenseStatusCache;
      }

      // Check offline grace period
      if (license.offline_grace_start) {
        const graceStart = new Date(license.offline_grace_start);
        const graceEnd = new Date(graceStart);
        graceEnd.setDate(graceEnd.getDate() + 7); // 7-day grace period

        if (new Date() > graceEnd) {
          licenseStatusCache = {
            isReadOnly: true,
            reason: 'Offline grace period expired',
          };
          cacheTimestamp = now;
          return licenseStatusCache;
        }
      }

      // Valid trial license
      licenseStatusCache = { isReadOnly: false };
      cacheTimestamp = now;
      return licenseStatusCache;

    } finally {
      client.release();
    }
  } catch (error) {
    // Fail open on database errors - don't block users due to bugs
    console.warn('[LicenseGuard] Failed to check license status:', error.message);
    return { isReadOnly: false };
  }
}

/**
 * Clear the license status cache.
 * Useful when license status changes (registration, activation, etc.)
 */
function clearCache() {
  licenseStatusCache = null;
  cacheTimestamp = 0;
}

/**
 * Express middleware to block write operations in read-only mode.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function licenseGuardMiddleware(req, res, next) {
  // Only check write methods
  if (!WRITE_METHODS.includes(req.method)) {
    return next();
  }

  // Only check protected routes
  if (!isProtectedRoute(req.path)) {
    return next();
  }

  try {
    const status = await getLicenseStatus();

    if (status.isReadOnly) {
      return res.status(403).json({
        success: false,
        error: 'License is in read-only mode',
        code: 'LICENSE_READ_ONLY',
        reason: status.reason,
        message: status.reason === 'Trial period expired'
          ? 'Your trial has expired. Upgrade to Pro to continue adding data.'
          : status.reason === 'No license registered'
            ? 'Please register to start your free trial.'
            : 'Please connect to the internet to validate your license.',
      });
    }

    next();
  } catch (error) {
    // Fail open on errors
    console.error('[LicenseGuard] Middleware error:', error);
    next();
  }
}

module.exports = {
  licenseGuardMiddleware,
  getLicenseStatus,
  clearCache,
  isProtectedRoute,
  // For testing
  PROTECTED_ROUTES,
  WRITE_METHODS,
};
