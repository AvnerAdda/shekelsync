const secureKeyManager = require('../secure-key-manager');
const realSecurityLogger = require('../security-logger');

// Lazy-load the credentials service to avoid a hard require cycle at module
// load time, and to allow tests to inject a mock the same way keytar/logger
// injection already works elsewhere in electron/*.
let credentialsServiceRef;
function resolveCredentialsService() {
  if (credentialsServiceRef) return credentialsServiceRef;
  if (globalThis.__SHEKELSYNC_CREDENTIALS_SERVICE__) {
    credentialsServiceRef = globalThis.__SHEKELSYNC_CREDENTIALS_SERVICE__;
    return credentialsServiceRef;
  }
  const { resolveAppPath } = require('../paths');
  credentialsServiceRef = require(resolveAppPath('server', 'services', 'credentials.js'));
  return credentialsServiceRef;
}

// Same injectable-override convention used by electron/api-security.js for
// the security logger - keeps this mockable without fighting CJS require
// interception in tests.
function resolveSecurityLogger() {
  return globalThis.__SHEKELSYNC_SECURITY_LOGGER__ || realSecurityLogger;
}

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
      credentialEncryption: await this.getCredentialEncryptionStatus(),
      timestamp: new Date().toISOString(),
    };

    // Log security status check
    resolveSecurityLogger().logSecurityStatusCheck(status);

    return status;
  }

  /**
   * Get encryption status
   */
  async getEncryptionStatus() {
    try {
      const hasKey = await secureKeyManager.getKey();
      const usesEnvKey = Boolean(process.env.SHEKELSYNC_ENCRYPTION_KEY) &&
        (process.platform === 'linux' ||
          !secureKeyManager.keytarAvailable ||
          process.env.ALLOW_INSECURE_ENV_KEY === 'true');
      const keyStorage = usesEnvKey ? 'environment' : (secureKeyManager.keytarAvailable ? 'keychain' : 'none');
      return {
        status: hasKey ? 'active' : 'inactive',
        algorithm: 'AES-256-GCM',
        keyStorage,
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

    const status = isKeychainAvailable ? 'connected' : 'fallback';
    const source = isKeychainAvailable ? 'keychain' : 'none';
    const type = isKeychainAvailable ? keychainType : 'Unavailable';

    return {
      status,
      type,
      available: isKeychainAvailable,
      fallbackMode: status !== 'connected',
      source,
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
    try {
      const biometricAuthManager = globalThis.__SHEKELSYNC_BIOMETRIC_AUTH__ || require('../auth/biometric-auth');
      if (biometricAuthManager?.getAvailabilityDetails) {
        return await biometricAuthManager.getAvailabilityDetails();
      }
    } catch (error) {
      return {
        available: false,
        type: null,
        reason: `Biometric check failed: ${error.message}`,
      };
    }

    return {
      available: false,
      type: null,
      reason: 'Biometric authentication not available',
    };
  }

  /**
   * Verify that the currently active encryption key can actually decrypt
   * the credentials already stored on disk. A key can load "successfully"
   * (valid format, no keychain error) while still being the wrong key for
   * existing data - e.g. a second app install silently forking the shared
   * keychain secret. This is what catches that gap: it checks the data
   * itself, not just whether key retrieval threw.
   */
  async getCredentialEncryptionStatus() {
    try {
      const { listCredentials } = resolveCredentialsService();
      const credentials = await listCredentials();
      const failedCredentials = credentials
        .filter((credential) => credential?.decryptFailed)
        .map((credential) => ({
          id: credential.id,
          vendor: credential.vendor,
          nickname: credential.nickname || null,
        }));

      return {
        checked: true,
        totalCount: credentials.length,
        failedCount: failedCredentials.length,
        failedCredentials,
      };
    } catch (error) {
      // Don't let a DB/service hiccup make the whole security status
      // endpoint fail - report "couldn't check" distinctly from "checked
      // and found a mismatch".
      return {
        checked: false,
        totalCount: 0,
        failedCount: 0,
        failedCredentials: [],
        error: error.message,
      };
    }
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

    const authRequired = status.biometric.available;
    const authOk = !authRequired || status.authentication.isActive;
    const keychainRequired = status.platform.os !== 'linux';
    const keychainOk = keychainRequired ? status.keychain.status === 'connected' : true;
    const credentialsVerified = !status.credentialEncryption?.checked
      || status.credentialEncryption.failedCount === 0;

    return {
      level: this.calculateSecurityLevel(status),
      checks: {
        encryptionActive: status.encryption.status === 'active',
        keychainConnected: keychainOk,
        authenticated: authOk,
        biometricAvailable: status.biometric.available,
        credentialsVerified,
      },
      warnings: this.generateWarnings(status),
    };
  }

  /**
   * Calculate overall security level
   */
  calculateSecurityLevel(status) {
    const authRequired = status.biometric.available;
    const authOk = !authRequired || status.authentication.isActive;
    const keychainRequired = status.platform.os !== 'linux';
    const keychainOk = keychainRequired ? status.keychain.status === 'connected' : true;
    const credentialsOk = !status.credentialEncryption?.checked
      || status.credentialEncryption.failedCount === 0;

    const checks = {
      encryption: status.encryption.status === 'active',
      keychain: keychainOk,
      authenticated: authOk,
      credentials: credentialsOk,
    };

    const passed = Object.values(checks).filter(Boolean).length;

    if (passed === 4) return 'secure';      // Green
    if (passed === 3) return 'warning';     // Yellow
    return 'error';                          // Red
  }

  /**
   * Generate security warnings
   */
  generateWarnings(status) {
    const warnings = [];
    const keychainRequired = status.platform.os !== 'linux';

    if (status.encryption.status !== 'active') {
      warnings.push({
        type: 'encryption',
        severity: 'high',
        message: 'Encryption is not active. Your data may be at risk.',
      });
    }

    if (keychainRequired && status.keychain.status !== 'connected') {
      warnings.push({
        type: 'keychain',
        severity: 'medium',
        message: 'OS keychain unavailable. Enable system keychain support.',
      });
    }

    if (status.biometric.available && !status.authentication.isActive) {
      warnings.push({
        type: 'authentication',
        severity: 'low',
        message: 'No biometric authentication configured.',
      });
    }

    if (status.authentication.isActive && status.authentication.requiresReauth) {
      warnings.push({
        type: 'session',
        severity: 'medium',
        message: 'Your session has expired. Please re-authenticate.',
      });
    }

    if (status.credentialEncryption?.checked && status.credentialEncryption.failedCount > 0) {
      const names = status.credentialEncryption.failedCredentials
        .map((credential) => credential.nickname || credential.vendor)
        .join(', ');
      warnings.push({
        type: 'credential_encryption',
        severity: 'high',
        message: `${status.credentialEncryption.failedCount} of ${status.credentialEncryption.totalCount} saved credential(s) could not be decrypted with the current encryption key and need to be re-entered: ${names}.`,
      });
    }

    return warnings;
  }
}

// Singleton instance
const securityStatusManager = new SecurityStatusManager();

module.exports = securityStatusManager;
