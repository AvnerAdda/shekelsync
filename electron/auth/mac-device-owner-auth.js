const { execFile } = require('node:child_process');

/**
 * macOS "device owner" authentication (Touch ID, Apple Watch or the account
 * password) through LocalAuthentication's LAPolicyDeviceOwnerAuthentication.
 *
 * Electron's promptTouchID only works while a Touch ID sensor is usable (it is
 * not, for example, with the lid closed on an external keyboard). This fallback
 * lets the user unlock with their Mac password instead. It runs the
 * LocalAuthentication framework through JavaScript for Automation, so no native
 * module is needed. The reason string is passed as an argument, never
 * interpolated into the script.
 */

const LA_POLICY_DEVICE_OWNER_AUTHENTICATION = 2;
const LA_ERROR_USER_CANCEL = -2;
const LA_ERROR_SYSTEM_CANCEL = -4;
const LA_ERROR_APP_CANCEL = -9;
const CANCEL_CODES = new Set([LA_ERROR_USER_CANCEL, LA_ERROR_SYSTEM_CANCEL, LA_ERROR_APP_CANCEL]);
const CHECK_TIMEOUT_MS = 10 * 1000;
const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;

const CAN_EVALUATE_SCRIPT = `
ObjC.import('LocalAuthentication');
function run() {
  const context = $.LAContext.alloc.init;
  return JSON.stringify({ available: context.canEvaluatePolicyError(${LA_POLICY_DEVICE_OWNER_AUTHENTICATION}, Ref()) });
}
`;

const EVALUATE_SCRIPT = `
ObjC.import('LocalAuthentication');
ObjC.import('Foundation');
function run(argv) {
  const context = $.LAContext.alloc.init;
  const state = { done: false, success: false, code: 0, message: '' };
  context.evaluatePolicyLocalizedReasonReply(${LA_POLICY_DEVICE_OWNER_AUTHENTICATION}, argv[0] || 'Unlock ShekelSync', (success, error) => {
    state.success = success;
    if (!success && error && !error.isNil()) {
      state.code = Number(error.code);
      state.message = ObjC.unwrap(error.localizedDescription) || '';
    }
    state.done = true;
  });
  while (!state.done) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
  }
  return JSON.stringify(state);
}
`;

function runJxa(script, args, timeout, execFileImpl) {
  return new Promise((resolve, reject) => {
    execFileImpl(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', script, ...args],
      { timeout, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(String(stdout || '').trim()));
        } catch (parseError) {
          reject(new Error(`Unexpected LocalAuthentication response: ${parseError.message}`));
        }
      },
    );
  });
}

function createMacDeviceOwnerAuth({ execFileImpl = execFile } = {}) {
  async function isAvailable() {
    try {
      const result = await runJxa(CAN_EVALUATE_SCRIPT, [], CHECK_TIMEOUT_MS, execFileImpl);
      return result?.available === true;
    } catch {
      return false;
    }
  }

  async function authenticate(reason) {
    try {
      const result = await runJxa(EVALUATE_SCRIPT, [String(reason || '')], PROMPT_TIMEOUT_MS, execFileImpl);
      if (result?.success === true) {
        return { success: true, method: 'password' };
      }
      const code = Number(result?.code);
      return {
        success: false,
        method: 'password',
        cancelled: CANCEL_CODES.has(code),
        error: result?.message || 'Authentication failed',
      };
    } catch (error) {
      return {
        success: false,
        method: 'password',
        error: error?.message || 'Authentication failed',
      };
    }
  }

  return { isAvailable, authenticate };
}

module.exports = {
  createMacDeviceOwnerAuth,
  _internal: { CAN_EVALUATE_SCRIPT, EVALUATE_SCRIPT, CANCEL_CODES },
};
