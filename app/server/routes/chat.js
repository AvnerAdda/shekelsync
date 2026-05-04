const express = require('express');

const chatService = require('../services/chat.js');

function getHeaderValue(headers, key) {
  const value = headers?.[key];
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }
  return typeof value === 'string' ? value : null;
}

function withResolvedOpenAiApiKey(req) {
  const payload = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  const headerApiKey = getHeaderValue(req.headers, 'x-openai-api-key');
  const bodyApiKey = typeof payload.openaiApiKey === 'string' ? payload.openaiApiKey.trim() : '';
  const resolvedApiKey = typeof headerApiKey === 'string' && headerApiKey.trim().length > 0
    ? headerApiKey.trim()
    : bodyApiKey;

  if (resolvedApiKey) {
    payload.openaiApiKey = resolvedApiKey;
  }

  return payload;
}

function createChatRouter() {
  const router = express.Router();

  /**
   * POST /api/chat
   * Process a chat message
   * Body: { message, conversationId?, permissions, locale?, openaiApiKey? }
   */
  router.post('/', async (req, res) => {
    console.log('[chat-route] Received request with body:', JSON.stringify({
      message: req.body?.message?.substring(0, 50),
      conversationId: req.body?.conversationId,
      permissions: req.body?.permissions,
      locale: req.body?.locale,
    }));
    try {
      const result = await chatService.processMessage(withResolvedOpenAiApiKey(req));
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
   * POST /api/chat/stream
   * Process a chat message with streaming response (SSE)
   */
  router.post('/stream', async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    try {
      await chatService.processMessageStream(withResolvedOpenAiApiKey(req), (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
    } catch (error) {
      console.error('[chat-route] Stream error:', error);
      res.write(`data: ${JSON.stringify({ type: 'error', message: error?.message || 'Stream failed' })}\n\n`);
    } finally {
      res.end();
    }
  });

  /**
   * GET /api/chat/suggestions
   * Get smart suggested questions based on financial data
   * Query: { transactions, categories, analytics, locale }
   */
  router.get('/suggestions', async (req, res) => {
    try {
      const suggestions = await chatService.getSuggestions({
        permissions: {
          allowTransactionAccess: req.query.transactions === 'true',
          allowCategoryAccess: req.query.categories === 'true',
          allowAnalyticsAccess: req.query.analytics === 'true',
        },
        locale: req.query.locale || 'en',
      });
      res.json({ suggestions });
    } catch (error) {
      console.error('[chat-route] Suggestions error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to get suggestions',
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
