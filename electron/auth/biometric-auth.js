const { systemPreferences } = require('electron');
const securityStatusManager = require('../security/security-status');
const {
  logBiometricAuthSuccess,
  logBiometricAuthFailure,
} = require('../security-logger');

/**
 * Biometric Authentication Manager
 * Handles biometric authentication (Touch ID on macOS, Windows Hello, etc.)
 */
class BiometricAuthManager {
  constructor() {
    this.platform = process.platform;
    this.authEnabled = false;
    this.lastAuthAttempt = null;
  }

  /**
   * Check if biometric authentication is available on this platform
   */
  async isAvailable() {
    try {
      if (this.platform === 'darwin') {
        // macOS Touch ID
        if (systemPreferences && typeof systemPreferences.canPromptTouchID === 'function') {
          return systemPreferences.canPromptTouchID();
        }
      }
      // Windows Hello and Linux not yet implemented
      return false;
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
      case 'linux':
        return 'pam';
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

      // Other platforms not yet supported
      console.warn(`[BiometricAuth] Platform ${this.platform} not yet supported`);
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
   * Authenticate with Windows Hello (future implementation)
   */
  async authenticateWindowsHello(reason) {
    console.warn('[BiometricAuth] Windows Hello not yet implemented');
    return {
      success: false,
      error: 'Windows Hello authentication not yet implemented',
    };
  }

  /**
   * Authenticate with PAM (Linux, future implementation)
   */
  async authenticatePAM(reason) {
    console.warn('[BiometricAuth] PAM authentication not yet implemented');
    return {
      success: false,
      error: 'PAM authentication not yet implemented',
    };
  }

  /**
   * Get authentication status
   */
  getStatus() {
    return {
      platform: this.platform,
      enabled: this.authEnabled,
      available: this.isAvailable(),
      lastAttempt: this.lastAuthAttempt,
      type: this.getBiometricType(),
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
