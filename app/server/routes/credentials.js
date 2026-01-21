const express = require('express');

const credentialsService = require('../services/credentials.js');
const { sanitizeError, sanitizeErrorForLogging } = require('../../lib/server/error-sanitizer.js');
const { validateCredentialCreation, validateCredentialUpdate, validateCredentialId } = require('../../lib/server/input-validator.js');
const {
  logCredentialAccess,
  logCredentialCreate,
  logCredentialUpdate,
  logCredentialDelete,
  logInputValidationFailure,
} = require('../../../electron/security-logger.js');

function createCredentialsRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const credentials = await credentialsService.listCredentials(req.query || {});
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
      res.status(201).json(credential);
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
      res.json(credential);
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
    try {
      const id = req.params?.id || req.query?.id;

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

  return router;
}

module.exports = { createCredentialsRouter };
