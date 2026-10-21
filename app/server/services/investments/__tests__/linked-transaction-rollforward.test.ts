import { describe, expect, it } from 'vitest';

const { applyContributionRollforward, appendContributionHistory } = require('../linked-transaction-rollforward.js');

describe('linked investment contribution rollforward', () => {
  it('includes every contribution after the snapshot, including several on the same day', () => {
    const account = { id: 1, as_of_date: '2026-10-01', current_value: 10000, cost_basis: 9000 };
    const transactions = [
      { account_id: 1, identifier: 'b', date: '2026-10-02', price: -300 },
      { account_id: 1, identifier: 'old', date: '2026-10-01', price: -9999 },
      { account_id: 1, identifier: 'a', date: '2026-10-02', price: -500 },
    ];

    applyContributionRollforward([account], transactions);
    expect(account).toMatchObject({
      as_of_date: '2026-10-02', current_value: 10800, cost_basis: 9800,
      linked_contribution_adjustment: 800, linked_contribution_count: 2,
    });
    const history = appendContributionHistory([
      { date: '2026-10-01', currentValue: 10000, costBasis: 9000 },
    ], transactions);
    expect(history.at(-1)).toMatchObject({ currentValue: account.current_value, costBasis: account.cost_basis });

    // Applying the same transactions to the resulting snapshot remains safe.
    applyContributionRollforward([account], transactions);
    expect(account.current_value).toBe(10800);
  });

  it('includes same-day contributions with no initial snapshot and preserves account boundaries', () => {
    const accounts = [
      { id: 1, as_of_date: null, current_value: null, cost_basis: null },
      { id: 2, as_of_date: '2026-10-01', current_value: 2000, cost_basis: 1500 },
    ];
    applyContributionRollforward(accounts, [
      { account_id: 1, identifier: 'a', date: '2026-10-02', price: -500 },
      { account_id: 1, identifier: 'b', date: '2026-10-02', price: -300 },
      { account_id: 2, identifier: 'a', date: '2026-10-02', price: -200 },
      { account_id: 2, identifier: 'fee', date: '2026-10-02', price: -100, name: 'Commission' },
    ]);
    expect(accounts[0]).toMatchObject({ current_value: 800, cost_basis: 800, linked_contribution_count: 2 });
    expect(accounts[1]).toMatchObject({ current_value: 2200, cost_basis: 1700, linked_contribution_count: 1 });
  });
});
