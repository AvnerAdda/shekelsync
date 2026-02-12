import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

const {
  createConversation,
  getConversation,
  addMessage,
  listConversations,
  updateTitle,
  archiveConversation,
  deleteConversation,
  getMessagesForAPI,
  generateTitle,
} = require('../conversation-store.js');

function createMockDb(queryImpl) {
  return { query: vi.fn(queryImpl) };
}

describe('conversation-store', () => {
  describe('generateTitle', () => {
    it('returns default for null/empty input', () => {
      expect(generateTitle(null)).toBe('New Conversation');
      expect(generateTitle('')).toBe('New Conversation');
    });

    it('returns short messages as-is', () => {
      expect(generateTitle('Hello world')).toBe('Hello world');
    });

    it('cleans whitespace', () => {
      expect(generateTitle('  hello\n  world  ')).toBe('hello world');
    });

    it('truncates long messages at word boundary', () => {
      const long = 'This is a really long message that should be truncated at a sensible word boundary somewhere around here';
      const title = generateTitle(long);
      expect(title.length).toBeLessThanOrEqual(54); // 50 + '...'
      expect(title.endsWith('...')).toBe(true);
    });

    it('truncates at 50 chars when no good word boundary', () => {
      const long = 'abcdefghijklmnopqrstuvwxyz_abcdefghijklmnopqrstuvwxyz_end';
      const title = generateTitle(long);
      expect(title.endsWith('...')).toBe(true);
    });
  });

  describe('createConversation', () => {
    it('creates a conversation and returns mapped fields', async () => {
      const db = createMockDb(async () => ({
        rows: [{
          id: 1,
          external_id: 'test-uuid-1234',
          title: 'Test Chat',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
          message_count: 0,
          total_tokens_used: 0,
        }],
      }));

      const result = await createConversation(db, { title: 'Test Chat' });

      expect(result.externalId).toBe('test-uuid-1234');
      expect(result.title).toBe('Test Chat');
      expect(result.messageCount).toBe(0);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('serializes metadata to JSON', async () => {
      const db = createMockDb(async () => ({
        rows: [{ id: 1, external_id: 'test-uuid-1234', title: null, created_at: '', updated_at: '', message_count: 0, total_tokens_used: 0 }],
      }));

      await createConversation(db, { metadata: { key: 'val' } });
      expect(db.query.mock.calls[0][1][2]).toBe('{"key":"val"}');
    });
  });

  describe('getConversation', () => {
    it('returns null when conversation not found', async () => {
      const db = createMockDb(async () => ({ rows: [] }));
      const result = await getConversation(db, 'missing-id');
      expect(result).toBeNull();
    });

    it('returns conversation with messages', async () => {
      const db = createMockDb(async (query) => {
        if (query.includes('chat_conversations')) {
          return {
            rows: [{
              id: 1, external_id: 'ext-1', title: 'Chat',
              created_at: '2026-01-01', updated_at: '2026-01-02',
              last_message_at: '2026-01-02', message_count: 1,
              total_tokens_used: 50, metadata: '{"key":"val"}',
            }],
          };
        }
        return {
          rows: [{
            id: 10, role: 'user', content: 'Hello',
            tool_calls: null, tool_call_id: null,
            tokens_used: 50, created_at: '2026-01-01',
            metadata: null,
          }],
        };
      });

      const result = await getConversation(db, 'ext-1');
      expect(result.externalId).toBe('ext-1');
      expect(result.metadata).toEqual({ key: 'val' });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
    });

    it('skips messages when includeMessages is false', async () => {
      const db = createMockDb(async () => ({
        rows: [{
          id: 1, external_id: 'ext-1', title: 'Chat',
          created_at: '2026-01-01', updated_at: '2026-01-02',
          last_message_at: '2026-01-02', message_count: 0,
          total_tokens_used: 0, metadata: null,
        }],
      }));

      const result = await getConversation(db, 'ext-1', false);
      expect(result.messages).toEqual([]);
      expect(db.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('addMessage', () => {
    it('inserts message and updates conversation stats', async () => {
      const db = createMockDb(async () => ({
        rows: [{ id: 100, role: 'user', content: 'Hi', created_at: '2026-01-01' }],
      }));

      const result = await addMessage(db, 1, {
        role: 'user',
        content: 'Hi',
        tokensUsed: 10,
      });

      expect(result.role).toBe('user');
      expect(result.content).toBe('Hi');
      expect(db.query).toHaveBeenCalledTimes(2); // INSERT + UPDATE
    });

    it('serializes toolCalls and metadata to JSON', async () => {
      const db = createMockDb(async () => ({
        rows: [{ id: 101, role: 'assistant', content: 'result', created_at: '2026-01-01' }],
      }));

      await addMessage(db, 1, {
        role: 'assistant',
        content: 'result',
        toolCalls: [{ id: 'tc1', type: 'function' }],
        metadata: { model: 'gpt-4' },
      });

      const insertCall = db.query.mock.calls[0][1];
      expect(insertCall[3]).toBe('[{"id":"tc1","type":"function"}]');
      expect(insertCall[6]).toBe('{"model":"gpt-4"}');
    });
  });

  describe('listConversations', () => {
    it('lists conversations with defaults', async () => {
      const db = createMockDb(async () => ({
        rows: [{
          id: 1, external_id: 'ext-1', title: 'Chat 1',
          created_at: '2026-01-01', updated_at: '2026-01-02',
          last_message_at: '2026-01-02', message_count: 3,
          total_tokens_used: 100, is_archived: 0,
        }],
      }));

      const result = await listConversations(db);
      expect(result).toHaveLength(1);
      expect(result[0].isArchived).toBe(false);
      // Defaults: limit 20, offset 0
      expect(db.query.mock.calls[0][1]).toEqual([20, 0]);
    });

    it('excludes archived by default', async () => {
      const db = createMockDb(async () => ({ rows: [] }));
      await listConversations(db);
      expect(db.query.mock.calls[0][0]).toContain('is_archived = 0');
    });

    it('includes archived when requested', async () => {
      const db = createMockDb(async () => ({ rows: [] }));
      await listConversations(db, { includeArchived: true });
      expect(db.query.mock.calls[0][0]).not.toContain('is_archived = 0');
    });
  });

  describe('updateTitle', () => {
    it('returns true when update succeeds', async () => {
      const db = createMockDb(async () => ({ changes: 1 }));
      expect(await updateTitle(db, 'ext-1', 'New Title')).toBe(true);
    });

    it('returns false when no matching conversation', async () => {
      const db = createMockDb(async () => ({ changes: 0 }));
      expect(await updateTitle(db, 'missing', 'New Title')).toBe(false);
    });
  });

  describe('archiveConversation', () => {
    it('returns true on success', async () => {
      const db = createMockDb(async () => ({ changes: 1 }));
      expect(await archiveConversation(db, 'ext-1')).toBe(true);
    });

    it('returns false when not found', async () => {
      const db = createMockDb(async () => ({ changes: 0 }));
      expect(await archiveConversation(db, 'missing')).toBe(false);
    });
  });

  describe('deleteConversation', () => {
    it('deletes messages and conversation', async () => {
      let callCount = 0;
      const db = createMockDb(async () => {
        callCount++;
        if (callCount === 1) return { rows: [{ id: 42 }] }; // SELECT
        if (callCount === 2) return {}; // DELETE messages
        return { changes: 1 }; // DELETE conversation
      });

      expect(await deleteConversation(db, 'ext-1')).toBe(true);
      expect(db.query).toHaveBeenCalledTimes(3);
    });

    it('returns false when conversation not found', async () => {
      const db = createMockDb(async () => ({ rows: [] }));
      expect(await deleteConversation(db, 'missing')).toBe(false);
    });
  });

  describe('getMessagesForAPI', () => {
    it('returns empty array when conversation not found', async () => {
      const db = createMockDb(async () => ({ rows: [] }));
      expect(await getMessagesForAPI(db, 'missing')).toEqual([]);
    });

    it('returns messages in OpenAI format', async () => {
      let callCount = 0;
      const db = createMockDb(async () => {
        callCount++;
        if (callCount === 1) return { rows: [{ id: 1 }] };
        return {
          rows: [
            { role: 'assistant', content: 'Hello!', tool_calls: null, tool_call_id: null },
            { role: 'user', content: 'Hi', tool_calls: null, tool_call_id: null },
          ],
        };
      });

      const messages = await getMessagesForAPI(db, 'ext-1');
      // Reversed to chronological order
      expect(messages[0]).toEqual({ role: 'user', content: 'Hi' });
      expect(messages[1]).toEqual({ role: 'assistant', content: 'Hello!' });
    });

    it('includes tool_calls and tool_call_id when present', async () => {
      let callCount = 0;
      const db = createMockDb(async () => {
        callCount++;
        if (callCount === 1) return { rows: [{ id: 1 }] };
        return {
          rows: [{
            role: 'assistant',
            content: 'result',
            tool_calls: '[{"id":"tc1"}]',
            tool_call_id: 'tc1',
          }],
        };
      });

      const messages = await getMessagesForAPI(db, 'ext-1');
      expect(messages[0].tool_calls).toEqual([{ id: 'tc1' }]);
      expect(messages[0].tool_call_id).toBe('tc1');
    });
  });
});
