const { systemPreferences } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const securityStatusManager = require('../security/security-status');
const {
  logBiometricAuthSuccess,
  logBiometricAuthFailure,
} = require('../security-logger');

/**
 * Biometric Authentication Manager
 * Handles biometric authentication (Touch ID on macOS, Windows Hello on Windows)
 */
class BiometricAuthManager {
  constructor() {
    this.platform = process.platform;
    this.authEnabled = false;
    this.lastAuthAttempt = null;
  }

  async runPowerShell(script, env = {}) {
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        env: { ...process.env, ...env },
        windowsHide: true,
        timeout: 60000,
      },
    );
    return String(stdout || '').trim();
  }

  async getWindowsHelloAvailability() {
    const script = [
      'Add-Type -AssemblyName System.Runtime.WindowsRuntime;',
      '$null = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime];',
      '$availability = [Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync().GetAwaiter().GetResult();',
      'Write-Output $availability.ToString();',
    ].join(' ');

    try {
      const output = await this.runPowerShell(script);
      if (output === 'Available') {
        return { available: true, type: 'windows-hello', reason: 'Windows Hello available' };
      }
      const reasons = {
        DeviceNotPresent: 'No compatible biometric device found',
        NotConfiguredForUser: 'Windows Hello not configured for this user',
        DisabledByPolicy: 'Windows Hello disabled by policy',
        DeviceBusy: 'Windows Hello device is busy',
      };
      return {
        available: false,
        type: 'windows-hello',
        reason: reasons[output] || `Windows Hello unavailable (${output || 'unknown'})`,
      };
    } catch (error) {
      return {
        available: false,
        type: 'windows-hello',
        reason: `Windows Hello check failed: ${error.message}`,
      };
    }
  }

  async authenticateWindowsHello(reason) {
    const script = [
      'Add-Type -AssemblyName System.Runtime.WindowsRuntime;',
      '$null = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime];',
      '$result = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($env:SHEKELSYNC_AUTH_REASON).GetAwaiter().GetResult();',
      'Write-Output $result.ToString();',
    ].join(' ');

    try {
      const output = await this.runPowerShell(script, { SHEKELSYNC_AUTH_REASON: reason });
      if (output === 'Verified') {
        logBiometricAuthSuccess({
          platform: this.platform,
          method: 'windows-hello',
          reason,
        });
        securityStatusManager.setAuthenticationStatus('windows-hello', true);
        return { success: true, method: 'windows-hello' };
      }

      const reasons = {
        DeviceNotPresent: 'No compatible biometric device found',
        NotConfiguredForUser: 'Windows Hello not configured for this user',
        DisabledByPolicy: 'Windows Hello disabled by policy',
        DeviceBusy: 'Windows Hello device is busy',
        RetriesExhausted: 'Too many failed attempts',
        Canceled: 'Authentication cancelled',
      };
      const errorMessage = reasons[output] || `Windows Hello authentication failed (${output || 'unknown'})`;
      logBiometricAuthFailure({
        platform: this.platform,
        method: 'windows-hello',
        error: errorMessage,
        reason,
      });
      securityStatusManager.setAuthenticationStatus('windows-hello', false);
      return { success: false, error: errorMessage, cancelled: output === 'Canceled' };
    } catch (error) {
      const errorMessage = error.message || 'Windows Hello authentication failed';
      logBiometricAuthFailure({
        platform: this.platform,
        method: 'windows-hello',
        error: errorMessage,
        reason,
      });
      securityStatusManager.setAuthenticationStatus('windows-hello', false);
      return { success: false, error: errorMessage };
    }
  }

  async getAvailabilityDetails() {
    if (this.platform === 'darwin') {
      try {
        if (systemPreferences && typeof systemPreferences.canPromptTouchID === 'function') {
          const available = systemPreferences.canPromptTouchID();
          return {
            available,
            type: 'touchid',
            reason: available ? 'Touch ID available' : 'Touch ID not available on this device',
          };
        }
        return { available: false, type: 'touchid', reason: 'Touch ID not supported' };
      } catch (error) {
        return { available: false, type: 'touchid', reason: `Touch ID check failed: ${error.message}` };
      }
    }

    if (this.platform === 'win32') {
      return this.getWindowsHelloAvailability();
    }

    if (this.platform === 'linux') {
      return {
        available: false,
        type: 'none',
        reason: 'Biometric authentication not supported on Linux',
      };
    }

    return { available: false, type: 'none', reason: 'Unsupported platform' };
  }

  /**
   * Check if biometric authentication is available on this platform
   */
  async isAvailable() {
    try {
      const availability = await this.getAvailabilityDetails();
      return availability.available;
    } catch (error) {
      console.error('[BiometricAuth] Failed to check availability:', error);
      return false;
    }
  }

  /**
   * Get the biometric authentication type for this platform
   */
  getBiometricType() {
    switch (this.platform) {
      case 'darwin':
        return 'touchid';
      case 'win32':
        return 'windows-hello';
      default:
        return 'none';
    }
  }

  /**
   * Authenticate user with biometric
   */
  async authenticate(reason = 'Access ShekelSync') {
    this.lastAuthAttempt = new Date();

    try {
      if (this.platform === 'darwin') {
        return await this.authenticateTouchID(reason);
      }

      if (this.platform === 'win32') {
        const availability = await this.getAvailabilityDetails();
        if (!availability.available) {
          return { success: false, error: availability.reason || 'Windows Hello not available' };
        }
        return await this.authenticateWindowsHello(reason);
      }

      console.warn(`[BiometricAuth] Platform ${this.platform} not supported`);
      return {
        success: false,
        error: `Biometric authentication not supported on ${this.platform}`,
      };
    } catch (error) {
      console.error('[BiometricAuth] Authentication error:', error);
      logBiometricAuthFailure({
        platform: this.platform,
        error: error.message,
        reason,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Authenticate with Touch ID (macOS)
   */
  async authenticateTouchID(reason) {
    try {
      if (!systemPreferences || typeof systemPreferences.promptTouchID !== 'function') {
        throw new Error('Touch ID not available on this system');
      }

      // Check availability first
      const available = await this.isAvailable();
      if (!available) {
        throw new Error('Touch ID is not available on this Mac');
      }

      // Prompt for Touch ID
      await systemPreferences.promptTouchID(reason);

      // Success!
      logBiometricAuthSuccess({
        platform: this.platform,
        method: 'touchid',
        reason,
      });

      // Update security status manager
      securityStatusManager.setAuthenticationStatus('touchid', true);

      return {
        success: true,
        method: 'touchid',
      };
    } catch (error) {
      // User cancelled or authentication failed
      const errorMessage = error.message || 'Touch ID authentication failed';

      logBiometricAuthFailure({
        platform: this.platform,
        method: 'touchid',
        error: errorMessage,
        reason,
      });

      securityStatusManager.setAuthenticationStatus('touchid', false);

      return {
        success: false,
        error: errorMessage,
        cancelled: errorMessage.toLowerCase().includes('cancel'),
      };
    }
  }

  /**
   * Get authentication status
   */
  async getStatus() {
    const availability = await this.getAvailabilityDetails();
    return {
      platform: this.platform,
      enabled: this.authEnabled,
      available: availability.available,
      reason: availability.reason || null,
      lastAttempt: this.lastAuthAttempt,
      type: availability.type || this.getBiometricType(),
    };
  }

  /**
   * Enable biometric authentication
   */
  enable() {
    this.authEnabled = true;
    console.log('[BiometricAuth] Biometric authentication enabled');
  }

  /**
   * Disable biometric authentication
   */
  disable() {
    this.authEnabled = false;
    securityStatusManager.clearAuthentication();
    console.log('[BiometricAuth] Biometric authentication disabled');
  }
}

// Singleton instance
const biometricAuthManager = new BiometricAuthManager();

module.exports = biometricAuthManager;
