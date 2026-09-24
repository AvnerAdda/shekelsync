// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const questsService = require('../quests.js');

describe('quest acceptance capacity', () => {
  let sqlite;
  let client;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE smart_action_items (
        id INTEGER PRIMARY KEY, action_type TEXT, user_status TEXT,
        quest_duration_days INTEGER DEFAULT 7, points_reward INTEGER DEFAULT 90,
        accepted_at TEXT, deadline TEXT, updated_at TEXT
      );
      CREATE TABLE action_item_history (
        smart_action_item_id INTEGER, action TEXT, previous_status TEXT, new_status TEXT
      );
    `);
    client = {
      query: vi.fn(async (sql, params = []) => ({
        rows: sqlite.prepare(sql).all(Object.fromEntries(
          params.map((value, index) => [String(index + 1), value]),
        )),
      })),
      release: vi.fn(),
    };
    questsService.__setDatabase({ getClient: async () => client });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    questsService.__resetDatabase();
    sqlite.close();
    vi.restoreAllMocks();
  });

  it.each([0, 4])('accepts all remaining proposals with %i accepted quests in a full five-quest pool', async (acceptedCount) => {
    for (let id = 1; id <= 5; id += 1) {
      sqlite.prepare('INSERT INTO smart_action_items (id, action_type, user_status) VALUES (?, ?, ?)')
        .run(id, 'quest_reduce_spending', id <= acceptedCount ? 'accepted' : 'active');
    }
    // Other action types and finished quests must not consume acceptance slots.
    sqlite.exec(`
      INSERT INTO smart_action_items (id, action_type, user_status) VALUES
        (6, 'quest_reduce_spending', 'resolved'),
        (7, 'quest_reduce_spending', 'dismissed'),
        (8, 'budget_warning', 'accepted');
    `);

    const generated = await questsService.generateQuests();
    expect(generated).toMatchObject({ success: true, created: 0, active_count: 5 });

    for (let id = acceptedCount + 1; id <= 5; id += 1) {
      const result = await questsService.acceptQuest(id);
      expect(result).toMatchObject({ success: true, quest_id: id, points_reward: 90 });
      expect(sqlite.prepare('SELECT user_status, accepted_at, deadline FROM smart_action_items WHERE id = ?').get(id))
        .toEqual({ user_status: 'accepted', accepted_at: expect.any(String), deadline: result.deadline });
    }
    expect(await questsService._internal.getActiveQuestCount(client)).toBe(5);
  });

  it('rejects another proposal when five quests are already accepted', async () => {
    for (let id = 1; id <= 6; id += 1) {
      sqlite.prepare('INSERT INTO smart_action_items (id, action_type, user_status) VALUES (?, ?, ?)')
        .run(id, 'quest_reduce_spending', id <= 5 ? 'accepted' : 'active');
    }

    await expect(questsService.acceptQuest(6)).rejects.toThrow('Maximum active quests reached (5)');
    expect(sqlite.prepare('SELECT user_status, accepted_at, deadline FROM smart_action_items WHERE id = 6').get())
      .toEqual({ user_status: 'active', accepted_at: null, deadline: null });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM action_item_history').get().count).toBe(0);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
