import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let pairingsService;

beforeAll(async () => {
  const module = await import('../pairings.js');
  pairingsService = module.default ?? module;
});

function createMockClient(queryImpl = async () => ({ rows: [], rowCount: 0 })) {
  return {
    query: vi.fn(queryImpl),
    release: vi.fn(),
  };
}

describe('account pairings service', () => {
  const queryMock = vi.fn();
  const getClientMock = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    queryMock.mockReset();
    getClientMock.mockReset();

    pairingsService.__setDatabase({
      query: queryMock,
      getClient: getClientMock,
    });
  });

  afterEach(() => {
    pairingsService.__resetDatabase();
  });

  it('lists only active pairings by default and normalizes rows', async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: 1,
          credit_card_vendor: 'visa',
          credit_card_account_number: '1111',
          bank_vendor: 'bank',
          bank_account_number: '2222',
          match_patterns: '["cc","repayment"]',
          is_active: 1,
          discrepancy_acknowledged: 0,
          created_at: '2026-01-01',
          updated_at: '2026-01-02',
        },
      ],
    });

    const result = await pairingsService.listPairings();

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toContain('WHERE is_active = 1');
    expect(result).toEqual([
      {
        id: 1,
        creditCardVendor: 'visa',
        creditCardAccountNumber: '1111',
        bankVendor: 'bank',
        bankAccountNumber: '2222',
        matchPatterns: ['cc', 'repayment'],
        isActive: true,
        discrepancyAcknowledged: false,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
      },
    ]);
  });

  it('lists inactive pairings when include_inactive=true', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await pairingsService.listPairings({ include_inactive: 'true' });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).not.toContain('WHERE is_active = 1');
  });

  it('rejects pairing creation without required vendors', async () => {
    await expect(pairingsService.createPairing({})).rejects.toMatchObject({
      status: 400,
      message: 'creditCardVendor and bankVendor are required',
    });
  });

  it('rejects pairing creation with empty match patterns', async () => {
    await expect(
      pairingsService.createPairing({ creditCardVendor: 'visa', bankVendor: 'bank', matchPatterns: [] }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'At least one match pattern is required',
    });
  });

  it('rejects duplicate pairing creation with 409 and existingId', async () => {
    const client = createMockClient(async (sql) => {
      if (String(sql).includes('FROM account_pairings')) {
        return { rows: [{ id: 42 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    getClientMock.mockResolvedValue(client);

    await expect(
      pairingsService.createPairing({
        creditCardVendor: 'visa',
        creditCardAccountNumber: null,
        bankVendor: 'bank',
        bankAccountNumber: null,
        matchPatterns: ['repayment'],
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Pairing already exists',
      existingId: 42,
    });

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('creates pairing and writes audit log', async () => {
    const client = createMockClient(async (sql) => {
      if (String(sql).includes('FROM account_pairings')) {
        return { rows: [], rowCount: 0 };
      }
      if (String(sql).includes('INSERT INTO account_pairings')) {
        return { rows: [{ id: 55 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    getClientMock.mockResolvedValue(client);

    const result = await pairingsService.createPairing({
      creditCardVendor: 'visa',
      creditCardAccountNumber: '1234',
      bankVendor: 'bank',
      bankAccountNumber: '9876',
      matchPatterns: ['repayment', 'monthly'],
    });

    expect(result).toEqual({ pairingId: 55 });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO account_pairing_log'),
      [55, JSON.stringify({ matchPatterns: ['repayment', 'monthly'], patternCount: 2 })],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rejects pairing update without id', async () => {
    await expect(pairingsService.updatePairing({ matchPatterns: ['x'] })).rejects.toMatchObject({
      status: 400,
      message: 'Pairing ID is required',
    });
  });

  it('rejects pairing update with no update fields', async () => {
    await expect(pairingsService.updatePairing({ id: 10 })).rejects.toMatchObject({
      status: 400,
      message: 'No fields to update',
    });
  });

  it('returns 404 when updating missing pairing', async () => {
    const client = createMockClient(async (sql) => {
      if (String(sql).includes('UPDATE account_pairings')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    getClientMock.mockResolvedValue(client);

    await expect(
      pairingsService.updatePairing({ id: 77, isActive: true }),
    ).rejects.toMatchObject({ status: 404, message: 'Pairing not found' });

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('updates pairing fields and writes update audit log', async () => {
    const client = createMockClient(async (sql) => {
      if (String(sql).includes('UPDATE account_pairings')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    getClientMock.mockResolvedValue(client);

    const result = await pairingsService.updatePairing({
      id: 10,
      matchPatterns: ['new-pattern'],
      isActive: false,
    });

    expect(result).toEqual({ updated: true });

    const updateCall = client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE account_pairings'));
    expect(updateCall?.[1]).toEqual([10, JSON.stringify(['new-pattern']), 0]);

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO account_pairing_log'),
      [10, JSON.stringify({ matchPatterns: ['new-pattern'], isActive: false })],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rejects pairing deletion without id', async () => {
    await expect(pairingsService.deletePairing({})).rejects.toMatchObject({
      status: 400,
      message: 'Pairing ID is required',
    });
  });

  it('returns 404 when deleting a missing pairing', async () => {
    const client = createMockClient(async (sql) => {
      if (String(sql).includes('SELECT id FROM account_pairings')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    getClientMock.mockResolvedValue(client);

    await expect(pairingsService.deletePairing({ id: 999 })).rejects.toMatchObject({
      status: 404,
      message: 'Pairing not found',
    });

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('deletes pairing after logging deletion entry', async () => {
    const client = createMockClient(async (sql) => {
      if (String(sql).includes('SELECT id FROM account_pairings')) {
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    getClientMock.mockResolvedValue(client);

    const result = await pairingsService.deletePairing({ id: 1 });

    expect(result).toEqual({ deleted: true });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO account_pairing_log'),
      [1],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM account_pairings'),
      [1],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('returns active pairings without releasing when client is injected', async () => {
    const client = createMockClient(async () => ({
      rows: [
        {
          id: 11,
          credit_card_vendor: 'visa',
          credit_card_account_number: null,
          bank_vendor: 'hapoalim',
          bank_account_number: '123',
          match_patterns: '["monthly"]',
        },
      ],
      rowCount: 1,
    }));

    const result = await pairingsService.getActivePairings(client);

    expect(result).toEqual([
      {
        id: 11,
        creditCardVendor: 'visa',
        creditCardAccountNumber: null,
        bankVendor: 'hapoalim',
        bankAccountNumber: '123',
        matchPatterns: ['monthly'],
      },
    ]);
    expect(client.release).not.toHaveBeenCalled();
  });

  it('acquires and releases client when listing active pairings without injected client', async () => {
    const client = createMockClient(async () => ({ rows: [], rowCount: 0 }));
    getClientMock.mockResolvedValue(client);

    const result = await pairingsService.getActivePairings();

    expect(result).toEqual([]);
    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
