import { describe, expect, it } from 'vitest';

import { isSafeExternalUrl } from '../safe-external-url.js';

describe('isSafeExternalUrl', () => {
  it('allows web and mailto URLs', () => {
    expect(isSafeExternalUrl('https://example.com/docs')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:3000/help')).toBe(true);
    expect(isSafeExternalUrl('mailto:support@example.com')).toBe(true);
  });

  it('rejects protocols that can launch local handlers', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('smb://attacker/share')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('vscode://malicious/payload')).toBe(false);
    expect(isSafeExternalUrl('ms-msdt:/id PCWDiagnostic')).toBe(false);
  });

  it('rejects malformed and non-string input', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl(undefined)).toBe(false);
    expect(isSafeExternalUrl(42)).toBe(false);
  });
});
