const { logger } = require('./logger');

/**
 * Security Audit Logger
 * Tracks security-relevant events for audit and incident response
 */

const SECURITY_EVENT_TYPES = {
  AUTH_SUCCESS: 'auth_success',
  AUTH_FAILURE: 'auth_failure',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  CREDENTIAL_ACCESS: 'credential_access',
  CREDENTIAL_CREATE: 'credential_create',
  CREDENTIAL_UPDATE: 'credential_update',
  CREDENTIAL_DELETE: 'credential_delete',
  ENCRYPTION_KEY_LOADED: 'encryption_key_loaded',
  ENCRYPTION_KEY_GENERATED: 'encryption_key_generated',
  ENCRYPTION_FAILURE: 'encryption_failure',
  DECRYPTION_FAILURE: 'decryption_failure',
  INPUT_VALIDATION_FAILURE: 'input_validation_failure',
  API_ERROR: 'api_error',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',
  SECURITY_STATUS_CHECK: 'security_status_check',
  BIOMETRIC_AUTH_SUCCESS: 'biometric_auth_success',
  BIOMETRIC_AUTH_FAILURE: 'biometric_auth_failure',
};

/**
 * Log a security event
 */
function logSecurityEvent(eventType, details = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    type: eventType,
    ...details,
  };

  // Use different log levels based on severity
  if (isCriticalEvent(eventType)) {
    logger.error('[SECURITY]', event);
  } else if (isWarningEvent(eventType)) {
    logger.warn('[SECURITY]', event);
  } else {
    logger.info('[SECURITY]', event);
  }

  return event;
}

/**
 * Check if event type is critical
 */
function isCriticalEvent(eventType) {
  return [
    SECURITY_EVENT_TYPES.ENCRYPTION_FAILURE,
    SECURITY_EVENT_TYPES.DECRYPTION_FAILURE,
    SECURITY_EVENT_TYPES.SUSPICIOUS_ACTIVITY,
  ].includes(eventType);
}

/**
 * Check if event type is warning-level
 */
function isWarningEvent(eventType) {
  return [
    SECURITY_EVENT_TYPES.AUTH_FAILURE,
    SECURITY_EVENT_TYPES.RATE_LIMIT_EXCEEDED,
    SECURITY_EVENT_TYPES.INPUT_VALIDATION_FAILURE,
  ].includes(eventType);
}

/**
 * Log authentication success
 */
function logAuthSuccess(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.AUTH_SUCCESS, {
    message: 'API authentication successful',
    ...details,
  });
}

/**
 * Log authentication failure
 */
function logAuthFailure(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.AUTH_FAILURE, {
    message: 'API authentication failed',
    ...details,
  });
}

/**
 * Log rate limit exceeded
 */
function logRateLimitExceeded(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.RATE_LIMIT_EXCEEDED, {
    message: 'Rate limit exceeded',
    ...details,
  });
}

/**
 * Log credential access
 */
function logCredentialAccess(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.CREDENTIAL_ACCESS, {
    message: 'Credential accessed',
    ...details,
  });
}

/**
 * Log credential creation
 */
function logCredentialCreate(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.CREDENTIAL_CREATE, {
    message: 'Credential created',
    ...details,
  });
}

/**
 * Log credential update
 */
function logCredentialUpdate(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.CREDENTIAL_UPDATE, {
    message: 'Credential updated',
    ...details,
  });
}

/**
 * Log credential deletion
 */
function logCredentialDelete(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.CREDENTIAL_DELETE, {
    message: 'Credential deleted',
    ...details,
  });
}

/**
 * Log encryption key loaded
 */
function logEncryptionKeyLoaded(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.ENCRYPTION_KEY_LOADED, {
    message: 'Encryption key loaded from secure storage',
    ...details,
  });
}

/**
 * Log encryption key generated
 */
function logEncryptionKeyGenerated(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.ENCRYPTION_KEY_GENERATED, {
    message: 'New encryption key generated',
    ...details,
  });
}

/**
 * Log encryption failure
 */
function logEncryptionFailure(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.ENCRYPTION_FAILURE, {
    message: 'Encryption operation failed',
    ...details,
  });
}

/**
 * Log decryption failure
 */
function logDecryptionFailure(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.DECRYPTION_FAILURE, {
    message: 'Decryption operation failed',
    ...details,
  });
}

/**
 * Log input validation failure
 */
function logInputValidationFailure(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.INPUT_VALIDATION_FAILURE, {
    message: 'Input validation failed',
    ...details,
  });
}

/**
 * Log API error
 */
function logAPIError(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.API_ERROR, {
    message: 'API error occurred',
    ...details,
  });
}

/**
 * Log suspicious activity
 */
function logSuspiciousActivity(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.SUSPICIOUS_ACTIVITY, {
    message: 'Suspicious activity detected',
    ...details,
  });
}

/**
 * Log security status check
 */
function logSecurityStatusCheck(status = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.SECURITY_STATUS_CHECK, {
    message: 'Security status checked',
    encryptionStatus: status.encryption?.status,
    keychainStatus: status.keychain?.status,
    authenticated: status.authentication?.isActive,
  });
}

/**
 * Log biometric authentication success
 */
function logBiometricAuthSuccess(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.BIOMETRIC_AUTH_SUCCESS, {
    message: 'Biometric authentication successful',
    ...details,
  });
}

/**
 * Log biometric authentication failure
 */
function logBiometricAuthFailure(details = {}) {
  return logSecurityEvent(SECURITY_EVENT_TYPES.BIOMETRIC_AUTH_FAILURE, {
    message: 'Biometric authentication failed',
    ...details,
  });
}

module.exports = {
  SECURITY_EVENT_TYPES,
  logSecurityEvent,
  logAuthSuccess,
  logAuthFailure,
  logRateLimitExceeded,
  logCredentialAccess,
  logCredentialCreate,
  logCredentialUpdate,
  logCredentialDelete,
  logEncryptionKeyLoaded,
  logEncryptionKeyGenerated,
  logEncryptionFailure,
  logDecryptionFailure,
  logInputValidationFailure,
  logAPIError,
  logSuspiciousActivity,
  logSecurityStatusCheck,
  logBiometricAuthSuccess,
  logBiometricAuthFailure,
};
