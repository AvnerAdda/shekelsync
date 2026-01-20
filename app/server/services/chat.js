/**
 * Chat Service
 * Main service for AI-powered financial chatbot using OpenAI GPT-4o-mini
 */

const database = require('./database.js');
const { createCompletion, isConfigured, estimateTokens } = require('./chat/openai-client.js');
const { createAnonymizer, anonymizeContext } = require('./chat/data-anonymizer.js');
const { createSandbox, validateSQL } = require('./chat/code-sandbox.js');
const {
  createConversation,
  getConversation,
  addMessage,
  getMessagesForAPI,
  generateTitle,
  updateTitle,
} = require('./chat/conversation-store.js');
const { buildContext, formatContextForPrompt, getSchemaDescription } = require('./chat/financial-context.js');
const { TOOLS, getSystemPrompt, getErrorMessage } = require('./chat/prompts.js');

// Rate limiting state
const rateLimiter = {
  requests: new Map(),
  maxRequestsPerMinute: 20,

  checkLimit() {
    const key = 'global'; // Single user app
    const now = Date.now();
    const state = this.requests.get(key) || { count: 0, resetTime: now + 60000 };

    if (now > state.resetTime) {
      state.count = 0;
      state.resetTime = now + 60000;
    }

    if (state.count >= this.maxRequestsPerMinute) {
      return { allowed: false, retryAfter: Math.ceil((state.resetTime - now) / 1000) };
    }

    state.count++;
    this.requests.set(key, state);
    return { allowed: true };
  },
};

function serviceError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details) {
    error.details = details;
  }
  return error;
}

/**
 * Process a tool call from OpenAI
 * @param {Object} toolCall - The tool call from OpenAI
 * @param {Object} sandbox - The code sandbox instance
 * @param {Object} context - Execution context with data
 * @returns {Promise<Object>} Tool result
 */
async function processToolCall(toolCall, sandbox, context) {
  const { name, arguments: argsStr } = toolCall.function;

  let args;
  try {
    args = JSON.parse(argsStr);
  } catch {
    return { success: false, error: 'Invalid tool arguments' };
  }

  if (name === 'execute_sql_query') {
    const { query, explanation } = args;

    // Validate SQL
    const validation = validateSQL(query);
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error,
        explanation,
      };
    }

    // Execute query
    const result = await sandbox.executeSQL(query);
    return {
      ...result,
      explanation,
      query,
    };
  }

  if (name === 'execute_calculation') {
    const { code, explanation } = args;

    // Execute code with available data
    const result = await sandbox.executeCode(code, context.calculationData || {});
    return {
      ...result,
      explanation,
    };
  }

  return { success: false, error: `Unknown tool: ${name}` };
}

/**
 * Process a chat message with OpenAI
 * @param {Object} payload - Request payload
 * @returns {Promise<Object>} Chat response
 */
async function processMessage(payload = {}) {
  const {
    message,
    conversationId,
    permissions = {},
    locale = 'en',
  } = payload;

  // Validate message
  if (!message || typeof message !== 'string') {
    throw serviceError(400, 'Message is required');
  }

  // Check if OpenAI is configured
  if (!isConfigured()) {
    throw serviceError(503, 'AI service not configured', 'OpenAI API key is missing');
  }

  // Rate limiting
  const rateCheck = rateLimiter.checkLimit();
  if (!rateCheck.allowed) {
    throw serviceError(429, getErrorMessage('rate_limited', locale), { retryAfter: rateCheck.retryAfter });
  }

  // Default permissions (all off for safety)
  const perms = {
    allowTransactionAccess: permissions.allowTransactionAccess || false,
    allowCategoryAccess: permissions.allowCategoryAccess || false,
    allowAnalyticsAccess: permissions.allowAnalyticsAccess || false,
  };

  console.log('[chat] Processing message with permissions:', JSON.stringify(perms));

  const client = await getDatabase().getClient();

  try {
    // Create or get conversation
    let conversation;
    let isNewConversation = false;

    if (conversationId) {
      conversation = await getConversation(client, conversationId, false);
      if (!conversation) {
        throw serviceError(404, 'Conversation not found');
      }
    } else {
      conversation = await createConversation(client);
      isNewConversation = true;
    }

    // Build financial context
    let financialContext;
    try {
      financialContext = await buildContext(client, perms);
      console.log('[chat] Financial context built:', {
        hasData: financialContext.hasData,
        transactionCount: financialContext.summary?.transactionCount,
        categoriesCount: financialContext.categories?.length,
        budgetsCount: financialContext.budgets?.length,
      });
    } catch (contextError) {
      console.error('[chat] ERROR building financial context:', contextError);
      // Use empty context on error
      financialContext = { hasData: false, permissions: perms, summary: { transactionCount: 0 } };
    }

    // Create anonymizer for this conversation
    const anonymizer = createAnonymizer();
    const anonymizedContext = anonymizeContext(financialContext, anonymizer);

    // Format context for prompt
    const contextString = formatContextForPrompt(anonymizedContext);
    const schemaDesc = perms.allowTransactionAccess ? getSchemaDescription() : '';

    // Build system prompt
    const systemPrompt = getSystemPrompt(locale, contextString, schemaDesc, perms);

    console.log('[chat] Context string preview:', contextString.substring(0, 500));
    console.log('[chat] System prompt length:', systemPrompt.length);

    // Get conversation history
    const historyMessages = conversationId
      ? await getMessagesForAPI(client, conversationId, 20)
      : [];

    // Build messages array for OpenAI
    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: message },
    ];

    // Create sandbox for tool execution
    const sandbox = createSandbox(async (sql) => {
      const result = await client.query(sql);
      return result.rows;
    });

    // Determine which tools to provide based on permissions
    const availableTools = [];
    if (perms.allowTransactionAccess || perms.allowCategoryAccess) {
      availableTools.push(TOOLS[0]); // execute_sql_query
    }
    if (perms.allowAnalyticsAccess) {
      availableTools.push(TOOLS[1]); // execute_calculation
    }

    // Track tool execution data for calculations
    const calculationData = {
      queryResults: {},
    };

    let response;
    let totalTokensUsed = 0;
    let toolExecutions = [];

    // Call OpenAI (with potential tool call loop)
    let attempts = 0;
    const maxAttempts = 5; // Prevent infinite loops

    while (attempts < maxAttempts) {
      attempts++;

      const result = await createCompletion(
        messages,
        availableTools.length > 0 ? availableTools : null,
        { model: 'gpt-4o-mini' }
      );

      if (!result.success) {
        throw serviceError(502, result.userMessage || 'AI service error');
      }

      totalTokensUsed += result.usage?.total_tokens || 0;

      // Check for tool calls
      if (result.message.tool_calls && result.message.tool_calls.length > 0) {
        // Add assistant message with tool calls (ensure content is not null)
        messages.push({
          ...result.message,
          content: result.message.content || '',
        });

        // Process each tool call
        for (const toolCall of result.message.tool_calls) {
          const toolResult = await processToolCall(toolCall, sandbox, { calculationData });

          // Store query results for subsequent calculations
          if (toolResult.success && toolResult.data) {
            calculationData.queryResults[toolCall.id] = toolResult.data;
            calculationData.lastQueryResult = toolResult.data;
          }

          // Track tool execution for metadata
          toolExecutions.push({
            tool: toolCall.function.name,
            explanation: toolResult.explanation,
            success: toolResult.success,
            rowCount: toolResult.rowCount,
            error: toolResult.error,
          });

          // Add tool result to messages (ensure content is never null)
          const toolContent = toolResult.success
            ? (toolResult.data || toolResult.result || { success: true })
            : { error: toolResult.error || 'Unknown error' };
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolContent),
          });
        }

        // Continue loop to get final response
        continue;
      }

      // No tool calls - we have the final response
      response = result.message.content;
      break;
    }

    // Clean up sandbox
    sandbox.dispose();

    if (!response) {
      throw serviceError(500, 'Failed to generate response');
    }

    // Store messages in conversation
    await addMessage(client, conversation.id, {
      role: 'user',
      content: message,
      tokensUsed: estimateTokens(message),
    });

    await addMessage(client, conversation.id, {
      role: 'assistant',
      content: response,
      tokensUsed: totalTokensUsed,
      metadata: toolExecutions.length > 0 ? { toolExecutions } : null,
    });

    // Generate title for new conversations
    if (isNewConversation) {
      const title = generateTitle(message);
      await updateTitle(client, conversation.externalId, title);
    }

    return {
      response,
      conversationId: conversation.externalId,
      isNewConversation,
      timestamp: new Date().toISOString(),
      metadata: {
        model: 'gpt-4o-mini',
        tokensUsed: totalTokensUsed,
        toolExecutions: toolExecutions.length > 0 ? toolExecutions : undefined,
        contextIncluded: {
          transactions: perms.allowTransactionAccess,
          categories: perms.allowCategoryAccess,
          analytics: perms.allowAnalyticsAccess,
        },
      },
    };

  } catch (error) {
    if (error.status) {
      throw error;
    }
    console.error('Chat processing error:', error);
    throw serviceError(500, 'Failed to process chat message', error.message);
  } finally {
    client.release();
  }
}

/**
 * Get conversation history
 * @param {string} conversationId - The conversation's external UUID
 * @returns {Promise<Object>} Conversation with messages
 */
async function getConversationHistory(conversationId) {
  if (!conversationId) {
    throw serviceError(400, 'Conversation ID is required');
  }

  const client = await getDatabase().getClient();

  try {
    const conversation = await getConversation(client, conversationId, true);

    if (!conversation) {
      throw serviceError(404, 'Conversation not found');
    }

    return conversation;
  } finally {
    client.release();
  }
}

/**
 * List all conversations
 * @param {Object} options - List options
 * @returns {Promise<Array>} Array of conversations
 */
async function listConversations(options = {}) {
  const { listConversations: listConvs } = require('./chat/conversation-store.js');

  const client = await getDatabase().getClient();

  try {
    return await listConvs(client, options);
  } finally {
    client.release();
  }
}

/**
 * Delete a conversation
 * @param {string} conversationId - The conversation's external UUID
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteConversation(conversationId) {
  if (!conversationId) {
    throw serviceError(400, 'Conversation ID is required');
  }

  const { deleteConversation: deleteConv } = require('./chat/conversation-store.js');

  const client = await getDatabase().getClient();

  try {
    const deleted = await deleteConv(client, conversationId);

    if (!deleted) {
      throw serviceError(404, 'Conversation not found');
    }

    return true;
  } finally {
    client.release();
  }
}

// Test helpers for dependency injection
let testDatabase = null;

function __setDatabase(db) {
  testDatabase = db;
}

function __resetDatabase() {
  testDatabase = null;
}

function getDatabase() {
  return testDatabase || database;
}

module.exports = {
  processMessage,
  getConversationHistory,
  listConversations,
  deleteConversation,
  __setDatabase,
  __resetDatabase,
};
module.exports.default = module.exports;
