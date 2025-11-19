import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const getClientMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();

let pairings: any;

beforeEach(async () => {
  vi.resetModules();

  queryMock.mockReset();
  getClientMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();

  pairings = (await import('../accounts/pairings.js')).default;
  pairings.__setDatabase({
    query: queryMock,
    getClient: getClientMock,
  });
});

afterEach(() => {
  pairings.__resetDatabase?.();
});

afterEach(() => {
  vi.clearAllTimers();
});

describe('accounts pairings service', () => {
  it('listPairings returns only active pairings by default', async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: 1,
          credit_card_vendor: 'isracard',
          credit_card_account_number: '1234',
          bank_vendor: 'hapoalim',
          bank_account_number: '5678',
          match_patterns: JSON.stringify(['CARD123', 'CARD456']),
          is_active: 1,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ],
    });

    const result = await pairings.listPairings();

    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain('WHERE ap.is_active = 1');
    expect(result).toEqual([
      {
        id: 1,
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '1234',
        bankVendor: 'hapoalim',
        bankAccountNumber: '5678',
        matchPatterns: ['CARD123', 'CARD456'],
        isActive: true,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
      },
    ]);
  });

  it('createPairing inserts new record and writes audit log', async () => {
  getClientMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });

  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/SELECT\s+id\s+FROM\s+account_pairings/.test(sql)) {
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO account_pairings')) {
      return { rows: [{ id: 42 }] };
    }
    if (sql.includes('INSERT INTO account_pairing_log')) {
      return { rows: [] };
    }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });

    const payload = {
      creditCardVendor: 'isracard',
      bankVendor: 'discount',
      matchPatterns: ['foo', 'bar'],
    };

    const result = await pairings.createPairing(payload);

    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(clientQueryMock).toHaveBeenCalledTimes(3); // duplicate check + insert + log
    expect(result).toEqual({ pairingId: 42 });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('createPairing throws when duplicate exists', async () => {
  getClientMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });
  clientQueryMock.mockResolvedValueOnce({ rows: [{ id: 99 }] });

  await expect(
      pairings.createPairing({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
        matchPatterns: ['foo'],
      }),
    ).rejects.toMatchObject({ status: 409, existingId: 99 });

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('updatePairing updates fields and logs change', async () => {
  getClientMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('UPDATE account_pairings')) {
      return { rowCount: 1 };
    }
    if (sql.includes('INSERT INTO account_pairing_log')) {
      return { rows: [] };
    }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });

    const result = await pairings.updatePairing({ id: 1, matchPatterns: ['x'], isActive: false });

    expect(result).toEqual({ updated: true });
    expect(clientQueryMock).toHaveBeenCalledTimes(2);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('deletePairing removes record and logs deletion', async () => {
  getClientMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (sql.trim().startsWith('DELETE FROM account_pairings')) {
      return { rowCount: 1 };
    }
    if (sql.includes('INSERT INTO account_pairing_log')) {
      return { rows: [] };
    }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });

    const result = await pairings.deletePairing({ id: 7 });

    expect(result).toEqual({ deleted: true });
    expect(clientQueryMock).toHaveBeenCalledTimes(2);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('getActivePairings uses provided client without releasing it', async () => {
    const customRelease = vi.fn();
    const customQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 5,
          credit_card_vendor: 'max',
          credit_card_account_number: null,
          bank_vendor: 'hapoalim',
          bank_account_number: null,
          match_patterns: JSON.stringify(['pattern']),
        },
      ],
    });

    const rows = await pairings.getActivePairings({ query: customQuery, release: customRelease });

    expect(rows).toEqual([
      {
        id: 5,
        creditCardVendor: 'max',
        creditCardAccountNumber: null,
        bankVendor: 'hapoalim',
        bankAccountNumber: null,
        matchPatterns: ['pattern'],
      },
    ]);
    expect(customRelease).not.toHaveBeenCalled();
  });
});
