const express = require('express');

const chatService = require('../services/chat.js');
const donationsService = require('../services/donations.js');

function getHeaderValue(headers, key) {
  const value = headers?.[key];
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }
  return typeof value === 'string' ? value : null;
}

function getSupporterContext(req) {
  return {
    accessToken: getHeaderValue(req.headers, 'x-auth-access-token'),
    userId: getHeaderValue(req.headers, 'x-auth-user-id'),
    email: getHeaderValue(req.headers, 'x-auth-user-email'),
    name: getHeaderValue(req.headers, 'x-auth-user-name'),
  };
}

async function assertAiAgentAccess(req) {
  const status = await donationsService.getDonationStatus(getSupporterContext(req));
  if (status?.canAccessAiAgent) {
    return status;
  }

  const error = new Error('AI Agent requires a verified supporter plan (Bronze or higher).');
  error.status = 403;
  error.code = 'SUPPORT_PLAN_REQUIRED';
  error.details = {
    requiredPlan: 'bronze',
    currentTier: status?.tier || 'none',
    supportStatus: status?.supportStatus || 'none',
  };
  throw error;
}

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
      await assertAiAgentAccess(req);
      const result = await chatService.processMessage(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('[chat-route] Error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to process chat message',
        ...(error?.code ? { code: error.code } : {}),
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
      await assertAiAgentAccess(req);
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
      await assertAiAgentAccess(req);
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
      await assertAiAgentAccess(req);
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
