/**
 * Canonical access policy for the donation-supported public build.
 *
 * `licenseType: 'pro'` is retained for compatibility with existing renderer
 * types; it represents unrestricted access and does not require registration.
 */
const PUBLIC_ACCESS_STATUS = Object.freeze({
  registered: true,
  licenseType: 'pro',
  isReadOnly: false,
  canWrite: true,
  offlineMode: false,
  syncedToCloud: true,
});

function getPublicAccessStatus() {
  return { ...PUBLIC_ACCESS_STATUS };
}

function isPublicWriteAllowed() {
  return true;
}

module.exports = {
  PUBLIC_ACCESS_STATUS,
  getPublicAccessStatus,
  isPublicWriteAllowed,
};
