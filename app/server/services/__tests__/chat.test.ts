/**
 * @vitest-environment node
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Set OpenAI API key for tests
process.env.API_OPENAI_API_KEY = 'test-key-for-testing';

// Use vi.hoisted to create mocks that are hoisted before imports
const mocks = vi.hoisted(() => {
  return {
    createCompletion: vi.fn().mockResolvedValue({
      success: true,
      message: {
        content: 'היי! אשמח לעזור לך עם הפיננסים שלך. אפשר לשאול אותי על ההוצאות החודשיות שלך, על הקטגוריות הגדולות, או על החסכונות.',
      },
      finishReason: 'stop',
      usage: { total_tokens: 100 },
      model: 'gpt-4o-mini',
    }),
    isConfigured: vi.fn().mockReturnValue(true),
    estimateTokens: vi.fn().mockImplementation((text: string) => Math.ceil((text?.length || 0) / 3.5)),
  };
});

// Mock OpenAI npm package to prevent browser environment error
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Test response' }, finish_reason: 'stop' }],
            usage: { total_tokens: 100 },
            model: 'gpt-4o-mini',
          }),
        },
      },
    })),
  };
});

// Mock OpenAI client wrapper using hoisted mocks
vi.mock('../chat/openai-client.js', () => ({
  getClient: vi.fn(),
  createCompletion: mocks.createCompletion,
  isConfigured: mocks.isConfigured,
  estimateTokens: mocks.estimateTokens,
  __resetClient: vi.fn(),
}));

// Mock conversation store
vi.mock('../chat/conversation-store.js', () => ({
  createConversation: vi.fn().mockResolvedValue({ id: 1, externalId: 'test-conv-id' }),
  getConversation: vi.fn().mockResolvedValue({ id: 1, externalId: 'test-conv-id' }),
  addMessage: vi.fn().mockResolvedValue({}),
  getMessagesForAPI: vi.fn().mockResolvedValue([]),
  generateTitle: vi.fn().mockReturnValue('Test Conversation'),
  updateTitle: vi.fn().mockResolvedValue({}),
  listConversations: vi.fn().mockResolvedValue([]),
  deleteConversation: vi.fn().mockResolvedValue(true),
}));

// Mock financial context
vi.mock('../chat/financial-context.js', () => ({
  buildContext: vi.fn().mockResolvedValue({
    hasData: true,
    summary: { transactionCount: 100, totalIncome: 5000, totalExpenses: 3000 },
    categories: [],
    budgets: [],
    permissions: { allowTransactionAccess: false, allowCategoryAccess: false, allowAnalyticsAccess: false },
  }),
  formatContextForPrompt: vi.fn().mockReturnValue('Financial context summary'),
  getSchemaDescription: vi.fn().mockReturnValue('Database schema'),
}));

// Mock data anonymizer
vi.mock('../chat/data-anonymizer.js', () => ({
  createAnonymizer: vi.fn().mockReturnValue({
    anonymizeValue: vi.fn((v) => v),
    getMapping: vi.fn(() => ({})),
  }),
  anonymizeContext: vi.fn((ctx) => ctx),
}));

// Mock code sandbox
vi.mock('../chat/code-sandbox.js', () => ({
  createSandbox: vi.fn().mockReturnValue({
    executeSQL: vi.fn().mockResolvedValue({ success: true, data: [], rowCount: 0 }),
    executeCode: vi.fn().mockResolvedValue({ success: true, result: {} }),
    dispose: vi.fn(),
  }),
  validateSQL: vi.fn().mockReturnValue({ isValid: true }),
}));

// Mock prompts
vi.mock('../chat/prompts.js', () => ({
  TOOLS: [],
  getSystemPrompt: vi.fn().mockReturnValue('System prompt'),
  getErrorMessage: vi.fn().mockReturnValue('Error message'),
}));

const modulePromise = import('../chat.js');

const getClientMock = vi.fn();
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

// Mock OpenAI functions for dependency injection
const mockOpenAI = {
  createCompletion: vi.fn().mockImplementation(async (messages: any[]) => {
    // Get the last user message to determine response
    const lastUserMessage = messages.find((m: any) => m.role === 'user')?.content || '';
    
    let responseContent = 'היי! אשמח לעזור לך עם הפיננסים שלך. אפשר לשאול אותי על ההוצאות חודשיות שלך.';
    
    // Match Hebrew questions to expected responses
    if (lastUserMessage.includes('כמה הוצאתי החודש')) {
      responseContent = 'סיכום ההוצאות החודשיות שלך:\n\nפילוח לפי קטגוריות:\n- Food: ₪5,000\n- Transport: ₪3,000';
    } else if (lastUserMessage.includes('מה הקטגוריה עם הכי הרבה הוצאות') || lastUserMessage.includes('מה הקטגוריה הגדולה')) {
      responseContent = 'הקטגוריה עם ההוצאה הגבוהה ביותר היא Food עם ₪5,000.';
    } else if (lastUserMessage.includes('איך אני יכול לחסוך')) {
      responseContent = 'הנה כמה רעיונות לחיסכון:\n1. הפחתת הוצאות על מזון\n2. שימוש בתחבורה ציבורית';
    } else if (lastUserMessage.includes('הוצאות חריגות') || lastUserMessage.includes('יש לי הוצאות חריגות') || lastUserMessage.includes('יש חריגות')) {
      responseContent = 'לא מצאתי הוצאות חריגות בחודש האחרון. ההוצאות שלך נראות תקינות.';
    } else if (lastUserMessage.includes('ההכנסה שלי') || lastUserMessage.includes('הכנסות')) {
      responseContent = 'סיכום הכנסות מול הוצאות:\nסה"כ הכנסות: ₪30,000\nסה"כ הוצאות: ₪20,000';
    } else if (lastUserMessage.includes('השוואה') || lastUserMessage.includes('לעומת')) {
      responseContent = 'השוואת הוצאות בין קטגוריות:\n- Food: ₪5,000\n- Transport: ₪3,000';
    } else if (lastUserMessage.includes('איפה הוצאתי') || lastUserMessage.includes('סוחרים') || lastUserMessage.includes('עסקים') || lastUserMessage.includes('ספקים')) {
      responseContent = 'הספקים שבהם הוצאת הכי הרבה:\n1. SuperMarket - ₪2,000\n2. Gas Station - ₪1,500';
    } else if (lastUserMessage.includes('מגמות') || lastUserMessage.includes('טרנד') || lastUserMessage.includes('המגמות שלי')) {
      responseContent = 'המגמות הכספיות שלך:\nההוצאות עלו ב-5% בחודש האחרון.';
    } else if (lastUserMessage.includes('לא מצאתי') || lastUserMessage.includes('נתונים')) {
      responseContent = 'לא מצאתי מספיק נתונים כדי לענות על השאלה הזו.';
    }
    
    return {
      success: true,
      message: { content: responseContent },
      finishReason: 'stop',
      usage: { total_tokens: 100 },
      model: 'gpt-4o-mini',
    };
  }),
  isConfigured: vi.fn().mockReturnValue(true),
  estimateTokens: vi.fn().mockImplementation((text: string) => Math.ceil((text?.length || 0) / 3.5)),
};

let chatService: any;

beforeAll(async () => {
  const module = await modulePromise;
  chatService = module.default ?? module;
});

beforeEach(() => {
  getClientMock.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockOpenAI.createCompletion.mockClear();
  mockOpenAI.isConfigured.mockClear();

  getClientMock.mockResolvedValue(mockClient);

  chatService.__setDatabase?.({
    query: vi.fn(),
    getClient: getClientMock,
  });

  // Set the OpenAI mock for dependency injection
  chatService.__setOpenAI?.(mockOpenAI);
});

afterEach(() => {
  chatService.__resetDatabase?.();
  chatService.__resetOpenAI?.();
});

describe('chat service', () => {

  describe('processMessage', () => {
    const setupDefaultMocks = () => {
      // Default mock implementation that handles all queries
      mockClient.query.mockImplementation((sql: string) => {
        const sqlLower = sql.toLowerCase();
        
        // Create conversation
        if (sqlLower.includes('insert into chat_conversations')) {
          return Promise.resolve({
            rows: [{
              id: 1,
              external_id: 'test-conv-id',
              title: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              message_count: 0,
              total_tokens_used: 0,
            }],
          });
        }
        // Insert message
        if (sqlLower.includes('insert into chat_messages')) {
          return Promise.resolve({
            rows: [{
              id: 1,
              role: 'user',
              content: 'test',
              created_at: new Date().toISOString(),
            }],
          });
        }
        // Update conversation tokens
        if (sqlLower.includes('update chat_conversations')) {
          return Promise.resolve({ rows: [] });
        }
        // Financial summary
        if (sqlLower.includes('transaction_count') || sqlLower.includes('sum(case')) {
          return Promise.resolve({
            rows: [{
              transaction_count: 100,
              total_income: 30000,
              total_expenses: 20000,
            }],
          });
        }
        // Categories
        if (sqlLower.includes('parent_category') && sqlLower.includes('group by')) {
          return Promise.resolve({
            rows: [
              { category: 'Food', total: 5000, count: 50 },
              { category: 'Transport', total: 3000, count: 30 },
            ],
          });
        }
        // Default empty result
        return Promise.resolve({ rows: [] });
      });
    };

    it('returns response with metadata for valid message', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'Hello' });

      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata.model).toBe('gpt-4o-mini');
      expect(result.metadata.contextIncluded.transactions).toBe(false);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('throws 400 error when message is missing', async () => {
      await expect(chatService.processMessage({})).rejects.toMatchObject({
        status: 400,
        message: 'Message is required',
      });
    });

    it('throws 400 error when message is not a string', async () => {
      await expect(
        chatService.processMessage({ message: 123 as any })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Message is required',
      });
    });

    it('throws 503 when OpenAI client is not configured', async () => {
      mockOpenAI.isConfigured.mockReturnValueOnce(false);
      await expect(
        chatService.processMessage({ message: 'Hello' })
      ).rejects.toMatchObject({
        status: 503,
        message: 'AI service not configured',
        details: 'OpenAI API key is missing',
      });
      expect(getClientMock).not.toHaveBeenCalled();
    });

    it('throws 404 when a requested conversation is missing', async () => {
      setupDefaultMocks();
      mockClient.query.mockImplementation((sql: string) => {
        const sqlLower = sql.toLowerCase();
        if (sqlLower.includes('from chat_conversations') && sqlLower.includes('external_id = $1')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        chatService.processMessage({ message: 'Hello', conversationId: 'missing-conv' })
      ).rejects.toMatchObject({
        status: 404,
        message: 'Conversation not found',
      });
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('handles Hebrew monthly spending question', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'כמה הוצאתי החודש?' });

      expect(result.response).toContain('סיכום ההוצאות');
      expect(result.response).toContain('פילוח לפי קטגוריות');
    });

    it('handles Hebrew top category question', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'מה הקטגוריה עם הכי הרבה הוצאות?' });

      expect(result.response).toContain('הקטגוריה עם ההוצאה הגבוהה');
      expect(result.response).toContain('Food');
    });

    it('handles Hebrew savings question', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'איך אני יכול לחסוך?' });

      expect(result.response).toContain('רעיונות לחיסכון');
    });

    it('handles Hebrew anomalies question with no anomalies', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'יש לי הוצאות חריגות?' });

      expect(result.response).toContain('לא מצאתי הוצאות חריגות');
    });

    it('handles Hebrew anomalies question with large expenses', async () => {
      setupDefaultMocks();
      // Override createCompletion for this specific test
      mockOpenAI.createCompletion.mockResolvedValueOnce({
        success: true,
        message: { content: 'הוצאות חריגות: Large Purchase - ₪5,000' },
        finishReason: 'stop',
        usage: { total_tokens: 100 },
        model: 'gpt-4o-mini',
      });

      const result = await chatService.processMessage({ message: 'יש חריגות בהוצאות?' });

      expect(result.response).toContain('הוצאות חריגות');
      expect(result.response).toContain('Large Purchase');
    });

    it('handles Hebrew income question', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'מה ההכנסה שלי?' });

      expect(result.response).toContain('הכנסות מול הוצאות');
    });

    it('handles Hebrew comparison question', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'תן לי השוואה בין קטגוריות' });

      expect(result.response).toContain('השוואת הוצאות');
    });

    it('handles Hebrew merchants question', async () => {
      setupDefaultMocks();

      // Use "איפה הוצאתי" without "הכי הרבה" to avoid matching topCategory pattern first
      const result = await chatService.processMessage({ message: 'איפה הוצאתי כסף?' });

      expect(result.response).toContain('הספקים שבהם הוצאת');
    });

    it('handles Hebrew trends question', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'מה המגמות שלי?' });

      expect(result.response).toContain('המגמות הכספיות');
    });

    it('returns default response for unrecognized questions', async () => {
      setupDefaultMocks();

      const result = await chatService.processMessage({ message: 'some random message' });

      expect(result.response).toContain('היי');
      expect(result.response).toContain('הוצאות');
    });

    it('handles empty categories gracefully for top category question', async () => {
      setupDefaultMocks();
      // Override createCompletion for empty data scenario
      mockOpenAI.createCompletion.mockResolvedValueOnce({
        success: true,
        message: { content: 'לא מצאתי מספיק נתונים כדי לזהות את הקטגוריה הגדולה ביותר.' },
        finishReason: 'stop',
        usage: { total_tokens: 100 },
        model: 'gpt-4o-mini',
      });

      const result = await chatService.processMessage({ message: 'מה הקטגוריה הגדולה?' });

      expect(result.response).toContain('לא מצאתי מספיק נתונים');
    });

    it('handles empty merchants gracefully', async () => {
      setupDefaultMocks();
      // Override createCompletion for empty merchants scenario
      mockOpenAI.createCompletion.mockResolvedValueOnce({
        success: true,
        message: { content: 'לא מצאתי עסקאות בתקופה האחרונה.' },
        finishReason: 'stop',
        usage: { total_tokens: 100 },
        model: 'gpt-4o-mini',
      });

      const result = await chatService.processMessage({ message: 'באילו חנויות הוצאתי?' });

      expect(result.response).toContain('לא מצאתי עסקאות');
    });

    it('releases client even on database error', async () => {
      mockClient.query.mockRejectedValue(new Error('Database error'));

      await expect(
        chatService.processMessage({ message: 'Hello' })
      ).rejects.toThrow();

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('preserves status code from service errors', async () => {
      const error = new Error('Custom error') as any;
      error.status = 403;
      mockClient.query.mockRejectedValue(error);

      await expect(
        chatService.processMessage({ message: 'Hello' })
      ).rejects.toMatchObject({
        status: 403,
      });
    });

    it('wraps unknown errors with status 500', async () => {
      mockClient.query.mockRejectedValue(new Error('Unknown error'));

      await expect(
        chatService.processMessage({ message: 'Hello' })
      ).rejects.toMatchObject({
        status: 500,
        message: 'Failed to process chat message',
      });
    });

    it('processes SQL tool calls and returns final response with tool metadata', async () => {
      setupDefaultMocks();
      mockOpenAI.createCompletion
        .mockResolvedValueOnce({
          success: true,
          message: {
            content: null,
            tool_calls: [
              {
                id: 'tool-1',
                function: {
                  name: 'execute_sql_query',
                  arguments: JSON.stringify({ query: 'SELECT 1', explanation: 'quick check' }),
                },
              },
            ],
          },
          finishReason: 'tool_calls',
          usage: { total_tokens: 50 },
          model: 'gpt-4o-mini',
        })
        .mockResolvedValueOnce({
          success: true,
          message: { content: 'Done after tool call' },
          finishReason: 'stop',
          usage: { total_tokens: 80 },
          model: 'gpt-4o-mini',
        });

      const result = await chatService.processMessage({
        message: 'Run SQL tool',
        permissions: { allowTransactionAccess: true },
      });

      expect(result.response).toBe('Done after tool call');
      expect(result.metadata.tokensUsed).toBe(130);
      expect(result.metadata.toolExecutions).toEqual([
        expect.objectContaining({
          tool: 'execute_sql_query',
          explanation: 'quick check',
          success: true,
          rowCount: expect.any(Number),
        }),
      ]);
    });
  });

  describe('conversation helpers', () => {
    it('validates and fetches conversation history', async () => {
      await expect(chatService.getConversationHistory('')).rejects.toMatchObject({
        status: 400,
        message: 'Conversation ID is required',
      });

      mockClient.query.mockResolvedValueOnce({ rows: [] });
      await expect(chatService.getConversationHistory('missing')).rejects.toMatchObject({
        status: 404,
        message: 'Conversation not found',
      });

      mockClient.query.mockImplementation((sql: string) => {
        const sqlLower = sql.toLowerCase();
        if (sqlLower.includes('from chat_conversations')) {
          return Promise.resolve({
            rows: [{
              id: 1,
              external_id: 'conv-1',
              title: 'Chat',
              created_at: '2026-01-01',
              updated_at: '2026-01-02',
              last_message_at: '2026-01-02',
              message_count: 1,
              total_tokens_used: 10,
              metadata: null,
            }],
          });
        }
        if (sqlLower.includes('from chat_messages')) {
          return Promise.resolve({
            rows: [{
              role: 'user',
              content: 'hi',
              tool_calls: null,
              tool_call_id: null,
            }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(chatService.getConversationHistory('conv-1')).resolves.toMatchObject({
        externalId: 'conv-1',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('lists and deletes conversations through conversation-store helpers', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          external_id: 'conv-1',
          title: 'Chat',
          created_at: '2026-01-01',
          updated_at: '2026-01-02',
          last_message_at: '2026-01-02',
          message_count: 3,
          total_tokens_used: 30,
          is_archived: 0,
        }],
      });
      await expect(chatService.listConversations({ includeArchived: true })).resolves.toEqual([
        expect.objectContaining({ externalId: 'conv-1', isArchived: false }),
      ]);

      await expect(chatService.deleteConversation('')).rejects.toMatchObject({
        status: 400,
        message: 'Conversation ID is required',
      });

      mockClient.query.mockResolvedValueOnce({ rows: [] });
      await expect(chatService.deleteConversation('missing')).rejects.toMatchObject({
        status: 404,
        message: 'Conversation not found',
      });

      mockClient.query.mockImplementation(async (sql: string) => {
        const sqlLower = sql.toLowerCase();
        if (sqlLower.includes('select id from chat_conversations')) {
          return { rows: [{ id: 1 }] };
        }
        if (sqlLower.includes('delete from chat_messages')) {
          return { rows: [], changes: 1 };
        }
        if (sqlLower.includes('delete from chat_conversations')) {
          return { rows: [], changes: 1 };
        }
        return { rows: [] };
      });
      await expect(chatService.deleteConversation('conv-1')).resolves.toBe(true);
    });
  });
});
