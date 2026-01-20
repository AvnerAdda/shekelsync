const express = require('express');

const chatService = require('../services/chat.js');

function createChatRouter() {
  const router = express.Router();

  /**
   * POST /api/chat
   * Process a chat message
   * Body: { message, conversationId?, permissions, locale? }
   */
  router.post('/', async (req, res) => {
    console.log('[chat-route] Received request with body:', JSON.stringify({
      message: req.body?.message?.substring(0, 50),
      conversationId: req.body?.conversationId,
      permissions: req.body?.permissions,
      locale: req.body?.locale,
    }));
    try {
      const result = await chatService.processMessage(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('[chat-route] Error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to process chat message',
        ...(error?.details ? { details: error.details } : {}),
        ...(error?.retryAfter ? { retryAfter: error.retryAfter } : {}),
      });
    }
  });

  /**
   * GET /api/chat/conversations
   * List all conversations
   * Query: { limit?, offset?, includeArchived? }
   */
  router.get('/conversations', async (req, res) => {
    try {
      const options = {
        limit: parseInt(req.query.limit, 10) || 20,
        offset: parseInt(req.query.offset, 10) || 0,
        includeArchived: req.query.includeArchived === 'true',
      };

      const conversations = await chatService.listConversations(options);
      res.json({ conversations });
    } catch (error) {
      console.error('List conversations error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to list conversations',
      });
    }
  });

  /**
   * GET /api/chat/conversations/:id
   * Get a specific conversation with messages
   */
  router.get('/conversations/:id', async (req, res) => {
    try {
      const conversation = await chatService.getConversationHistory(req.params.id);
      res.json(conversation);
    } catch (error) {
      console.error('Get conversation error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to get conversation',
      });
    }
  });

  /**
   * DELETE /api/chat/conversations/:id
   * Delete a conversation
   */
  router.delete('/conversations/:id', async (req, res) => {
    try {
      await chatService.deleteConversation(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Delete conversation error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to delete conversation',
      });
    }
  });

  return router;
}

module.exports = { createChatRouter };
