const os = require('os');

const WINDOWS_11_MIN_BUILD = 22000;
const TRANSPARENT_WINDOW_BG = '#00000000';
const OPAQUE_WINDOW_BG_DARK = '#0a0a0a';
const OPAQUE_WINDOW_BG_LIGHT = '#f8fef9';

function getWindowsBuildNumber(release = os.release()) {
  if (typeof release !== 'string') {
    return null;
  }

  const segments = release.split('.');
  if (segments.length < 3) {
    return null;
  }

  const build = Number.parseInt(segments[2], 10);
  return Number.isFinite(build) ? build : null;
}

function supportsNativeFramelessRoundedCorners(platform = process.platform, release = os.release()) {
  if (platform === 'darwin') {
    return true;
  }

  if (platform !== 'win32') {
    return false;
  }

  const build = getWindowsBuildNumber(release);
  return build !== null && build >= WINDOWS_11_MIN_BUILD;
}

function shouldUseTransparentMainWindow({
  platform = process.platform,
  release = os.release(),
  reduceVisualEffects = false,
} = {}) {
  if (reduceVisualEffects) {
    return false;
  }

  // Windows 11 can provide native rounded corners for frameless windows, but
  // transparent/per-pixel-alpha windows fall off that native path.
  if (platform === 'win32' && supportsNativeFramelessRoundedCorners(platform, release)) {
    return false;
  }

  // Linux does not have a native Electron frameless rounded-corner path, so it
  // stays on the transparent/CSS fallback when visual effects are enabled.
  return true;
}

function getMainWindowAppearanceOptions({
  platform = process.platform,
  release = os.release(),
  reduceVisualEffects = false,
  shouldUseDarkColors = false,
} = {}) {
  const transparent = shouldUseTransparentMainWindow({
    platform,
    release,
    reduceVisualEffects,
  });

  return {
    backgroundColor: transparent
      ? TRANSPARENT_WINDOW_BG
      : shouldUseDarkColors
        ? OPAQUE_WINDOW_BG_DARK
        : OPAQUE_WINDOW_BG_LIGHT,
    transparent,
    roundedCorners: supportsNativeFramelessRoundedCorners(platform, release),
  };
}

module.exports = {
  WINDOWS_11_MIN_BUILD,
  getWindowsBuildNumber,
  supportsNativeFramelessRoundedCorners,
  shouldUseTransparentMainWindow,
  getMainWindowAppearanceOptions,
};
