import { describe, expect, it } from 'vitest';

import {
  WINDOWS_11_MIN_BUILD,
  getWindowsBuildNumber,
  getMainWindowAppearanceOptions,
  shouldUseTransparentMainWindow,
  supportsNativeFramelessRoundedCorners,
} from '../window-appearance.js';

describe('window appearance', () => {
  it('parses Windows build numbers from kernel releases', () => {
    expect(getWindowsBuildNumber('10.0.22631')).toBe(22631);
    expect(getWindowsBuildNumber('10.0.19045')).toBe(19045);
    expect(getWindowsBuildNumber('10.0')).toBeNull();
    expect(getWindowsBuildNumber('invalid')).toBeNull();
  });

  it('detects native frameless rounded corners on Windows 11 and macOS only', () => {
    expect(supportsNativeFramelessRoundedCorners('darwin')).toBe(true);
    expect(supportsNativeFramelessRoundedCorners('linux')).toBe(false);
    expect(supportsNativeFramelessRoundedCorners('win32', `10.0.${WINDOWS_11_MIN_BUILD}`)).toBe(true);
    expect(supportsNativeFramelessRoundedCorners('win32', '10.0.19045')).toBe(false);
  });

  it('disables transparent mode on Windows 11 to preserve native rounded corners', () => {
    expect(
      shouldUseTransparentMainWindow({
        platform: 'win32',
        release: '10.0.22631',
        reduceVisualEffects: false,
      }),
    ).toBe(false);
  });

  it('keeps the transparent fallback on Linux and older Windows builds', () => {
    expect(
      shouldUseTransparentMainWindow({
        platform: 'linux',
        reduceVisualEffects: false,
      }),
    ).toBe(true);
    expect(
      shouldUseTransparentMainWindow({
        platform: 'win32',
        release: '10.0.19045',
        reduceVisualEffects: false,
      }),
    ).toBe(true);
  });

  it('builds opaque window options for Windows 11 when dark mode is enabled', () => {
    expect(
      getMainWindowAppearanceOptions({
        platform: 'win32',
        release: '10.0.22631',
        reduceVisualEffects: false,
        shouldUseDarkColors: true,
      }),
    ).toEqual({
      backgroundColor: '#0a0a0a',
      transparent: false,
      roundedCorners: true,
    });
  });

  it('preserves the transparent fallback for Linux', () => {
    expect(
      getMainWindowAppearanceOptions({
        platform: 'linux',
        reduceVisualEffects: false,
        shouldUseDarkColors: true,
      }),
    ).toEqual({
      backgroundColor: '#00000000',
      transparent: true,
      roundedCorners: false,
    });
  });

  it('preserves the existing macOS visual-effects override behavior', () => {
    expect(
      getMainWindowAppearanceOptions({
        platform: 'darwin',
        reduceVisualEffects: false,
        shouldUseDarkColors: false,
      }),
    ).toEqual({
      backgroundColor: '#00000000',
      transparent: true,
      roundedCorners: true,
    });
  });
});
