const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const asar = require('@electron/asar');
const dirCompare = require('dir-compare');
const rimraf = require('rimraf');
const { Linter } = require('eslint');
const react = require('eslint-plugin-react');
const jsxA11y = require('eslint-plugin-jsx-a11y');
const { FileMatcher } = require('app-builder-lib/out/fileMatcher');

let temporaryDirectory;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-build-globs-'));
});

afterEach(() => {
  asar.uncacheAll();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function write(relativePath, contents = 'fixture') {
  const filename = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
  return filename;
}

describe('secure glob dependencies and legacy build-tool callers', () => {
  it('bounds hostile glob preprocessing in a separate process', () => {
    const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', `
      const assert = require('node:assert/strict');
      const { Minimatch } = require('minimatch');
      const matcher = new Minimatch(Array(30).fill('**/../a/b').join('/'), {
        optimizationLevel: 2, braceExpandMax: 64,
      });
      assert.equal(matcher.set.length, 64);
    `], { cwd: path.resolve(__dirname, '../..'), timeout: 5000, encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  it('keeps electron-builder inclusion and exclusion filters effective', () => {
    const matcher = new FileMatcher(temporaryDirectory, '/unused', (value) => value, [
      '**/*', '!**/.env*', '!**/__tests__/**',
    ]);
    const filter = matcher.createFilter();
    const stat = { isDirectory: () => false };
    expect(filter(path.join(temporaryDirectory, 'server/index.js'), stat)).toBe(true);
    expect(filter(path.join(temporaryDirectory, 'server/.env.local'), stat)).toBe(false);
    expect(filter(path.join(temporaryDirectory, 'server/__tests__/index.test.js'), stat)).toBe(false);
  });

  it('creates readable ASAR archives with native files unpacked', async () => {
    write('source/main.js', 'module.exports = 42;');
    write('source/.hidden', 'hidden file');
    write('source/node_modules/native-addon/binding.node', 'native fixture');
    write('source/node_modules/native-addon/data.txt', 'native data');
    const archive = path.join(temporaryDirectory, 'app.asar');
    await asar.createPackageWithOptions(path.join(temporaryDirectory, 'source'), archive, {
      unpack: '**/*.node', unpackDir: '**/native-addon',
    });
    expect(asar.extractFile(archive, 'main.js').toString()).toBe('module.exports = 42;');
    expect(asar.extractFile(archive, '.hidden').toString()).toBe('hidden file');
    expect(fs.readFileSync(`${archive}.unpacked/node_modules/native-addon/binding.node`, 'utf8')).toBe('native fixture');
    expect(fs.readFileSync(`${archive}.unpacked/node_modules/native-addon/data.txt`, 'utf8')).toBe('native data');
  });

  it('preserves the directory-comparison filters used by universal macOS packaging', () => {
    write('left/main.js', 'same');
    write('right/main.js', 'same');
    write('left/main.js.map', 'left');
    write('right/main.js.map', 'right');
    const compare = () => dirCompare.compareSync(
      path.join(temporaryDirectory, 'left'), path.join(temporaryDirectory, 'right'),
      { compareContent: true, includeFilter: '*.js', excludeFilter: '*.map' },
    );
    expect(compare().same).toBe(true);
    write('right/main.js', 'changed');
    expect(compare().same).toBe(false);
  });

  it('keeps legacy temporary-file cleanup working with async and sync globs', async () => {
    write('cleanup/first.tmp');
    write('cleanup/nested/second.tmp');
    write('cleanup/keep.js');
    const pattern = path.join(temporaryDirectory, 'cleanup/**/*.tmp').replace(/\\/g, '/');
    await promisify(rimraf)(pattern);
    expect(fs.existsSync(path.join(temporaryDirectory, 'cleanup/first.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(temporaryDirectory, 'cleanup/nested/second.tmp'))).toBe(false);
    write('cleanup/third.tmp');
    rimraf.sync(pattern);
    expect(fs.existsSync(path.join(temporaryDirectory, 'cleanup/third.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(temporaryDirectory, 'cleanup/keep.js'))).toBe(true);
  });

  it('still enforces React and accessibility rules that use glob patterns', () => {
    const messages = new Linter().verify(`
      function Screen() {
        return <>
          <Ignored_widget />
          <AllowedCard color="red" /><OtherCard color="red" />
          <HtmlView dangerouslySetInnerHTML={{ __html: 'content' }} />
          <IgnoredButton onClick={actions.click} /><Button onClick={actions.click} />
          <Panel renderFooter={() => <span />} footer={() => <span />} />
          <label>Name<InputBox /></label><label><InputBox /></label>
        </>;
      }
    `, [{
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      settings: { react: { version: '19.3' } },
      plugins: { react, 'jsx-a11y': jsxA11y },
      rules: {
        'react/jsx-pascal-case': ['error', { ignore: ['Ignored_*'] }],
        'react/forbid-component-props': ['error', { forbid: [{ propName: 'color', allowedForPatterns: ['Allowed*'] }] }],
        'react/no-danger': ['error', { customComponentNames: ['Html*'] }],
        'react/jsx-handler-names': ['error', { ignoreComponentNames: ['Ignored*'] }],
        'react/no-unstable-nested-components': ['error', { propNamePattern: 'render*' }],
        'jsx-a11y/label-has-associated-control': ['error', { controlComponents: ['Input*'], assert: 'nesting', depth: 3 }],
      },
    }]);
    expect(messages.map(({ ruleId }) => ruleId).sort()).toEqual([
      'jsx-a11y/label-has-associated-control', 'react/forbid-component-props',
      'react/jsx-handler-names', 'react/no-danger', 'react/no-unstable-nested-components',
    ].sort());
  });
});
