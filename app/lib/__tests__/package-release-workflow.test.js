const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../..');
const packageWorkflow = fs.readFileSync(
  path.join(repositoryRoot, '.github/workflows/package.yml'),
  'utf8',
);
const macReleaseValidator = fs.readFileSync(
  path.join(repositoryRoot, '.github/scripts/validate-macos-release.sh'),
  'utf8',
);

describe('production package workflow', () => {
  it('requires every mac signing and notarization credential for pushed tags', () => {
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
      'Refusing macOS tag release because required credentials are missing',
    );
  });

  it('publishes only pushed-tag artifacts after mac release validation', () => {
    const validationStep = packageWorkflow.indexOf(
      'name: Validate signed and notarized macOS release artifacts',
    );
    const uploadStep = packageWorkflow.indexOf('name: Upload validated release artifacts');

    expect(validationStep).toBeGreaterThan(-1);
    expect(uploadStep).toBeGreaterThan(validationStep);
    expect(packageWorkflow).toContain(
      "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') && success()",
    );
    expect(packageWorkflow).toContain(
      'Mode: diagnostic only; no artifacts will be uploaded or published',
    );
    expect(packageWorkflow).not.toContain('if: always()\n        uses: actions/upload-artifact');
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
