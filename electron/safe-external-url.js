const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

/**
 * Guard for shell.openExternal with renderer-influenced URLs.
 * Only web links and mailto are allowed; anything else (file:, smb:,
 * javascript:, OS-registered custom protocol handlers, ...) is rejected so a
 * compromised renderer cannot launch arbitrary local handlers.
 */
function isSafeExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    return false;
  }

  return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol);
}

module.exports = {
  SAFE_EXTERNAL_PROTOCOLS,
  isSafeExternalUrl,
};
