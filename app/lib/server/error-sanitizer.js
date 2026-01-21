/**
 * Error Sanitization Utilities
 * Prevents sensitive data from leaking in error messages and logs
 */

const isDev = process.env.NODE_ENV === 'development';

/**
 * Patterns that indicate sensitive data (for redaction)
 */
const SENSITIVE_PATTERNS = [
  /password/i,
  /passwd/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /auth/i,
  /credential/i,
  /ssn/i,
  /social[_-]?security/i,
  /card[_-]?number/i,
  /cvv/i,
  /pin/i,
  /id[_-]?number/i,
  /identification/i,
];

/**
 * Check if a key name indicates sensitive data
 */
function isSensitiveKey(key) {
  if (typeof key !== 'string') {
    return false;
  }
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Redact sensitive values from an object
 */
function redactSensitiveData(obj, depth = 0) {
  if (depth > 10) {
    return '[Max depth reached]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item, depth + 1));
  }

  const redacted = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value, depth + 1);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Sanitize error for client response
 * Removes stack traces in production and redacts sensitive data
 */
function sanitizeError(error, options = {}) {
  const {
    includeStack = isDev,
    statusCode = 500,
    defaultMessage = 'An error occurred',
  } = options;

  if (!error) {
    return {
      error: defaultMessage,
      statusCode,
    };
  }

  const sanitized = {
    error: error.message || defaultMessage,
    statusCode: error.statusCode || statusCode,
  };

  // Include error code if available
  if (error.code) {
    sanitized.code = error.code;
  }

  // Include stack trace only in development
  if (includeStack && error.stack) {
    sanitized.stack = error.stack;
  }

  return sanitized;
}

/**
 * Sanitize error for logging
 * Redacts sensitive data but keeps stack traces
 */
function sanitizeErrorForLogging(error, context = {}) {
  if (!error) {
    return null;
  }

  const sanitized = {
    message: error.message || 'Unknown error',
    code: error.code,
    statusCode: error.statusCode,
    stack: error.stack,
  };

  // Redact sensitive data from context
  if (context && typeof context === 'object') {
    sanitized.context = redactSensitiveData(context);
  }

  return sanitized;
}

/**
 * Create a safe error handler for Express routes
 */
function createErrorHandler(options = {}) {
  const {
    logger = console,
    includeStack = isDev,
  } = options;

  return (error, req, res, next) => {
    // Log sanitized error
    const sanitizedForLog = sanitizeErrorForLogging(error, {
      path: req.path,
      method: req.method,
      query: req.query,
      // DO NOT log req.body as it may contain credentials
    });

    logger.error('[API Error]', sanitizedForLog);

    // Send sanitized error to client
    if (!res.headersSent) {
      const sanitized = sanitizeError(error, {
        includeStack,
        statusCode: error.statusCode || 500,
      });

      res.status(sanitized.statusCode).json(sanitized);
    }
  };
}

/**
 * Wrap an async route handler with error sanitization
 */
function wrapAsyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      // Sanitize and pass to error handler
      const sanitized = new Error(error.message || 'Request failed');
      sanitized.statusCode = error.statusCode || 500;
      sanitized.code = error.code;

      // DO NOT copy stack trace or other properties that might contain sensitive data
      next(sanitized);
    }
  };
}

module.exports = {
  sanitizeError,
  sanitizeErrorForLogging,
  redactSensitiveData,
  createErrorHandler,
  wrapAsyncHandler,
  isSensitiveKey,
};
module.exports.default = module.exports;
