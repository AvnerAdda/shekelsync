const express = require('express');
const { sanitizeError, sanitizeErrorForLogging } = require('../../lib/server/error-sanitizer.js');
const { validateCredentialId } = require('../../lib/server/input-validator.js');

function createStatementImportRouter({ services = {} } = {}) {
  const statementImportService = services.statementImportService || require('../services/statement-import.js');
  const router = express.Router();

  const parseRequest = (req) => {
    const body = req.body || {};
    const idValidation = validateCredentialId(body.credentialId);
    if (!idValidation.valid) {
      return { error: idValidation.error };
    }
    const accountNumber = body.accountNumber === undefined || body.accountNumber === null
      ? null
      : String(body.accountNumber).slice(0, 64);
    return {
      params: {
        credentialId: idValidation.value,
        accountNumber,
        rows: body.rows,
        includeDuplicateIndexes: body.includeDuplicateIndexes,
      },
    };
  };

  const sendError = (req, res, error, defaultMessage) => {
    const statusCode = error?.statusCode || 500;
    const isClientError = statusCode < 500;
    if (!isClientError) {
      console.error(
        '[StatementImport] error:',
        sanitizeErrorForLogging(error, { path: req.path, method: req.method }),
      );
    }
    const sanitized = sanitizeError(error, {
      statusCode,
      defaultMessage,
      includeStack: false,
      exposeMessage: isClientError,
    });
    res.status(statusCode).json({ ...sanitized, code: isClientError ? error?.code || null : null });
  };

  // Pairs each statement row with what is already in the ledger. Writes nothing.
  router.post('/preview', async (req, res) => {
    const parsed = parseRequest(req);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    try {
      const { includeDuplicateIndexes: _ignored, ...params } = parsed.params;
      res.json(await statementImportService.previewStatementImport(params));
    } catch (error) {
      sendError(req, res, error, 'Failed to read the statement');
    }
  });

  router.post('/commit', async (req, res) => {
    const parsed = parseRequest(req);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    try {
      res.json(await statementImportService.commitStatementImport(parsed.params));
    } catch (error) {
      sendError(req, res, error, 'Failed to import the statement');
    }
  });

  return router;
}

module.exports = { createStatementImportRouter };
