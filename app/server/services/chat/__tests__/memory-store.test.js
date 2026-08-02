import { describe, expect, it, vi } from 'vitest';
import {
  deleteMemory,
  ensureMemoryTable,
  formatMemoriesForPrompt,
  getAllMemories,
  recallMemory,
  saveMemory,
} from '../memory-store.js';

describe('chat memory store', () => {
  it('creates the backing table', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await ensureMemoryTable(db);

    expect(db.query).toHaveBeenCalledOnce();
    expect(db.query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS chat_memory');
  });

  it('validates and saves trimmed memory values', async () => {
    const saved = {
      id: 1,
      key: 'monthly target',
      value: 'Save 20%',
      category: 'goal',
    };
    const db = { query: vi.fn().mockResolvedValue({ rows: [saved] }) };

    await expect(saveMemory(db, {})).rejects.toThrow('key, value, and category are required');
    await expect(
      saveMemory(db, { key: 'test', value: 'value', category: 'unknown' }),
    ).rejects.toThrow('Invalid category: unknown');
    await expect(
      saveMemory(db, {
        key: '  monthly target  ',
        value: '  Save 20%  ',
        category: 'goal',
      }),
    ).resolves.toEqual(saved);

    expect(db.query).toHaveBeenCalledOnce();
    expect(db.query.mock.calls[0][0]).toContain('ON CONFLICT(key) DO UPDATE');
    expect(db.query.mock.calls[0][1]).toEqual(['monthly target', 'Save 20%', 'goal']);
  });

  it('recalls matching memories and skips empty searches', async () => {
    const rows = [{ key: 'currency', value: 'ILS', category: 'preference' }];
    const db = { query: vi.fn().mockResolvedValue({ rows }) };

    await expect(recallMemory(db, '')).resolves.toEqual([]);
    expect(db.query).not.toHaveBeenCalled();

    await expect(recallMemory(db, '  currency  ')).resolves.toEqual(rows);
    expect(db.query.mock.calls[0][0]).toContain('WHERE key LIKE $1 OR value LIKE $1');
    expect(db.query.mock.calls[0][1]).toEqual(['%currency%']);
  });

  it('lists and deletes memories', async () => {
    const rows = [{ key: 'risk', value: 'low', category: 'preference' }];
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows })
        .mockResolvedValueOnce({ changes: 1 })
        .mockResolvedValueOnce({ changes: 0 }),
    };

    await expect(getAllMemories(db)).resolves.toEqual(rows);
    await expect(deleteMemory(db, 'risk')).resolves.toBe(true);
    await expect(deleteMemory(db, 'missing')).resolves.toBe(false);

    expect(db.query.mock.calls[0][0]).toContain('ORDER BY category, updated_at DESC');
    expect(db.query.mock.calls[1]).toEqual([
      'DELETE FROM chat_memory WHERE key = $1',
      ['risk'],
    ]);
  });

  it('formats supported memory categories for the system prompt', () => {
    expect(formatMemoriesForPrompt()).toBe('');
    expect(formatMemoriesForPrompt([])).toBe('');

    const prompt = formatMemoriesForPrompt([
      { category: 'goal', key: 'emergency fund', value: '6 months' },
      { category: 'preference', key: 'currency', value: 'ILS' },
      { category: 'insight', key: 'spending', value: 'weekends are higher' },
      { category: 'unsupported', key: 'ignored', value: 'value' },
    ]);

    expect(prompt).toContain('USER MEMORY (from previous conversations):');
    expect(prompt).toContain('[Goals]\n- emergency fund: 6 months');
    expect(prompt).toContain('[Preferences]\n- currency: ILS');
    expect(prompt).toContain('[Insights]\n- spending: weekends are higher');
    expect(prompt).not.toContain('ignored');
  });
});
