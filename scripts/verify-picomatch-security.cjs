const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FORK_NAME = '@shekelsync/picomatch';
const FORK_VERSION = '4.0.7-shekelsync.2';
const FIXED_ADVISORY = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';

function verifyMatcher(directory) {
  const matcher = require(directory);
  const posix = require(path.join(directory, 'posix.js'));
  const utils = require(path.join(directory, 'lib/utils.js'));
  assert.equal(utils.removeBackslashes('['.repeat(100000)), '['.repeat(100000), 'unmatched brackets must finish promptly');
  assert.equal(utils.removeBackslashes('a\\*b/[a\\-z]/tail\\'), 'a*b/[a\\-z]/tail\\', 'escaped characters and protected classes');
  for (const pm of [matcher, posix]) {
    assert(pm('**/*.js')('src/example.js'), 'globstar');
    assert(!pm('**/*.js')('src/example.ts'), 'extension filtering');
    assert(pm('*.{js,ts}')('example.ts'), 'brace alternatives');
    assert(pm('**/!(*.test).js')('src/example.js'), 'negated extglob');
    assert(!pm('**/!(*.test).js')('src/example.test.js'), 'negated extglob exclusion');
    assert(!pm('**/*.js', { ignore: '**/tests/**' })('src/tests/example.js'), 'ignore');
    assert(pm('+(foo)')('foofoo'), 'literal single-branch repeat');
    assert(pm('+(foo|bar)')('foobar'), 'multi-branch repeat');
    assert(pm('+(*(a))')('aaaa'), 'linear rewrite of a nested character repeat');
    assert(pm('+(*(a)|*(b))')('ababa'), 'linear rewrite retains every alternative');
    assert(pm('src/*.js', { windows: true })('src\\example.js'), 'Windows separators');
    assert(!pm('*.js')('.hidden.js'), 'default dotfile behavior');
    assert(pm('*.js', { dot: true })('.hidden.js'), 'explicit dotfile behavior');

    const input = `${'a'.repeat(20000)}!`;
    for (const options of [{}, { fastpaths: false }, { maxExtglobRecursion: false }, { capture: true }]) {
      for (const pattern of ['+(*a)', '+(*)a', '*(a*)', '+(@(*a))', '+([a-z]*)', '+([[]*)', '+(a?(a))']) {
        assert(!pm(pattern, options)(input), `${pattern}: matcher must reject promptly`);
        assert(!pm.makeRe(pattern, options).test(input), `${pattern}: makeRe must reject promptly`);
        assert(!pm.compileRe(pm.parse(pattern, options), options).test(input), `${pattern}: parse/compileRe`);
      }
    }
    assert(pm('+(*a)')('+(*a)'), 'unsafe patterns use the existing literal fallback');
  }
}

function verifyCopies(root = ROOT) {
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'vendor/picomatch/UPSTREAM.json'), 'utf8'));
  assert.equal(provenance.name, 'picomatch');
  assert.equal(provenance.version, '4.0.7');
  assert.equal(provenance.fork.name, FORK_NAME);
  assert.equal(provenance.fork.version, FORK_VERSION);
  assert.deepEqual(Object.keys(provenance.files).sort(), [
    'index.js', 'lib/constants.js', 'lib/parse.js', 'lib/picomatch.js',
    'lib/scan.js', 'lib/utils.js', 'posix.js',
  ], 'every runtime source fingerprint is required');
  let checked = 0;

  for (const scope of ['app', 'renderer']) {
    const project = path.join(root, scope);
    const lock = JSON.parse(fs.readFileSync(path.join(project, 'package-lock.json'), 'utf8'));
    const copies = Object.entries(lock.packages).filter(([location]) => location.endsWith('/picomatch'));
    assert(copies.length > 0, `${scope}: no picomatch copies found`);
    for (const [location, entry] of copies) {
      const directory = path.join(project, location);
      const installed = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
      assert.equal(entry.name, FORK_NAME, `${scope}/${location}: unexpected registry copy`);
      assert.equal(entry.version, FORK_VERSION, `${scope}/${location}: lockfile version`);
      assert.equal(installed.name, FORK_NAME, `${scope}/${location}: installed package name`);
      assert.equal(installed.version, FORK_VERSION, `${scope}/${location}: installed package version`);
      assert(!fs.lstatSync(directory).isSymbolicLink(), `${scope}/${location}: install a package copy, not a vendor symlink`);
      for (const [filename, expected] of Object.entries(provenance.files)) {
        const actual = createHash('sha256').update(fs.readFileSync(path.join(directory, filename))).digest('hex');
        assert.equal(actual, expected, `${scope}/${location}/${filename}: reviewed source fingerprint`);
      }
      // An unpatched matcher can hang the event loop. A separate process gives
      // the regression a hard deadline even when the expression backtracks.
      const result = spawnSync(process.execPath, [__filename, '--probe', directory], {
        encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${scope}/${location}: ${result.stderr || result.signal}`);
      checked += 1;
    }
  }
  return checked;
}

function checkUpstreamAdvisories(report) {
  assert(report && typeof report === 'object' && !Array.isArray(report), 'invalid advisory response');
  assert(Object.keys(report).every(name => name === 'picomatch'), 'unexpected advisory package');
  const advisories = report.picomatch ?? [];
  assert(Array.isArray(advisories), 'invalid picomatch advisories');
  for (const advisory of advisories) {
    assert(advisory && typeof advisory === 'object', 'invalid advisory');
    assert(['info', 'low', 'moderate', 'high', 'critical'].includes(advisory.severity), 'invalid advisory severity');
    if (advisory.severity !== 'high' && advisory.severity !== 'critical') continue;
    // Keep monitoring the original package name. A new high/critical finding
    // must block the fork until its code has been reviewed and fixed too.
    assert(advisory.url === FIXED_ADVISORY && advisory.id === 1247710
      && advisory.title === 'picomatch vulnerable to ReDoS through single-branch repeated extglobs',
    `Unreviewed upstream picomatch advisory: ${advisory.url || advisory.title}`);
  }
  return advisories.length;
}

async function main() {
    if (process.argv[2] === '--probe') {
      verifyMatcher(path.resolve(process.argv[3]));
    } else {
      const copies = verifyCopies();
      console.log(`Verified ${copies} picomatch security forks: provenance, installed files, APIs, and bounded ReDoS regressions.`);
      if (process.argv[2] === '--audit-upstream' || process.env.CI === 'true' || process.env.CI === '1') {
        const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ picomatch: ['4.0.7'] }), signal: AbortSignal.timeout(30000),
        });
        assert(response.ok, `upstream advisory request failed: HTTP ${response.status}`);
        const count = checkUpstreamAdvisories(await response.json());
        console.log(`Reviewed ${count} upstream advisories against the verified fork; no unreviewed high/critical finding.`);
      }
    }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { verifyMatcher, verifyCopies, checkUpstreamAdvisories };
