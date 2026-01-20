/**
 * Conversation Store Module
 * Handles persistence of chat conversations and messages in SQLite
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Create a new conversation
 * @param {Object} db - Database client
 * @param {Object} options - Conversation options
 * @returns {Promise<Object>} The created conversation
 */
async function createConversation(db, options = {}) {
  const externalId = uuidv4();
  const title = options.title || null;
  const metadata = options.metadata ? JSON.stringify(options.metadata) : null;

  const result = await db.query(`
    INSERT INTO chat_conversations (external_id, title, metadata, last_message_at)
    VALUES ($1, $2, $3, datetime('now'))
    RETURNING id, external_id, title, created_at, updated_at, message_count, total_tokens_used
  `, [externalId, title, metadata]);

  const conversation = result.rows[0];
  return {
    id: conversation.id,
    externalId: conversation.external_id,
    title: conversation.title,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
    messageCount: conversation.message_count,
    totalTokensUsed: conversation.total_tokens_used,
  };
}

/**
 * Get a conversation by external ID
 * @param {Object} db - Database client
 * @param {string} externalId - The conversation's external UUID
 * @param {boolean} includeMessages - Whether to include messages
 * @returns {Promise<Object|null>} The conversation or null
 */
async function getConversation(db, externalId, includeMessages = true) {
  const convResult = await db.query(`
    SELECT id, external_id, title, created_at, updated_at, last_message_at,
           message_count, total_tokens_used, is_archived, metadata
    FROM chat_conversations
    WHERE external_id = $1 AND is_archived = 0
  `, [externalId]);

  if (convResult.rows.length === 0) {
    return null;
  }

  const conv = convResult.rows[0];
  const conversation = {
    id: conv.id,
    externalId: conv.external_id,
    title: conv.title,
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
    lastMessageAt: conv.last_message_at,
    messageCount: conv.message_count,
    totalTokensUsed: conv.total_tokens_used,
    metadata: conv.metadata ? JSON.parse(conv.metadata) : null,
    messages: [],
  };

  if (includeMessages) {
    const msgResult = await db.query(`
      SELECT id, role, content, tool_calls, tool_call_id, tokens_used, created_at, metadata
      FROM chat_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
    `, [conv.id]);

    conversation.messages = msgResult.rows.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
      toolCallId: m.tool_call_id,
      tokensUsed: m.tokens_used,
      createdAt: m.created_at,
      metadata: m.metadata ? JSON.parse(m.metadata) : null,
    }));
  }

  return conversation;
}

/**
 * Add a message to a conversation
 * @param {Object} db - Database client
 * @param {number} conversationId - The internal conversation ID
 * @param {Object} message - The message to add
 * @returns {Promise<Object>} The created message
 */
async function addMessage(db, conversationId, message) {
  const toolCalls = message.toolCalls ? JSON.stringify(message.toolCalls) : null;
  const metadata = message.metadata ? JSON.stringify(message.metadata) : null;
  const tokensUsed = message.tokensUsed || null;

  const result = await db.query(`
    INSERT INTO chat_messages (conversation_id, role, content, tool_calls, tool_call_id, tokens_used, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, role, content, created_at
  `, [conversationId, message.role, message.content, toolCalls, message.toolCallId || null, tokensUsed, metadata]);

  // Update conversation stats
  await db.query(`
    UPDATE chat_conversations
    SET message_count = message_count + 1,
        total_tokens_used = total_tokens_used + COALESCE($2, 0),
        last_message_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = $1
  `, [conversationId, tokensUsed]);

  const msg = result.rows[0];
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.created_at,
  };
}

/**
 * List conversations (most recent first)
 * @param {Object} db - Database client
 * @param {Object} options - List options
 * @returns {Promise<Array>} Array of conversations
 */
async function listConversations(db, options = {}) {
  const limit = options.limit || 20;
  const offset = options.offset || 0;
  const includeArchived = options.includeArchived || false;

  const archivedClause = includeArchived ? '' : 'AND is_archived = 0';

  const result = await db.query(`
    SELECT id, external_id, title, created_at, updated_at, last_message_at,
           message_count, total_tokens_used, is_archived
    FROM chat_conversations
    WHERE 1=1 ${archivedClause}
    ORDER BY updated_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  return result.rows.map(conv => ({
    id: conv.id,
    externalId: conv.external_id,
    title: conv.title,
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
    lastMessageAt: conv.last_message_at,
    messageCount: conv.message_count,
    totalTokensUsed: conv.total_tokens_used,
    isArchived: conv.is_archived === 1,
  }));
}

/**
 * Update conversation title
 * @param {Object} db - Database client
 * @param {string} externalId - The conversation's external UUID
 * @param {string} title - The new title
 * @returns {Promise<boolean>} True if updated
 */
async function updateTitle(db, externalId, title) {
  const result = await db.query(`
    UPDATE chat_conversations
    SET title = $2, updated_at = datetime('now')
    WHERE external_id = $1
  `, [externalId, title]);

  return result.changes > 0;
}

/**
 * Archive (soft delete) a conversation
 * @param {Object} db - Database client
 * @param {string} externalId - The conversation's external UUID
 * @returns {Promise<boolean>} True if archived
 */
async function archiveConversation(db, externalId) {
  const result = await db.query(`
    UPDATE chat_conversations
    SET is_archived = 1, updated_at = datetime('now')
    WHERE external_id = $1
  `, [externalId]);

  return result.changes > 0;
}

/**
 * Permanently delete a conversation and its messages
 * @param {Object} db - Database client
 * @param {string} externalId - The conversation's external UUID
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteConversation(db, externalId) {
  // Get the internal ID first
  const conv = await db.query(
    'SELECT id FROM chat_conversations WHERE external_id = $1',
    [externalId]
  );

  if (conv.rows.length === 0) {
    return false;
  }

  const conversationId = conv.rows[0].id;

  // Delete messages first (cascade should handle this, but be explicit)
  await db.query('DELETE FROM chat_messages WHERE conversation_id = $1', [conversationId]);

  // Delete conversation
  const result = await db.query(
    'DELETE FROM chat_conversations WHERE id = $1',
    [conversationId]
  );

  return result.changes > 0;
}

/**
 * Get messages for OpenAI API format
 * @param {Object} db - Database client
 * @param {string} externalId - The conversation's external UUID
 * @param {number} limit - Maximum messages to retrieve
 * @returns {Promise<Array>} Array of messages in OpenAI format
 */
async function getMessagesForAPI(db, externalId, limit = 50) {
  const conv = await db.query(
    'SELECT id FROM chat_conversations WHERE external_id = $1 AND is_archived = 0',
    [externalId]
  );

  if (conv.rows.length === 0) {
    return [];
  }

  const conversationId = conv.rows[0].id;

  // Get recent messages (most recent first, then reverse)
  const result = await db.query(`
    SELECT role, content, tool_calls, tool_call_id
    FROM chat_messages
    WHERE conversation_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [conversationId, limit]);

  // Reverse to get chronological order
  const messages = result.rows.reverse();

  return messages.map(m => {
    const msg = { role: m.role, content: m.content };

    if (m.tool_calls) {
      msg.tool_calls = JSON.parse(m.tool_calls);
    }

    if (m.tool_call_id) {
      msg.tool_call_id = m.tool_call_id;
    }

    return msg;
  });
}

/**
 * Generate a title from the first user message
 * @param {string} message - The first user message
 * @returns {string} Generated title (truncated if needed)
 */
function generateTitle(message) {
  if (!message) return 'New Conversation';

  // Remove newlines and extra spaces
  const cleaned = message.replace(/\s+/g, ' ').trim();

  // Truncate to 50 characters
  if (cleaned.length <= 50) {
    return cleaned;
  }

  // Find a good break point
  const truncated = cleaned.substring(0, 50);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > 30) {
    return truncated.substring(0, lastSpace) + '...';
  }

  return truncated + '...';
}

module.exports = {
  createConversation,
  getConversation,
  addMessage,
  listConversations,
  updateTitle,
  archiveConversation,
  deleteConversation,
  getMessagesForAPI,
  generateTitle,
};
