import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const releaseMock = vi.fn();

let positionsService: any;
let listPositions: (params?: Record<string, unknown>) => Promise<any>;
let createPositionEvent: (payload?: Record<string, unknown>) => Promise<any>;

beforeEach(async () => {
  queryMock.mockReset();
  releaseMock.mockReset();

  const module = await import('../positions.js');
  positionsService = module.default ?? module;
  listPositions = module.listPositions;
  createPositionEvent = module.createPositionEvent;

  positionsService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
    getClient: async () => ({
      query: (...args: any[]) => queryMock(...args),
      release: (...args: any[]) => releaseMock(...args),
    }),
  });
});

afterEach(() => {
  positionsService.__resetDatabase();
});

describe('investment positions service', () => {
  it('lists positions after ensuring schema', async () => {
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes('SELECT ip.*, ia.account_name') && text.includes('ORDER BY ip.status')) {
        return Promise.resolve({
          rows: [
            {
              id: 5,
              account_id: 7,
              account_name: 'Brokerage',
              position_name: 'Main Position',
              open_cost_basis: '900',
              original_cost_basis: '1000',
              current_value: '950',
              status: 'open',
            },
          ],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await listPositions({ account_id: 7 });

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]).toMatchObject({
      id: 5,
      open_cost_basis: 900,
      current_value: 950,
    });
  });

  it('creates a deposit event and opens a new position', async () => {
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);

      if (text.includes('SELECT id FROM investment_accounts')) {
        return Promise.resolve({ rows: [{ id: 1 }] });
      }

      if (text.includes('INSERT INTO investment_positions')) {
        return Promise.resolve({
          rows: [
            {
              id: 11,
              account_id: 1,
              position_name: 'Core Brokerage',
              original_cost_basis: '1000',
              open_cost_basis: '1000',
              current_value: '1000',
              status: 'open',
            },
          ],
        });
      }

      if (text.includes('INSERT INTO investment_position_events')) {
        return Promise.resolve({ rows: [{ id: 101, event_type: 'deposit' }] });
      }

      if (text.includes('UPDATE investment_positions')) {
        return Promise.resolve({
          rows: [
            {
              id: 11,
              account_id: 1,
              position_name: 'Core Brokerage',
              original_cost_basis: '1000',
              open_cost_basis: '1000',
              current_value: '1000',
              status: 'open',
            },
          ],
        });
      }

      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await createPositionEvent({
      account_id: 1,
      position_name: 'Core Brokerage',
      event_type: 'deposit',
      amount: 1000,
      effective_date: '2026-03-01',
      current_value: 1000,
    });

    expect(result.position).toMatchObject({
      id: 11,
      open_cost_basis: 1000,
      status: 'open',
    });
    expect(result.event).toMatchObject({ id: 101, event_type: 'deposit' });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('records a capital return event and reduces open cost basis', async () => {
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);

      if (text.includes('SELECT ip.*, ia.account_name')) {
        return Promise.resolve({
          rows: [
            {
              id: 15,
              account_id: 1,
              account_name: 'Brokerage',
              position_name: 'Core Position',
              open_cost_basis: '1000',
              original_cost_basis: '1200',
              current_value: '1080',
              status: 'open',
              closed_at: null,
            },
          ],
        });
      }

      if (text.includes('INSERT INTO investment_position_events')) {
        return Promise.resolve({ rows: [{ id: 301, event_type: 'capital_return' }] });
      }

      if (text.includes('UPDATE investment_positions')) {
        return Promise.resolve({
          rows: [
            {
              id: 15,
              account_id: 1,
              position_name: 'Core Position',
              open_cost_basis: '700',
              original_cost_basis: '1200',
              current_value: '780',
              status: 'open',
              closed_at: null,
            },
          ],
        });
      }

      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await createPositionEvent({
      position_id: 15,
      event_type: 'capital_return',
      amount: 380,
      principal_amount: 300,
      income_amount: 80,
      close_action: 'partial_close',
      effective_date: '2026-03-10',
      current_value: 780,
    });

    expect(result.position).toMatchObject({
      id: 15,
      open_cost_basis: 700,
      status: 'open',
    });
    expect(result.event).toMatchObject({ id: 301 });
  });

  it('applies interest income to the current value without closing the position', async () => {
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);

      if (text.includes('SELECT ip.*, ia.account_name')) {
        return Promise.resolve({
          rows: [
            {
              id: 19,
              account_id: 1,
              account_name: 'Savings',
              position_name: 'Weekly Pikadon',
              open_cost_basis: '1000',
              original_cost_basis: '1000',
              current_value: '1000',
              status: 'open',
              closed_at: null,
            },
          ],
        });
      }

      if (text.includes('INSERT INTO investment_position_events')) {
        return Promise.resolve({ rows: [{ id: 401, event_type: 'interest' }] });
      }

      if (text.includes('UPDATE investment_positions')) {
        return Promise.resolve({
          rows: [
            {
              id: 19,
              account_id: 1,
              position_name: 'Weekly Pikadon',
              open_cost_basis: '1000',
              original_cost_basis: '1000',
              current_value: '1080',
              status: 'open',
              closed_at: null,
            },
          ],
        });
      }

      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await createPositionEvent({
      position_id: 19,
      event_type: 'interest',
      amount: 80,
      effective_date: '2026-03-10',
    });

    expect(result.position).toMatchObject({
      id: 19,
      current_value: 1080,
      open_cost_basis: 1000,
      status: 'open',
    });
    expect(result.event).toMatchObject({ id: 401, event_type: 'interest' });
  });

  it('rejects invalid close actions', async () => {
    await expect(
      createPositionEvent({
        account_id: 1,
        position_name: 'Core Brokerage',
        event_type: 'capital_return',
        amount: 100,
        close_action: 'bad-action',
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/invalid close_action/i),
    });
  });
});
