const {
  evaluateMacAutoUpdateCodeSignature,
  inspectMacAutoUpdateCodeSignature,
  parseCodesignDisplay,
  resolveMacAppBundlePath,
} = require('../macos-auto-update-signing.js');

describe('macOS auto-update signing guard', () => {
  it('accepts Developer ID signed apps with a team identifier', () => {
    const details = parseCodesignDisplay(`
Authority=Developer ID Application: ShekelSync, Inc. (ABCD123456)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=ABCD123456
`);

    expect(evaluateMacAutoUpdateCodeSignature(details)).toEqual({
      eligible: true,
      reason: null,
    });
  });

  it('rejects ad-hoc signed apps', () => {
    const details = parseCodesignDisplay(`
Executable=/Applications/ShekelSync.app/Contents/MacOS/ShekelSync
Identifier=com.shekelsync.finance
Format=app bundle with Mach-O thin (arm64)
Signature=adhoc
TeamIdentifier=not set
`);

    expect(evaluateMacAutoUpdateCodeSignature(details)).toEqual({
      eligible: false,
      reason:
        'macOS auto-update is disabled because this build is ad-hoc signed. Install a Developer ID signed release manually.',
    });
  });

  it('rejects signatures without a Developer ID Application authority', () => {
    const details = parseCodesignDisplay(`
Authority=Apple Development: Example Corp (ABCD123456)
TeamIdentifier=ABCD123456
`);

    expect(evaluateMacAutoUpdateCodeSignature(details)).toEqual({
      eligible: false,
      reason:
        'macOS auto-update is disabled because this build is not signed with a Developer ID Application certificate.',
    });
  });

  it('resolves the .app bundle path from the executable path', () => {
    expect(
      resolveMacAppBundlePath('/Applications/ShekelSync.app/Contents/MacOS/ShekelSync'),
    ).toBe('/Applications/ShekelSync.app');
  });

  it('inspects packaged mac apps using codesign output', () => {
    const result = inspectMacAutoUpdateCodeSignature({
      platform: 'darwin',
      isPackaged: true,
      executablePath: '/Applications/ShekelSync.app/Contents/MacOS/ShekelSync',
      runCodesign: () => ({
        success: true,
        output: `
Authority=Developer ID Application: ShekelSync, Inc. (ABCD123456)
TeamIdentifier=ABCD123456
`,
      }),
    });

    expect(result).toMatchObject({
      eligible: true,
      reason: null,
      bundlePath: '/Applications/ShekelSync.app',
    });
  });

  it('disables mac auto-update when signature inspection fails', () => {
    const result = inspectMacAutoUpdateCodeSignature({
      platform: 'darwin',
      isPackaged: true,
      executablePath: '/Applications/ShekelSync.app/Contents/MacOS/ShekelSync',
      runCodesign: () => ({
        success: false,
        error: 'codesign tool unavailable',
      }),
    });

    expect(result).toMatchObject({
      eligible: false,
      reason:
        'macOS auto-update is disabled because the app code signature could not be inspected: codesign tool unavailable',
      bundlePath: '/Applications/ShekelSync.app',
    });
  });
});
