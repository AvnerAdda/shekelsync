const express = require('express');

const credentialsService = require('../services/credentials.js');
const oneZeroVerification = require('../services/scraping/one-zero-verification.js');
const { sanitizeError, sanitizeErrorForLogging } = require('../../lib/server/error-sanitizer.js');
const { validateCredentialCreation, validateCredentialUpdate, validateCredentialId } = require('../../lib/server/input-validator.js');
const { resolveElectronPath } = require('../../lib/resolve-electron-path.js');
const {
  logCredentialAccess,
  logCredentialCreate,
  logCredentialUpdate,
  logCredentialDelete,
  logInputValidationFailure,
} = require(resolveElectronPath('security-logger.js'));

// The API never echoes decrypted bank secrets back, even to the caller that supplied them.
function withoutSecrets(credential) {
  if (!credential || typeof credential !== 'object') return credential;
  const {
    username: _username,
    password: _password,
    id_number: _idNumber,
    identification_code: _identificationCode,
    ...publicCredential
  } = credential;
  return publicCredential;
}

function createCredentialsRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const credentials = await credentialsService.listCredentials({ ...req.query, skipDecrypt: true });
      logCredentialAccess({
        action: 'list',
        count: credentials.length,
      });
      res.json(credentials);
    } catch (error) {
      // Log sanitized error (no credentials in logs)
      const sanitizedLog = sanitizeErrorForLogging(error, {
        path: req.path,
        method: req.method,
        // DO NOT log query params as they might contain sensitive filters
      });
      console.error('[Credentials] List error:', sanitizedLog);

      // Send sanitized error to client (no stack traces)
      const sanitized = sanitizeError(error, {
        statusCode: error?.statusCode || 500,
        defaultMessage: 'Failed to fetch credentials',
        includeStack: false, // Never include stack traces for credential operations
      });
      res.status(sanitized.statusCode).json(sanitized);
    }
  });

  router.post('/', async (req, res) => {
    try {
      // Validate input
      const validation = validateCredentialCreation(req.body || {});
      if (!validation.valid) {
        logInputValidationFailure({
          endpoint: '/api/credentials',
          method: 'POST',
          errors: validation.errors,
        });
        return res.status(400).json({
          error: 'Validation failed',
          errors: validation.errors,
        });
      }

      const credential = await credentialsService.createCredential(validation.data);
      logCredentialCreate({
        credentialId: credential.id,
        vendor: validation.data.vendor,
      });
      res.status(201).json(withoutSecrets(credential));
    } catch (error) {
      // SECURITY: Do not log request body (contains credentials)
      const sanitizedLog = sanitizeErrorForLogging(error, {
        path: req.path,
        method: req.method,
      });
      console.error('[Credentials] Create error:', sanitizedLog);

      const sanitized = sanitizeError(error, {
        statusCode: error?.statusCode || 500,
        defaultMessage: 'Failed to create credential',
        includeStack: false,
      });
      res.status(sanitized.statusCode).json(sanitized);
    }
  });

  const handleUpdate = async (req, res) => {
    try {
      const id = req.params?.id || req.query?.id || req.body?.id;
      const payload = { ...(req.body || {}), id };

      // Validate input
      const validation = validateCredentialUpdate(payload);
      if (!validation.valid) {
        logInputValidationFailure({
          endpoint: '/api/credentials',
          method: req.method,
          credentialId: id,
          errors: validation.errors,
        });
        return res.status(400).json({
          error: 'Validation failed',
          errors: validation.errors,
        });
      }

      const credential = await credentialsService.updateCredential(validation.data);
      logCredentialUpdate({
        credentialId: credential.id,
        fieldsUpdated: Object.keys(validation.data).filter(k => k !== 'id'),
      });
      res.json(withoutSecrets(credential));
    } catch (error) {
      // SECURITY: Do not log request body (contains credentials)
      const sanitizedLog = sanitizeErrorForLogging(error, {
        path: req.path,
        method: req.method,
        credentialId: req.params?.id || req.query?.id,
      });
      console.error('[Credentials] Update error:', sanitizedLog);

      const sanitized = sanitizeError(error, {
        statusCode: error?.statusCode || 500,
        defaultMessage: 'Failed to update credential',
        includeStack: false,
      });
      res.status(sanitized.statusCode).json(sanitized);
    }
  };

  router.put('/', handleUpdate);
  router.put('/:id', handleUpdate);
  router.patch('/', handleUpdate);
  router.patch('/:id', handleUpdate);

  const handleDelete = async (req, res) => {
    const id = req.params?.id || req.query?.id;
    try {

      // Validate ID
      const idValidation = validateCredentialId(id, { required: true });
      if (!idValidation.valid) {
        logInputValidationFailure({
          endpoint: '/api/credentials',
          method: 'DELETE',
          credentialId: id,
          errors: [idValidation.error],
        });
        return res.status(400).json({
          error: 'Validation failed',
          errors: [idValidation.error],
        });
      }

      const result = await credentialsService.deleteCredential({ id: idValidation.value });
      logCredentialDelete({
        credentialId: idValidation.value,
      });
      res.json(result);
    } catch (error) {
      const sanitizedLog = sanitizeErrorForLogging(error, {
        path: req.path,
        method: req.method,
        credentialId: id,
      });
      console.error('[Credentials] Delete error:', sanitizedLog);

      const sanitized = sanitizeError(error, {
        statusCode: error?.statusCode || 500,
        defaultMessage: 'Failed to delete credential',
        includeStack: false,
      });
      res.status(sanitized.statusCode).json(sanitized);
    }
  };

  router.delete('/', handleDelete);
  router.delete('/:id', handleDelete);

  const sendVerificationError = (req, res, error, defaultMessage) => {
    const statusCode = error?.statusCode || 500;
    if (statusCode >= 500 && statusCode !== 502) {
      console.error(
        '[Credentials] One Zero verification error:',
        sanitizeErrorForLogging(error, { path: req.path, method: req.method }),
      );
    }
    const exposeMessage = statusCode < 500 || statusCode === 502;
    const sanitized = sanitizeError(error, { statusCode, defaultMessage, includeStack: false, exposeMessage });
    res.status(statusCode).json({
      ...sanitized,
      code: exposeMessage ? error?.code || null : null,
      ...(Number.isInteger(error?.attemptsRemaining) ? { attemptsRemaining: error.attemptsRemaining } : {}),
    });
  };

  // Step 1: One Zero texts a code to the phone number. Nothing is stored yet.
  router.post('/:id/one-zero/verification', async (req, res) => {
    const idValidation = validateCredentialId(req.params.id);
    if (!idValidation.valid) {
      return res.status(400).json({ error: idValidation.error });
    }
    try {
      const result = await oneZeroVerification.startVerification({
        credentialId: idValidation.value,
        phoneNumber: req.body?.phoneNumber,
      });
      res.json(result);
    } catch (error) {
      sendVerificationError(req, res, error, 'Failed to send the verification code');
    }
  });

  // Step 2: exchange the SMS code for One Zero's long-term token and save it
  // (encrypted) on the credential. The token is never sent back.
  router.post('/:id/one-zero/verification/confirm', async (req, res) => {
    const idValidation = validateCredentialId(req.params.id);
    if (!idValidation.valid) {
      return res.status(400).json({ error: idValidation.error });
    }
    try {
      const result = await oneZeroVerification.confirmVerification({
        credentialId: idValidation.value,
        sessionId: req.body?.sessionId,
        code: req.body?.code,
      });
      logCredentialUpdate({ credentialId: idValidation.value, fieldsUpdated: ['otpToken'] });
      res.json(result);
    } catch (error) {
      sendVerificationError(req, res, error, 'Failed to verify the code');
    }
  });

  return router;
}

module.exports = { createCredentialsRouter };
