const express = require('express');

const credentialsService = require('../services/credentials.js');

function createCredentialsRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const credentials = await credentialsService.listCredentials(req.query || {});
      res.json(credentials);
    } catch (error) {
      console.error('Credentials list error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to fetch credentials',
        details: error?.details || error?.stack,
      });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const credential = await credentialsService.createCredential(req.body || {});
      res.status(201).json(credential);
    } catch (error) {
      console.error('Credential create error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to create credential',
        details: error?.details || error?.stack,
      });
    }
  });

  const handleUpdate = async (req, res) => {
    try {
      const id = req.params?.id || req.query?.id || req.body?.id;
      const credential = await credentialsService.updateCredential({ ...(req.body || {}), id });
      res.json(credential);
    } catch (error) {
      console.error('Credential update error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to update credential',
        details: error?.details || error?.stack,
      });
    }
  };

  router.put('/', handleUpdate);
  router.put('/:id', handleUpdate);
  router.patch('/', handleUpdate);
  router.patch('/:id', handleUpdate);

  const handleDelete = async (req, res) => {
    try {
      const id = req.params?.id || req.query?.id;
      const result = await credentialsService.deleteCredential({ id });
      res.json(result);
    } catch (error) {
      console.error('Credential delete error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to delete credential',
        details: error?.details || error?.stack,
      });
    }
  };

  router.delete('/', handleDelete);
  router.delete('/:id', handleDelete);

  return router;
}

module.exports = { createCredentialsRouter };
