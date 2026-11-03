const express = require('express');
const { sanitizeStructuredError } = require('../../lib/server/error-sanitizer.js');

function createDataExportRouter({ services = {} } = {}) {
  const dataExportService = services.dataExportService || require('../services/data/export.js');
  const router = express.Router();

  router.get('/export', async (req, res) => {
    try {
      const result = await dataExportService.exportData(req.query || {});
      res.setHeader('Content-Type', result.contentType);
      if (result.filename) {
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      }

      if (result.format === 'json') {
        res.json(result.body);
      } else {
        res.send(result.body);
      }
    } catch (error) {
      console.error('Data export error:', error);
      const sanitized = sanitizeStructuredError(error, {
        defaultCode: 'EXPORT_ERROR',
        defaultMessage: 'Failed to export data',
        clientErrors: {
          INVALID_FORMAT: 'Invalid export format',
          INVALID_DATA_TYPE: 'Invalid export data type',
          VALIDATION_ERROR: 'Invalid export parameters',
        },
      });
      res.status(sanitized.statusCode).json(sanitized.response);
    }
  });

  return router;
}

module.exports = { createDataExportRouter };
