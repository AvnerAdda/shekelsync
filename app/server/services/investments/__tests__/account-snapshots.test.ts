import { describe, expect, it, vi } from 'vitest';
import { fetchAccountHoldingSnapshots } from '../account-snapshots.js';

describe('fetchAccountHoldingSnapshots', () => {
  it('pikadon holdings replace (not add to) standard holdings for the same account', async () => {
    const query = vi.fn(async (sql: string) => {
      const text = String(sql);

      if (text.includes('WITH ranked_standard AS')) {
        return {
          rows: [
            {
              account_id: 7,
              current_value: '500',
              cost_basis: '450',
              as_of_date: '2026-03-01',
            },
          ],
        };
      }

      if (text.includes("ih.holding_type = 'pikadon'")) {
        return {
          rows: [
            {
              account_id: 7,
              current_value: '1000',
              cost_basis: '1000',
              as_of_date: '2026-03-10',
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const snapshots = await fetchAccountHoldingSnapshots({ query } as any, [7]);

    // Pikadon values replace the standard holding — the standard holding is a
    // summary-level placeholder superseded by granular pikadon holdings.
    expect(snapshots.get(7)).toEqual({
      current_value: 1000,
      cost_basis: 1000,
      as_of_date: '2026-03-10',
      uses_pikadon_rollup: true,
    });
  });
});
