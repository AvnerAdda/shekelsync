const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { verifyCopies, checkUpstreamAdvisories } = require('../verify-picomatch-security.cjs');

test('linear backslash handling preserves upstream results for bounded exhaustive inputs', () => {
  const { removeBackslashes } = require('../../vendor/picomatch/lib/utils.js');
  const upstream = /(?:\[.*?[^\\]\]|\\(?=.))/g;
  let cases = [''];
  for (let length = 0; length <= 5; length += 1) {
    for (const value of cases) {
      assert.equal(removeBackslashes(value), value.replace(upstream, match => match === '\\' ? '' : match), JSON.stringify(value));
    }
    cases = cases.flatMap(value => ['[', ']', '\\', 'a', '\n', '\r', '\u2028'].map(character => value + character));
  }
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matcher-security-test-'));
  const vendor = path.resolve(__dirname, '../../vendor/picomatch');
  fs.cpSync(vendor, path.join(root, 'vendor/picomatch'), { recursive: true });
  for (const scope of ['app', 'renderer']) {
    const project = path.join(root, scope);
    fs.mkdirSync(path.join(project, 'node_modules'), { recursive: true });
    fs.cpSync(vendor, path.join(project, 'node_modules/picomatch'), { recursive: true });
    fs.writeFileSync(path.join(project, 'package-lock.json'), JSON.stringify({ packages: {
      'node_modules/picomatch': { name: '@shekelsync/picomatch', version: '4.0.7-shekelsync.2' },
    } }));
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('accepts reviewed installed copies and exercises their matching APIs', t => {
  assert.equal(verifyCopies(fixture(t)), 2);
});

test('rejects a lockfile that reintroduces the registry package', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'app/package-lock.json'), JSON.stringify({ packages: {
    'node_modules/picomatch': { version: '4.0.7' },
  } }));
  assert.throws(() => verifyCopies(root), /unexpected registry copy/);
});

test('rejects modified installed code before running a matcher', t => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root, 'app/node_modules/picomatch/lib/parse.js'), '\n// changed\n');
  assert.throws(() => verifyCopies(root), /reviewed source fingerprint/);
});

test('blocks new upstream high/critical advisories', () => {
  for (const severity of ['high', 'critical']) {
    assert.throws(() => checkUpstreamAdvisories({ picomatch: [{
      id: 999, severity, url: 'https://github.com/advisories/GHSA-new-finding', title: 'New finding',
    }] }), /Unreviewed upstream/);
  }
});

test('accepts the specifically remediated advisory and reports other severities', () => {
  assert.equal(checkUpstreamAdvisories({ picomatch: [{
    id: 1247710, severity: 'high', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
    title: 'picomatch vulnerable to ReDoS through single-branch repeated extglobs',
  }, { severity: 'moderate', url: 'https://example.test/moderate' }] }), 2);
  assert.equal(checkUpstreamAdvisories({}), 0);
});

test('rejects malformed advisory responses', () => {
  for (const response of [null, [], { picomatch: {} }, { error: 'unavailable' }, { picomatch: [{}] }]) {
    assert.throws(() => checkUpstreamAdvisories(response));
  }
});
