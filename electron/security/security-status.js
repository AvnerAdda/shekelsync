const secureKeyManager = require('../secure-key-manager');
const { logSecurityStatusCheck } = require('../security-logger');

/**
 * Security Status Manager
 * Aggregates security status from various sources
 * Provides a unified view of the application's security posture
 */
class SecurityStatusManager {
  constructor() {
    this.authenticationStatus = {
      isAuthenticated: false,
      lastAuthenticated: null,
      method: null, // 'touchid', 'pin', 'none'
      platform: process.platform,
    };
  }

  /**
   * Get comprehensive security status
   */
  async getSecurityStatus() {
    const status = {
      encryption: await this.getEncryptionStatus(),
      keychain: await this.getKeychainStatus(),
      authentication: this.getAuthenticationStatus(),
      platform: this.getPlatformInfo(),
      biometric: await this.getBiometricAvailability(),
      timestamp: new Date().toISOString(),
    };

    // Log security status check
    logSecurityStatusCheck(status);

    return status;
  }

  /**
   * Get encryption status
   */
  async getEncryptionStatus() {
    try {
      const hasKey = await secureKeyManager.getKey();
      return {
        status: hasKey ? 'active' : 'inactive',
        algorithm: 'AES-256-GCM',
        keyStorage: hasKey ? 'secure' : 'none',
      };
    } catch (error) {
      return {
        status: 'error',
        algorithm: 'AES-256-GCM',
        keyStorage: 'error',
        error: error.message,
      };
    }
  }

  /**
   * Get keychain status
   */
  async getKeychainStatus() {
    const isKeychainAvailable = secureKeyManager.keytarAvailable;

    let keychainType = 'none';
    if (isKeychainAvailable) {
      switch (process.platform) {
        case 'darwin':
          keychainType = 'macOS Keychain';
          break;
        case 'win32':
          keychainType = 'Windows Credential Manager';
          break;
        case 'linux':
          keychainType = 'libsecret';
          break;
        default:
          keychainType = 'unknown';
      }
    }

    return {
      status: isKeychainAvailable ? 'connected' : 'fallback',
      type: keychainType,
      available: isKeychainAvailable,
      fallbackMode: !isKeychainAvailable,
    };
  }

  /**
   * Get authentication status
   */
  getAuthenticationStatus() {
    return {
      ...this.authenticationStatus,
      isActive: this.authenticationStatus.isAuthenticated,
      requiresReauth: this.shouldRequireReauth(),
    };
  }

  /**
   * Get platform information
   */
  getPlatformInfo() {
    return {
      os: process.platform,
      osName: this.getOSName(),
      arch: process.arch,
      nodeVersion: process.version,
    };
  }

  /**
   * Get OS display name
   */
  getOSName() {
    switch (process.platform) {
      case 'darwin':
        return 'macOS';
      case 'win32':
        return 'Windows';
      case 'linux':
        return 'Linux';
      default:
        return process.platform;
    }
  }

  /**
   * Check biometric availability
   */
  async getBiometricAvailability() {
    const availability = {
      available: false,
      type: null,
      reason: null,
    };

    // macOS Touch ID
    if (process.platform === 'darwin') {
      try {
        const { systemPreferences } = require('electron');
        if (systemPreferences && typeof systemPreferences.canPromptTouchID === 'function') {
          availability.available = systemPreferences.canPromptTouchID();
          availability.type = 'touchid';
          availability.reason = availability.available ? 'Touch ID available' : 'Touch ID not available on this device';
        }
      } catch (error) {
        availability.reason = `Touch ID check failed: ${error.message}`;
      }
    }
    // Windows Hello (future implementation)
    else if (process.platform === 'win32') {
      availability.type = 'windows-hello';
      availability.reason = 'Windows Hello support coming soon';
    }
    // Linux (future implementation)
    else if (process.platform === 'linux') {
      availability.type = 'pam';
      availability.reason = 'Linux authentication support coming soon';
    }

    return availability;
  }

  /**
   * Set authentication status
   */
  setAuthenticationStatus(method, success = true) {
    if (success) {
      this.authenticationStatus = {
        isAuthenticated: true,
        lastAuthenticated: new Date(),
        method,
        platform: process.platform,
      };
    } else {
      this.authenticationStatus.isAuthenticated = false;
    }
  }

  /**
   * Check if re-authentication is required
   * (e.g., after timeout, wake from sleep, etc.)
   */
  shouldRequireReauth() {
    if (!this.authenticationStatus.isAuthenticated) {
      return true;
    }

    // Check if auth is older than 24 hours
    const AUTH_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
    const lastAuth = this.authenticationStatus.lastAuthenticated;

    if (!lastAuth) {
      return true;
    }

    const timeSinceAuth = Date.now() - new Date(lastAuth).getTime();
    return timeSinceAuth > AUTH_TIMEOUT_MS;
  }

  /**
   * Clear authentication status (on logout or app close)
   */
  clearAuthentication() {
    this.authenticationStatus = {
      isAuthenticated: false,
      lastAuthenticated: null,
      method: null,
      platform: process.platform,
    };
  }

  /**
   * Get security summary for display
   */
  async getSecuritySummary() {
    const status = await this.getSecurityStatus();

    return {
      level: this.calculateSecurityLevel(status),
      checks: {
        encryptionActive: status.encryption.status === 'active',
        keychainConnected: status.keychain.status === 'connected',
        authenticated: status.authentication.isActive,
        biometricAvailable: status.biometric.available,
      },
      warnings: this.generateWarnings(status),
    };
  }

  /**
   * Calculate overall security level
   */
  calculateSecurityLevel(status) {
    const checks = {
      encryption: status.encryption.status === 'active',
      keychain: status.keychain.status === 'connected',
      authenticated: status.authentication.isActive,
    };

    const passed = Object.values(checks).filter(Boolean).length;

    if (passed === 3) return 'secure';      // Green
    if (passed === 2) return 'warning';     // Yellow
    return 'error';                          // Red
  }

  /**
   * Generate security warnings
   */
  generateWarnings(status) {
    const warnings = [];

    if (status.encryption.status !== 'active') {
      warnings.push({
        type: 'encryption',
        severity: 'high',
        message: 'Encryption is not active. Your data may be at risk.',
      });
    }

    if (status.keychain.status !== 'connected') {
      warnings.push({
        type: 'keychain',
        severity: 'medium',
        message: 'Not using OS keychain. Falling back to environment variable storage.',
      });
    }

    if (!status.authentication.isActive) {
      warnings.push({
        type: 'authentication',
        severity: 'low',
        message: 'No biometric authentication configured.',
      });
    }

    if (status.authentication.requiresReauth) {
      warnings.push({
        type: 'session',
        severity: 'medium',
        message: 'Your session has expired. Please re-authenticate.',
      });
    }

    return warnings;
  }
}

// Singleton instance
const securityStatusManager = new SecurityStatusManager();

module.exports = securityStatusManager;
