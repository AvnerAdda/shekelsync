const express = require('express');

const dataExportService = require('../services/data/export.js');

function createDataExportRouter() {
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
      if (error?.error) {
        res
          .status(error.error.code === 'EXPORT_ERROR' ? 500 : 400)
          .json(error);
      } else {
        res.status(500).json({
          error: 'Failed to export data',
          message: error?.message || 'Internal server error',
        });
      }
    }
  });

  return router;
}

module.exports = { createDataExportRouter };
