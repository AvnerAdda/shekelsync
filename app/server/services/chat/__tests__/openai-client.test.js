import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientModule = require('../openai-client.js');

function withNodeLikeRuntime(fn) {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const hadNavigator = Object.prototype.hasOwnProperty.call(globalThis, 'navigator');
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;

  Object.defineProperty(globalThis, 'window', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: undefined,
    configurable: true,
    writable: true,
  });

  const restore = () => {
    if (hadWindow) {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    } else {
      delete globalThis.window;
    }

    if (hadNavigator) {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
        writable: true,
      });
    } else {
      delete globalThis.navigator;
    }
  };

  try {
    const value = fn();
    if (value && typeof value.then === 'function') {
      return value.finally(restore);
    }
    restore();
    return value;
  } catch (error) {
    restore();
    throw error;
  }
}

describe('openai-client', () => {
  beforeEach(() => {
    clientModule.__resetClient();
  });

  afterEach(() => {
    clientModule.__resetClient();
    vi.restoreAllMocks();
  });

  it('reports configuration state based on request-level API key', () => {
    expect(clientModule.isConfigured()).toBe(false);
    expect(clientModule.isConfigured({ apiKey: 'sk-user-key' })).toBe(true);
  });

  it('accepts request-level api keys without env configuration', async () => {
    await withNodeLikeRuntime(() => {
      const client = clientModule.getClient({ apiKey: 'sk-user-only' });
      expect(client).toBeTruthy();
      expect(clientModule.isConfigured({ apiKey: 'sk-user-only' })).toBe(true);
    });
  });

  it('throws when API key is missing and caches client when configured', async () => {
    expect(() => clientModule.getClient()).toThrow('OpenAI API key not configured');

    await withNodeLikeRuntime(() => {
      const first = clientModule.getClient({ apiKey: 'test-key' });
      const second = clientModule.getClient({ apiKey: 'test-key' });
      expect(first).toBe(second);
    });
  });

  it('creates completions with defaults and optional tools payload', async () => {
    await withNodeLikeRuntime(async () => {
      const rawClient = clientModule.getClient({ apiKey: 'test-key' });
      const createSpy = vi
        .spyOn(rawClient.chat.completions, 'create')
        .mockResolvedValue({
          choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
          usage: { total_tokens: 12 },
          model: 'gpt-4o-mini',
        });

      const withoutTools = await clientModule.createCompletion(
        [{ role: 'user', content: 'hi' }],
        null,
        { apiKey: 'test-key' },
      );
      expect(withoutTools).toEqual({
        success: true,
        message: { role: 'assistant', content: 'hello' },
        finishReason: 'stop',
        usage: { total_tokens: 12 },
        model: 'gpt-4o-mini',
      });
      expect(createSpy).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.7,
        max_tokens: 1200,
      });

      await clientModule.createCompletion(
        [{ role: 'user', content: 'tools please' }],
        [{ type: 'function', function: { name: 'demo_tool' } }],
        {
          apiKey: 'test-key',
          model: 'gpt-4.1-mini',
          temperature: 0.1,
          maxTokens: 256,
          toolChoice: 'required',
        },
      );

      expect(createSpy).toHaveBeenLastCalledWith({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: 'tools please' }],
        temperature: 0.1,
        max_tokens: 256,
        tools: [{ type: 'function', function: { name: 'demo_tool' } }],
        tool_choice: 'required',
      });

      await clientModule.createCompletion(
        [{ role: 'user', content: 'cap test' }],
        null,
        { apiKey: 'test-key', maxTokens: 99999 },
      );
      expect(createSpy).toHaveBeenLastCalledWith({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'cap test' }],
        temperature: 0.7,
        max_tokens: 1500,
      });
    });
  });

  it('maps completion errors through handleOpenAIError', async () => {
    await withNodeLikeRuntime(async () => {
      const rawClient = clientModule.getClient({ apiKey: 'test-key' });
      vi.spyOn(rawClient.chat.completions, 'create').mockRejectedValue({
        status: 429,
        headers: { 'retry-after': '45' },
        message: 'rate limit',
      });

      const out = await clientModule.createCompletion(
        [{ role: 'user', content: 'hello' }],
        null,
        { apiKey: 'test-key' },
      );
      expect(out).toEqual({
        success: false,
        error: 'rate_limited',
        userMessage: 'The assistant is currently busy. Please try again in a moment.',
        retryAfter: 45,
        shouldRetry: true,
      });
    });
  });

  it('handles known OpenAI error branches', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(clientModule.handleOpenAIError({ status: 429, headers: {}, message: 'slow down' })).toEqual({
      success: false,
      error: 'rate_limited',
      userMessage: 'The assistant is currently busy. Please try again in a moment.',
      retryAfter: 30,
      shouldRetry: true,
    });

    expect(clientModule.handleOpenAIError({ status: 401, message: 'bad key' })).toEqual({
      success: false,
      error: 'auth_error',
      userMessage: 'The assistant is temporarily unavailable. Please try again later.',
      shouldRetry: false,
    });

    expect(clientModule.handleOpenAIError({ status: 503, message: 'upstream down' })).toEqual({
      success: false,
      error: 'server_error',
      userMessage: 'The AI service is experiencing issues. Please try again.',
      shouldRetry: true,
      retryAfter: 5,
    });

    expect(clientModule.handleOpenAIError({ code: 'ETIMEDOUT', message: 'timed out' })).toEqual({
      success: false,
      error: 'timeout',
      userMessage: 'Request timed out. Please try a simpler question.',
      shouldRetry: true,
    });

    expect(clientModule.handleOpenAIError({ code: 'ECONNRESET', message: 'socket reset' })).toEqual({
      success: false,
      error: 'timeout',
      userMessage: 'Request timed out. Please try a simpler question.',
      shouldRetry: true,
    });

    expect(clientModule.handleOpenAIError({ code: 'context_length_exceeded', message: 'too long' })).toEqual({
      success: false,
      error: 'context_too_long',
      userMessage: 'The conversation is too long. Please start a new conversation.',
      shouldRetry: false,
    });

    expect(clientModule.handleOpenAIError({ message: 'whoops' })).toEqual({
      success: false,
      error: 'unknown',
      userMessage: 'An unexpected error occurred. Please try again.',
      shouldRetry: false,
    });

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('estimates token counts', () => {
    expect(clientModule.estimateTokens('')).toBe(0);
    expect(clientModule.estimateTokens(null)).toBe(0);
    expect(clientModule.estimateTokens('1234567')).toBe(2);
  });

  it('resets cached client instance for tests', async () => {
    await withNodeLikeRuntime(() => {
      const first = clientModule.getClient({ apiKey: 'test-key' });
      clientModule.__resetClient();
      const second = clientModule.getClient({ apiKey: 'test-key' });
      expect(first).not.toBe(second);
    });
  });
});
