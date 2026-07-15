/**
 * Legacy license guard compatibility shim.
 *
 * ShekelSync uses public, donation-supported access. Keep this middleware as a
 * pass-through so older route integrations cannot accidentally restore the
 * retired trial/read-only gate.
 */

// Retained for callers that inspect the former middleware API.
const PROTECTED_ROUTES = Object.freeze([]);
const EXEMPT_WRITE_ROUTES = Object.freeze([]);
const WRITE_METHODS = Object.freeze([]);

function isProtectedRoute() {
  return false;
}

async function getLicenseStatus() {
  return { isReadOnly: false };
}

function clearCache() {
  // The retired license guard no longer caches access decisions.
}

function licenseGuardMiddleware(_req, _res, next) {
  return next();
}

module.exports = {
  licenseGuardMiddleware,
  getLicenseStatus,
  clearCache,
  isProtectedRoute,
  PROTECTED_ROUTES,
  EXEMPT_WRITE_ROUTES,
  WRITE_METHODS,
};
