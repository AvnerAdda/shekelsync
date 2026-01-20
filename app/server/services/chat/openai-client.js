/**
 * OpenAI Client Module
 * Handles all communication with OpenAI API
 */

const OpenAI = require('openai');

let openaiClient = null;

/**
 * Initialize the OpenAI client with API key from environment
 * @returns {OpenAI} The OpenAI client instance
 */
function getClient() {
  if (!openaiClient) {
    const apiKey = process.env.API_OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Set API_OPENAI_API_KEY in environment.');
    }

    openaiClient = new OpenAI({
      apiKey,
      maxRetries: 3,
      timeout: 60000, // 60 second timeout
    });
  }

  return openaiClient;
}

/**
 * Create a chat completion with the OpenAI API
 * @param {Array} messages - Array of message objects with role and content
 * @param {Array} tools - Optional array of tool definitions
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The completion response
 */
async function createCompletion(messages, tools = null, options = {}) {
  const client = getClient();

  const requestParams = {
    model: options.model || 'gpt-4o-mini',
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 4096,
  };

  if (tools && tools.length > 0) {
    requestParams.tools = tools;
    requestParams.tool_choice = options.toolChoice || 'auto';
  }

  try {
    const response = await client.chat.completions.create(requestParams);

    return {
      success: true,
      message: response.choices[0].message,
      finishReason: response.choices[0].finish_reason,
      usage: response.usage,
      model: response.model,
    };
  } catch (error) {
    return handleOpenAIError(error);
  }
}

/**
 * Handle OpenAI API errors with appropriate responses
 * @param {Error} error - The error from OpenAI API
 * @returns {Object} Formatted error response
 */
function handleOpenAIError(error) {
  // Rate limited
  if (error.status === 429) {
    const retryAfter = parseInt(error.headers?.['retry-after'] || '30', 10);
    return {
      success: false,
      error: 'rate_limited',
      userMessage: 'The assistant is currently busy. Please try again in a moment.',
      retryAfter,
      shouldRetry: true,
    };
  }

  // Invalid API key
  if (error.status === 401) {
    console.error('OpenAI API key invalid or expired');
    return {
      success: false,
      error: 'auth_error',
      userMessage: 'The assistant is temporarily unavailable. Please try again later.',
      shouldRetry: false,
    };
  }

  // Server error
  if (error.status >= 500) {
    return {
      success: false,
      error: 'server_error',
      userMessage: 'The AI service is experiencing issues. Please try again.',
      shouldRetry: true,
      retryAfter: 5,
    };
  }

  // Timeout or network error
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
    return {
      success: false,
      error: 'timeout',
      userMessage: 'Request timed out. Please try a simpler question.',
      shouldRetry: true,
    };
  }

  // Context length exceeded
  if (error.code === 'context_length_exceeded') {
    return {
      success: false,
      error: 'context_too_long',
      userMessage: 'The conversation is too long. Please start a new conversation.',
      shouldRetry: false,
    };
  }

  // Unknown error
  console.error('Unknown OpenAI error:', error.message);
  return {
    success: false,
    error: 'unknown',
    userMessage: 'An unexpected error occurred. Please try again.',
    shouldRetry: false,
  };
}

/**
 * Estimate token count for a text string (rough approximation)
 * @param {string} text - The text to estimate tokens for
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text) return 0;
  // Rough estimation: ~4 characters per token for English
  // Hebrew text tends to use more tokens per character
  const avgCharsPerToken = 3.5;
  return Math.ceil(text.length / avgCharsPerToken);
}

/**
 * Check if API key is configured
 * @returns {boolean} True if API key is available
 */
function isConfigured() {
  return !!process.env.API_OPENAI_API_KEY;
}

// For testing
function __resetClient() {
  openaiClient = null;
}

module.exports = {
  getClient,
  createCompletion,
  handleOpenAIError,
  estimateTokens,
  isConfigured,
  __resetClient,
};
