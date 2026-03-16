/**
 * OpenAI Streaming Module
 * Handles streaming completions from OpenAI API
 */

const { getClient } = require('./openai-client.js');

/**
 * Create a streaming chat completion
 * @param {Array} messages - Message array for OpenAI
 * @param {Array|null} tools - Tool definitions
 * @param {Object} options - Options (model, apiKey, maxTokens, temperature)
 * @param {Function} onEvent - Callback for stream events
 * @returns {Promise<Object>} Final result with usage info
 */
async function createStreamingCompletion(messages, tools, options = {}, onEvent) {
  const client = getClient({ apiKey: options.apiKey });

  const requestParams = {
    model: options.model || 'gpt-4o-mini',
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 4096,
    stream: true,
  };

  if (tools && tools.length > 0) {
    requestParams.tools = tools;
    requestParams.tool_choice = options.toolChoice || 'auto';
  }

  const stream = await client.chat.completions.create(requestParams);

  let contentBuffer = '';
  let toolCalls = [];
  let currentToolCall = null;
  let finishReason = null;
  let totalTokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    const chunkFinishReason = chunk.choices?.[0]?.finish_reason;

    if (chunk.usage) {
      totalTokens = chunk.usage.total_tokens || 0;
    }

    if (!delta) {
      if (chunkFinishReason) {
        finishReason = chunkFinishReason;
      }
      continue;
    }

    // Handle content tokens
    if (delta.content) {
      contentBuffer += delta.content;
      onEvent({ type: 'token', content: delta.content });
    }

    // Handle tool call deltas
    if (delta.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const idx = toolCallDelta.index;

        if (toolCallDelta.id) {
          // Start of a new tool call
          currentToolCall = {
            id: toolCallDelta.id,
            type: 'function',
            function: {
              name: toolCallDelta.function?.name || '',
              arguments: toolCallDelta.function?.arguments || '',
            },
          };
          toolCalls[idx] = currentToolCall;
          onEvent({ type: 'tool_call_start', tool: currentToolCall.function.name });
        } else if (toolCalls[idx]) {
          // Continuation of existing tool call arguments
          if (toolCallDelta.function?.arguments) {
            toolCalls[idx].function.arguments += toolCallDelta.function.arguments;
          }
          if (toolCallDelta.function?.name) {
            toolCalls[idx].function.name += toolCallDelta.function.name;
          }
        }
      }
    }

    if (chunkFinishReason) {
      finishReason = chunkFinishReason;
    }
  }

  // Filter out undefined entries from sparse array
  const completedToolCalls = toolCalls.filter(Boolean);

  return {
    content: contentBuffer,
    toolCalls: completedToolCalls.length > 0 ? completedToolCalls : null,
    finishReason,
    usage: { total_tokens: totalTokens },
  };
}

module.exports = {
  createStreamingCompletion,
};
