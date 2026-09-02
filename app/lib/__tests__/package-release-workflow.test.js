const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../..');
const packageWorkflow = fs.readFileSync(
  path.join(repositoryRoot, '.github/workflows/package.yml'),
  'utf8',
);
const ciWorkflow = fs.readFileSync(
  path.join(repositoryRoot, '.github/workflows/ci.yml'),
  'utf8',
);
const macReleaseValidator = fs.readFileSync(
  path.join(repositoryRoot, '.github/scripts/validate-macos-release.sh'),
  'utf8',
);
const appPackage = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'app/package.json'), 'utf8'),
);
const universalRequire = createRequire(require.resolve('@electron/universal/package.json'));
const { minimatch } = universalRequire('minimatch');

describe('production package workflow', () => {
  it('uses a complete mac signing setup or an explicit unsigned release', () => {
    expect(packageWorkflow).toContain(
      "if: matrix.os == 'macos-latest' && github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
    );

    for (const secretName of [
      'MACOS_CERT_P12',
      'MACOS_CERT_PASSWORD',
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID',
    ]) {
      expect(packageWorkflow).toContain(secretName);
    }

    expect(packageWorkflow).toContain(
      'No macOS signing credentials configured; publishing unsigned macOS artifacts',
    );
    expect(packageWorkflow).toContain('Partially configured macOS signing credentials');
    expect(packageWorkflow).toContain('MACOS_RELEASE_SIGNING_MODE=unsigned');
    expect(packageWorkflow).toContain('MACOS_RELEASE_SIGNING_MODE=signed');
  });

  it('publishes only pushed-tag artifacts after the selected mac release validation', () => {
    const signedValidationStep = packageWorkflow.indexOf(
      'name: Validate signed and notarized macOS release artifacts',
    );
    const unsignedValidationStep = packageWorkflow.indexOf(
      'name: Validate unsigned macOS release artifacts',
    );
    const uploadStep = packageWorkflow.indexOf('name: Upload release artifacts');

    expect(signedValidationStep).toBeGreaterThan(-1);
    expect(unsignedValidationStep).toBeGreaterThan(signedValidationStep);
    expect(uploadStep).toBeGreaterThan(unsignedValidationStep);
    expect(packageWorkflow).toContain(
      "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') && success()",
    );
    expect(packageWorkflow).toContain(
      'Mode: diagnostic only; no artifacts will be uploaded or published',
    );
    expect(packageWorkflow).not.toContain('if: always()\n        uses: actions/upload-artifact');
  });

  it('requires fresh unsigned mac artifacts before upload', () => {
    expect(packageWorkflow).toContain('npm --prefix app run dist:unsigned');
    expect(packageWorkflow).toContain('Expected unsigned macOS release output is missing');
    expect(packageWorkflow).toContain('Refusing stale unsigned macOS release output');
    expect(packageWorkflow).toContain('they are not Apple-notarized');
  });

  it('preserves architecture-specific better-sqlite3 prebuilds in universal macOS packages', () => {
    const rule = appPackage.build.mac.x64ArchFiles;

    for (const arch of ['arm64', 'x64']) {
      expect(
        minimatch(
          `Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/darwin-${arch}.node`,
          rule,
        ),
      ).toBe(true);
    }

    expect(
      minimatch(
        'Contents/Resources/app.asar.unpacked/node_modules/unrelated/prebuilds/darwin-x64.node',
        rule,
      ),
    ).toBe(false);
  });

  it('smoke-tests a universal macOS package before release tags are pushed', () => {
    expect(ciWorkflow).toContain("if: matrix.os == 'macos-latest'");
    expect(ciWorkflow).toContain('npm --prefix app run pack -- --mac --universal');
  });

  it('checks fresh packaged apps for signature, identity, runtime, and notarization', () => {
    expect(macReleaseValidator).toContain('codesign --verify --deep --strict');
    expect(macReleaseValidator).toContain('TeamIdentifier=$EXPECTED_APPLE_TEAM_ID');
    expect(macReleaseValidator).toContain('Authority=Developer ID Application:');
    expect(macReleaseValidator).toContain("flags=.*runtime");
    expect(macReleaseValidator).toContain('xcrun stapler validate');
    expect(macReleaseValidator).toContain('spctl --assess --type execute');
    expect(macReleaseValidator).toContain('source=Notarized Developer ID');
    expect(macReleaseValidator).toContain('-nt "$MACOS_BUILD_MARKER"');
    expect(macReleaseValidator).toContain('published ZIP');
    expect(macReleaseValidator).toContain('published DMG');
  });
});
