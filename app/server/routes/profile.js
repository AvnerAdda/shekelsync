const express = require('express');

const profileService = require('../services/profile.js');

function createProfileRouter() {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      const result = await profileService.getProfile();
      res.json(result);
    } catch (error) {
      console.error('Profile fetch error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: 'Failed to fetch profile',
        details: error?.stack,
      });
    }
  });

  router.put('/', async (req, res) => {
    try {
      const result = await profileService.saveProfile(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Profile update error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: 'Failed to update profile',
        details: error?.stack,
      });
    }
  });

  return router;
}

module.exports = { createProfileRouter };
