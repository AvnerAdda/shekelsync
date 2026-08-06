const appPackage = require('../../package.json');

function flattenMacTargets(targets = []) {
  return targets.map((entry) => {
    if (typeof entry === 'string') {
      return entry;
    }
    return entry?.target;
  });
}

describe('electron-builder mac target configuration', () => {
  it('includes zip alongside dmg so mac auto-update artifacts are published', () => {
    const macTargets = flattenMacTargets(appPackage.build?.mac?.target);

    expect(macTargets).toContain('dmg');
    expect(macTargets).toContain('zip');
  });

  it('fails closed on unsigned or unnotarized production mac builds', () => {
    expect(appPackage.build?.mac).toMatchObject({
      type: 'distribution',
      forceCodeSigning: true,
      hardenedRuntime: true,
      notarize: true,
    });
  });

  it('keeps diagnostic packaging explicitly unsigned and non-publishing', () => {
    const diagnosticScripts = [
      appPackage.scripts?.['dist:diagnostic'],
      appPackage.scripts?.pack,
    ];

    for (const script of diagnosticScripts) {
      expect(script).toContain('--config.mac.forceCodeSigning=false');
      expect(script).toContain('--config.mac.hardenedRuntime=false');
      expect(script).toContain('--config.mac.notarize=false');
      expect(script).not.toContain('--publish=always');
    }

    expect(appPackage.scripts?.release).toBe('npm run dist');
  });
});
