import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const releaseMock = vi.fn();

let positionsService: any;

const openPosition = (overrides: Record<string, unknown> = {}) => ({
  id: 15,
  account_id: 1,
  account_name: 'Brokerage',
  position_name: 'Core Position',
  asset_symbol: 'CORE',
  asset_type: 'etf',
  currency: 'ILS',
  units: '10',
  average_cost: '100',
  current_price: '110',
  valuation_date: '2026-03-09',
  original_cost_basis: '1000',
  open_cost_basis: '1000',
  current_value: '1100',
  status: 'open',
  opened_at: '2026-03-01',
  closed_at: null,
  source: 'manual',
  ...overrides,
});

beforeEach(async () => {
  queryMock.mockReset();
  releaseMock.mockReset();

  const module = await import('../positions.js');
  positionsService = module.default ?? module;
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
  it('lists normalized positions for active accounts', async () => {
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes('ORDER BY ip.status ASC')) {
        return Promise.resolve({
          rows: [{
            ...openPosition({ id: 5, account_id: 7 }),
            investment_category: 'liquid',
            institution_id: 77,
            institution_vendor_code: 'broker_demo',
            institution_display_name_en: 'Broker Demo',
            institution_display_name_he: 'ברוקר דמו',
            institution_type: 'investment',
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await positionsService.listPositions({ account_id: 7, status: 'open' });
    const listCall = queryMock.mock.calls.find(([sql]) => String(sql).includes('ORDER BY ip.status ASC'));

    expect(listCall?.[0]).toContain('ia.is_active = true');
    expect(listCall?.[1]).toEqual([7, 'open']);
    expect(result.positions[0]).toMatchObject({
      id: 5,
      symbol: 'CORE',
      units: 10,
      average_cost: 100,
      current_price: 110,
      open_cost_basis: 1000,
      current_value: 1100,
      institution: expect.objectContaining({ vendor_code: 'broker_demo' }),
    });
  });

  it('applies the first buy event exactly once and accumulates units', async () => {
    let updateParams: unknown[] = [];
    let eventParams: unknown[] = [];
    let positionInsertParams: unknown[] = [];

    queryMock.mockImplementation((sql: string, params: unknown[] = []) => {
      const text = String(sql);
      if (text.includes('SELECT id, currency FROM investment_accounts')) {
        return Promise.resolve({ rows: [{ id: 1, currency: 'ILS' }] });
      }
      if (text.includes('INSERT INTO investment_positions')) {
        positionInsertParams = params;
        return Promise.resolve({
          rows: [openPosition({
            id: 11,
            position_name: 'Core Brokerage',
            units: 0,
            average_cost: null,
            original_cost_basis: 0,
            open_cost_basis: 0,
            current_value: null,
            current_price: 120,
            valuation_date: null,
          })],
        });
      }
      if (text.includes('INSERT INTO investment_position_events')) {
        eventParams = params;
        return Promise.resolve({ rows: [{ id: 101, event_type: 'buy', reinvested: 0 }] });
      }
      if (text.includes('UPDATE investment_positions')) {
        updateParams = params;
        return Promise.resolve({
          rows: [openPosition({
            id: 11,
            position_name: 'Core Brokerage',
            units: params[3],
            average_cost: params[4],
            current_price: params[5],
            valuation_date: params[6],
            original_cost_basis: params[0],
            open_cost_basis: params[1],
            current_value: params[2],
            status: params[7],
          })],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await positionsService.createPositionEvent({
      account_id: 1,
      position_name: 'Core Brokerage',
      asset_symbol: 'CORE',
      event_type: 'buy',
      principal_amount: 1000,
      units: 10,
      current_price: 120,
      effective_date: '2026-03-01',
    });

    expect(positionInsertParams.slice(12, 15)).toEqual([0, 0, 0]);
    expect(updateParams.slice(0, 9)).toEqual([
      1000, 1000, 1200, 10, 100, 120, '2026-03-01', 'open', null,
    ]);
    expect(eventParams[4]).toBe(1000);
    expect(eventParams[15]).toBe(120);
    expect(result.position).toMatchObject({
      units: 10,
      original_cost_basis: 1000,
      open_cost_basis: 1000,
      current_value: 1200,
    });
    expect(result.created).toBe(true);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('records explicit sell proceeds, disposed basis, realized gain, and units', async () => {
    let updateParams: unknown[] = [];
    let eventParams: unknown[] = [];
    queryMock.mockImplementation((sql: string, params: unknown[] = []) => {
      const text = String(sql);
      if (text.includes('SELECT ip.*, ia.account_name')) {
        return Promise.resolve({ rows: [openPosition()] });
      }
      if (text.includes('SELECT effective_date')) {
        return Promise.resolve({ rows: [{ effective_date: '2026-03-09' }] });
      }
      if (text.includes('INSERT INTO investment_position_events')) {
        eventParams = params;
        return Promise.resolve({ rows: [{
          id: 301,
          event_type: 'sell',
          proceeds_amount: params[8],
          disposed_cost_basis: params[9],
          realized_gain_loss: params[10],
          reinvested: 0,
          deducted_from_position: 0,
        }] });
      }
      if (text.includes('UPDATE investment_positions')) {
        updateParams = params;
        return Promise.resolve({ rows: [openPosition({
          units: params[3],
          average_cost: params[4],
          original_cost_basis: params[0],
          open_cost_basis: params[1],
          current_value: params[2],
          status: params[7],
        })] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await positionsService.createPositionEvent({
      position_id: 15,
      event_type: 'sell',
      proceeds_amount: 600,
      disposed_cost_basis: 400,
      fee_amount: 10,
      tax_amount: 20,
      units: 4,
      effective_date: '2026-03-10',
    });

    expect(eventParams.slice(7, 14)).toEqual([20, 600, 400, 170, false, false, 4]);
    expect(updateParams.slice(0, 5)).toEqual([1000, 600, 660, 6, 100]);
    expect(result.event).toMatchObject({
      proceeds_amount: 600,
      disposed_cost_basis: 400,
      realized_gain_loss: 170,
    });
  });

  it('requires sell basis instead of treating sale proceeds as basis', async () => {
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes('SELECT ip.*, ia.account_name')) return Promise.resolve({ rows: [openPosition()] });
      if (text.includes('SELECT effective_date')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await expect(positionsService.createPositionEvent({
      position_id: 15,
      event_type: 'sell',
      proceeds_amount: 600,
      effective_date: '2026-03-10',
    })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/disposed_cost_basis/),
    });
  });

  it('keeps income and fees outside market value unless explicitly applied', () => {
    const position = positionsService.__test.normalizePosition(openPosition());

    const income = positionsService.__test.computePositionUpdate(position, {
      event_type: 'dividend',
      income_amount: 80,
      effective_date: '2026-03-10',
    });
    const fee = positionsService.__test.computePositionUpdate(position, {
      event_type: 'fee',
      fee_amount: 25,
      effective_date: '2026-03-10',
    });
    const deductedFee = positionsService.__test.computePositionUpdate(position, {
      event_type: 'fee',
      fee_amount: 25,
      deducted_from_position: true,
      effective_date: '2026-03-10',
    });

    expect(income.currentValue).toBe(1100);
    expect(income.openCostBasis).toBe(1000);
    expect(fee.currentValue).toBe(1100);
    expect(deductedFee.currentValue).toBe(1075);
  });

  it('adds reinvested income to units, basis, and value', () => {
    const position = positionsService.__test.normalizePosition(openPosition());
    const result = positionsService.__test.computePositionUpdate(position, {
      event_type: 'dividend',
      income_amount: 110,
      units: 1,
      reinvested: true,
      effective_date: '2026-03-10',
    });

    expect(result).toMatchObject({
      units: 11,
      originalCostBasis: 1110,
      openCostBasis: 1110,
      currentValue: 1210,
    });
  });

  it('rejects retroactive events before inserting anything', async () => {
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes('SELECT ip.*, ia.account_name')) return Promise.resolve({ rows: [openPosition()] });
      if (text.includes('SELECT effective_date')) {
        return Promise.resolve({ rows: [{ effective_date: '2026-03-12' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await expect(positionsService.createPositionEvent({
      position_id: 15,
      event_type: 'valuation',
      current_value: 1200,
      effective_date: '2026-03-10',
    })).rejects.toMatchObject({ status: 409 });
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO investment_position_events'))).toBe(false);
  });

  it('rejects a transaction key already claimed by another position event', async () => {
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes('WHERE linked_transaction_identifier = $1')) {
        return Promise.resolve({ rows: [{ id: 91 }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await expect(positionsService.createPositionEvent({
      position_id: 15,
      event_type: 'buy',
      principal_amount: 100,
      effective_date: '2026-03-10',
      linked_transaction_identifier: 'bank-tx-7',
      linked_transaction_vendor: 'bank-a',
    })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/already linked/i),
    });

    const precheckCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('WHERE linked_transaction_identifier = $1'));
    expect(precheckCall?.[1]).toEqual(['bank-tx-7', 'bank-a']);
    expect(queryMock.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO investment_position_events'))).toBe(false);
    expect(queryMock.mock.calls.some(([sql]) =>
      String(sql).includes('UPDATE investment_positions'))).toBe(false);
    expect(queryMock.mock.calls.some(([sql]) =>
      String(sql).includes('idx_investment_position_events_linked_transaction_unique'))).toBe(true);
  });

  it.each([
    [
      'unique index',
      Object.assign(new Error(
        'UNIQUE constraint failed: investment_position_events.linked_transaction_identifier, '
        + 'investment_position_events.linked_transaction_vendor',
      ), { code: 'SQLITE_CONSTRAINT_UNIQUE' }),
    ],
    [
      'legacy-preserving trigger',
      Object.assign(new Error('position event transaction link already exists'), {
        code: 'SQLITE_CONSTRAINT_TRIGGER',
      }),
    ],
  ])('maps a racing linked-transaction %s violation to conflict', async (_source, raceError) => {
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes('WHERE linked_transaction_identifier = $1')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('SELECT ip.*, ia.account_name')) {
        return Promise.resolve({ rows: [openPosition()] });
      }
      if (text.includes('SELECT effective_date')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('INSERT INTO investment_position_events')) {
        return Promise.reject(raceError);
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await expect(positionsService.createPositionEvent({
      position_id: 15,
      event_type: 'buy',
      principal_amount: 100,
      effective_date: '2026-03-10',
      linked_transaction_identifier: 'bank-tx-race',
      linked_transaction_vendor: 'bank-a',
    })).rejects.toMatchObject({ status: 409 });
    expect(queryMock.mock.calls.some(([sql]) =>
      String(sql).includes('UPDATE investment_positions'))).toBe(false);
    expect(queryMock.mock.calls.filter(([sql]) => String(sql) === 'ROLLBACK')).toHaveLength(1);
  });

  it('lists normalized event history with optional filters', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).includes('ORDER BY ipe.effective_date')) {
        return Promise.resolve({
          rows: [{
            id: 8,
            position_id: 15,
            event_type: 'sell',
            effective_date: '2026-03-10',
            proceeds_amount: '600',
            disposed_cost_basis: '400',
            realized_gain_loss: '200',
            current_price: '123.45',
            reinvested: 0,
            deducted_from_position: 0,
            metadata: '{"source":"manual"}',
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await positionsService.listPositionEvents({ position_id: 15, event_type: 'sell' });
    const listCall = queryMock.mock.calls.find(([sql]) => String(sql).includes('ORDER BY ipe.effective_date'));

    expect(listCall?.[1]).toEqual([15, 'sell']);
    expect(result.events[0]).toMatchObject({
      proceeds_amount: 600,
      disposed_cost_basis: 400,
      realized_gain_loss: 200,
      current_price: 123.45,
      reinvested: false,
      metadata: { source: 'manual' },
    });
  });

  it('creates, updates, and deactivates a canonical position', async () => {
    queryMock.mockImplementation((sql: string, params: unknown[] = []) => {
      const text = String(sql);
      if (text.includes('SELECT id, currency FROM investment_accounts')) {
        return Promise.resolve({ rows: [{ id: 1, currency: 'ILS' }] });
      }
      if (text.includes('INSERT INTO investment_positions')) {
        return Promise.resolve({ rows: [openPosition({
          id: 21,
          position_name: params[1],
          asset_symbol: params[2],
          units: params[6],
          average_cost: params[7],
          current_price: params[8],
          valuation_date: params[9],
          original_cost_basis: params[12],
          open_cost_basis: params[13],
          current_value: params[14],
        })] });
      }
      if (text.includes('SELECT ip.*, ia.account_name')) {
        return Promise.resolve({ rows: [openPosition({ id: 21 })] });
      }
      if (text.includes('SET position_name = $1')) {
        return Promise.resolve({ rows: [openPosition({
          id: 21,
          units: params[4],
          average_cost: params[5],
          current_price: params[6],
          valuation_date: params[7],
          original_cost_basis: params[10],
          open_cost_basis: params[11],
          current_value: params[12],
        })] });
      }
      if (text.includes("SET status = 'closed'")) {
        return Promise.resolve({ rows: [openPosition({ id: 21, status: 'closed', closed_at: params[0] })] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const created = await positionsService.createPosition({
      account_id: 1,
      position_name: 'Core Position',
      asset_symbol: 'CORE',
      units: 10,
      average_cost: 100,
      current_price: 110,
      valuation_date: '2026-03-09',
    });
    expect(created.position).toMatchObject({ units: 10, cost_basis: 1000, current_value: 1100 });

    const updated = await positionsService.updatePosition({
      id: 21,
      quantity: 12,
      avg_price: 105,
      price: 115,
      as_of_date: '2026-03-10',
    });
    expect(updated.position).toMatchObject({ units: 12, cost_basis: 1260, current_value: 1380 });

    const deactivated = await positionsService.deactivatePosition({ id: 21, closed_at: '2026-03-11' });
    expect(deactivated.position).toMatchObject({ status: 'closed', closed_at: '2026-03-11' });
  });

  it('rejects invalid close actions and invalid status filters', async () => {
    await expect(positionsService.createPositionEvent({
      account_id: 1,
      position_name: 'Core Brokerage',
      event_type: 'capital_return',
      amount: 100,
      close_action: 'bad-action',
    })).rejects.toMatchObject({ status: 400 });

    await expect(positionsService.listPositions({ status: 'archived' }))
      .rejects.toMatchObject({ status: 400 });
  });
});
