const { spawnSync } = require('child_process');
const path = require('path');

function resolveMacAppBundlePath(executablePath) {
  if (typeof executablePath !== 'string' || executablePath.trim().length === 0) {
    return executablePath;
  }

  const normalizedPath = path.resolve(executablePath);
  const appBundlePath = path.dirname(path.dirname(path.dirname(normalizedPath)));

  if (appBundlePath.endsWith('.app')) {
    return appBundlePath;
  }

  return normalizedPath;
}

function parseCodesignDisplay(rawOutput = '') {
  const details = {
    authority: [],
    signature: null,
    teamIdentifier: null,
  };

  for (const rawLine of String(rawOutput).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith('Authority=')) {
      details.authority.push(line.slice('Authority='.length).trim());
      continue;
    }

    if (line.startsWith('Signature=')) {
      details.signature = line.slice('Signature='.length).trim();
      continue;
    }

    if (line.startsWith('TeamIdentifier=')) {
      details.teamIdentifier = line.slice('TeamIdentifier='.length).trim();
    }
  }

  return details;
}

function evaluateMacAutoUpdateCodeSignature(details) {
  const authority = Array.isArray(details?.authority) ? details.authority : [];
  const signature = typeof details?.signature === 'string' ? details.signature.trim().toLowerCase() : '';
  const teamIdentifier =
    typeof details?.teamIdentifier === 'string' ? details.teamIdentifier.trim().toLowerCase() : '';

  if (signature === 'adhoc') {
    return {
      eligible: false,
      reason:
        'macOS auto-update is disabled because this build is ad-hoc signed. Install a Developer ID signed release manually.',
    };
  }

  if (!authority.some((value) => value.startsWith('Developer ID Application:'))) {
    return {
      eligible: false,
      reason:
        'macOS auto-update is disabled because this build is not signed with a Developer ID Application certificate.',
    };
  }

  if (!teamIdentifier || teamIdentifier === 'not set') {
    return {
      eligible: false,
      reason:
        'macOS auto-update is disabled because this build does not have a valid Apple Team Identifier in its code signature.',
    };
  }

  return { eligible: true, reason: null };
}

function runCodesignDisplay(bundlePath) {
  const result = spawnSync('codesign', ['-dv', '--verbose=4', bundlePath], {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();

  if (result.error) {
    return {
      success: false,
      error: result.error.message,
      output,
    };
  }

  if (result.status !== 0) {
    return {
      success: false,
      error: output || `codesign exited with status ${result.status}`,
      output,
    };
  }

  return {
    success: true,
    output,
  };
}

function inspectMacAutoUpdateCodeSignature({
  platform = process.platform,
  isPackaged = true,
  executablePath = process.execPath,
  runCodesign = runCodesignDisplay,
} = {}) {
  if (platform !== 'darwin' || !isPackaged) {
    return {
      eligible: true,
      reason: null,
      bundlePath: null,
      details: null,
    };
  }

  const bundlePath = resolveMacAppBundlePath(executablePath);
  const inspection = runCodesign(bundlePath);

  if (!inspection?.success) {
    return {
      eligible: false,
      reason: `macOS auto-update is disabled because the app code signature could not be inspected: ${inspection?.error || 'unknown error'}`,
      bundlePath,
      details: null,
    };
  }

  const details = parseCodesignDisplay(inspection.output);
  const evaluation = evaluateMacAutoUpdateCodeSignature(details);

  return {
    ...evaluation,
    bundlePath,
    details,
  };
}

module.exports = {
  evaluateMacAutoUpdateCodeSignature,
  inspectMacAutoUpdateCodeSignature,
  parseCodesignDisplay,
  resolveMacAppBundlePath,
  runCodesignDisplay,
};
