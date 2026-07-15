/**
 * License Guard Middleware
 *
 * Blocks write operations (POST, PUT, DELETE, PATCH) when the license
 * is in read-only mode (expired trial or offline grace expired).
 *
 * Uses a 5-minute cache to avoid checking license status on every request.
 * Fails open on database errors to avoid blocking users due to bugs.
 */

const database = require('../services/database.js');

// Cache for license status
let licenseStatusCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Trial period in days
const TRIAL_DAYS = 30;

// Mutating API requests are protected by default. Keep this exemption list
// deliberately small so new write routes cannot accidentally bypass read-only
// mode. Donations must remain available to restore access, chat remains usable
// without changing financial data, and biometric authentication is not a data
// mutation.
const EXEMPT_WRITE_ROUTES = [
  '/api/donations',
  '/api/chat',
  '/api/security/authenticate',
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
  if (typeof path !== 'string' || path.length === 0) return false;

  // Express routing is case-insensitive by default, and originalUrl includes
  // the query string. Normalize both so alternate casing or query parameters
  // cannot change the license decision.
  const requestPath = path.split(/[?#]/, 1)[0].toLowerCase();
  const isApiRoute = requestPath === '/api' || requestPath.startsWith('/api/');
  if (!isApiRoute) return false;

  const isExempt = EXEMPT_WRITE_ROUTES.some(route =>
    requestPath === route || requestPath.startsWith(`${route}/`)
  );
  return !isExempt;
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

      if (license.license_type === 'expired') {
        licenseStatusCache = {
          isReadOnly: true,
          reason: 'Trial period expired',
        };
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
  if (!isProtectedRoute(req.originalUrl || req.path)) {
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
  EXEMPT_WRITE_ROUTES,
  WRITE_METHODS,
};
