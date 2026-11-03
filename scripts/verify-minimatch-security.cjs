const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Regression cases for GHSA-g3hv-75wg-m249. Exercise the installed code after
// postinstall, including nested copies and both module formats.
function verifyMatcher({ Minimatch }, label) {
  const pattern = Array(30).fill('**/../a/b').join('/');
  const bounded = new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 64 });
  assert.equal(bounded.set.length, 64, `${label}: generated pattern limit`);

  const normal = new Minimatch('**/../a/b/**/../c/d', { optimizationLevel: 2 });
  assert.equal(normal.set.length, 4, `${label}: ordinary expansion`);
  assert(normal.match('../a/b/../c/d'), `${label}: ordinary parent matching`);
  assert(normal.match('x/a/b/y/c/d'), `${label}: ordinary globstar matching`);

  const large = new Minimatch('{x,*}/{0..999}', { optimizationLevel: 2 });
  assert.equal(large.set.length, 2000, `${label}: skip quadratic pairwise work`);
  assert(large.match('x/5'), `${label}: literal matching`);
  assert(large.match('y/999'), `${label}: wildcard matching`);
  assert(!large.match('.y/5'), `${label}: dotfile behavior`);
  assert.equal(typeof normal.makeRe(), 'object', `${label}: legacy RegExp API`);
}

async function main() {
  let checked = 0;
  for (const scope of ['app', 'renderer']) {
    const root = path.resolve(__dirname, '..', scope);
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const copies = Object.entries(lock.packages).filter(([name]) => name.endsWith('/minimatch'));
    assert(copies.length > 0, `${scope}: no minimatch copies found`);
    for (const [location, entry] of copies) {
      const directory = path.join(root, location);
      const installed = require(path.join(directory, 'package.json'));
      assert.equal(installed.version, entry.version, `${scope}/${location}: lockfile version`);
      const matcher = require(directory);
      const major = Number(entry.version.split('.')[0]);
      if (major === 3 || major === 5) {
        // These versions do not implement the vulnerable preprocessing pass.
        assert.equal(matcher.Minimatch.prototype.firstPhasePreProcess, undefined);
      } else {
        assert(major === 9 || major === 10, `Review new minimatch major ${major}`);
        verifyMatcher(matcher, `${scope}/${location} CJS`);
        const esm = await import(pathToFileURL(path.join(directory, 'dist/esm/index.js')).href);
        verifyMatcher(esm, `${scope}/${location} ESM`);
      }
      checked += 1;
    }
  }
  console.log(`Verified ${checked} minimatch copies: backported guards and unaffected legacy APIs.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
