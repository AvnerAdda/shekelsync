const express = require('express');

const chatService = require('../services/chat.js');

function createChatRouter() {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const result = await chatService.processMessage(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Chat route error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to process chat message',
        ...(error?.details ? { details: error.details } : {}),
      });
    }
  });

  return router;
}

module.exports = { createChatRouter };
