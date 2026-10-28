/**
 * In-memory holder for the resolved master encryption key.
 *
 * The key used to live in process.env, which every child process (Chromium helpers,
 * the scraper's Chrome, PowerShell helpers) inherits and which other same-user
 * processes can read from their environment. A process-global keeps it in memory only.
 * app/lib/server/encryption.js reads the same Symbol.for slot, so no module path is shared.
 */

const MASTER_KEY_SLOT = Symbol.for('shekelsync.masterEncryptionKey');
const ENV_KEY_NAME = 'SHEKELSYNC_ENCRYPTION_KEY';

function setMasterKey(hexKey, { source = 'keychain' } = {}) {
  globalThis[MASTER_KEY_SLOT] = { key: hexKey, source };
  // Never leave the key in the environment, where child processes inherit it.
  delete process.env[ENV_KEY_NAME];
}

function getMasterKey() {
  return globalThis[MASTER_KEY_SLOT]?.key || process.env[ENV_KEY_NAME] || null;
}

function getMasterKeySource() {
  if (globalThis[MASTER_KEY_SLOT]?.key) {
    return globalThis[MASTER_KEY_SLOT].source;
  }
  return process.env[ENV_KEY_NAME] ? 'environment' : null;
}

module.exports = {
  MASTER_KEY_SLOT,
  getMasterKey,
  getMasterKeySource,
  setMasterKey,
};
