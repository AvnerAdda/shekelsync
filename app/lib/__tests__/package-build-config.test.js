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
});
