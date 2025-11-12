const express = require('express');

const database = require('../services/database.js');
const {
  getAllInstitutions,
  getInstitutionById,
  getInstitutionByVendorCode,
  clearInstitutionsCache,
} = require('../services/institutions.js');

function parseBoolean(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return undefined;
}

function createInstitutionsRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { type, category, scrapable, refreshCache, vendor } = req.query || {};

      if (refreshCache === 'true' || refreshCache === '1') {
        clearInstitutionsCache();
      }

      if (vendor) {
        const institution = await getInstitutionByVendorCode(database, vendor);
        if (!institution) {
          return res.status(404).json({ error: 'Institution not found' });
        }
        return res.json({ institution });
      }

      const filters = {};
      if (type) filters.type = String(type);
      if (category) filters.category = String(category);
      const scrapableFilter = parseBoolean(scrapable);
      if (scrapableFilter !== undefined) {
        filters.scrapable = scrapableFilter;
      }

      const institutions = await getAllInstitutions(database, filters);
      res.json({ institutions });
    } catch (error) {
      console.error('Institutions list error:', error);
      res.status(500).json({
        error: 'Failed to fetch institutions',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const institution = await getInstitutionById(database, Number(id));
      if (!institution) {
        return res.status(404).json({ error: 'Institution not found' });
      }
      res.json({ institution });
    } catch (error) {
      console.error('Institution fetch error:', error);
      res.status(500).json({
        error: 'Failed to fetch institution',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });

  return router;
}

module.exports = { createInstitutionsRouter };
