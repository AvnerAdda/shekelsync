import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../statement-import.js');

let service: any;

describe('statement import service', () => {
  const queryMock = vi.fn();
  const clientQueryMock = vi.fn();
  const releaseMock = vi.fn();
  const ledger = {
    isBankVendor: vi.fn((vendor: string) => vendor === 'hapoalim'),
    insertTransaction: vi.fn(),
    createScrapeBatchContext: vi.fn(() => ({ batchIdentifiers: new Set(), claimedIdentifiers: new Set() })),
    applyCategorizationRules: vi.fn(),
    applyAccountPairings: vi.fn(),
    getNameMatchScore: vi.fn(() => 0),
  };
  const runExclusive = vi.fn((work: () => Promise<unknown>) => work());
  const clearCaches = vi.fn();

  beforeAll(async () => {
    const mod = await modulePromise;
    service = mod.default ?? mod;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM vendor_credentials')) {
        return { rows: [{ id: 3, vendor: 'hapoalim', nickname: 'Checking', bank_account_number: '12-345', card6_digits: null }] };
      }
      return { rows: [] };
    });
    clientQueryMock.mockReset().mockResolvedValue({ rows: [{ row_count: 0 }] });
    service.__setDependencies({
      database: { query: queryMock, getClient: async () => ({ query: clientQueryMock, release: releaseMock }) },
      ledger,
      runExclusive,
      clearCaches,
      now: () => Date.parse('2026-06-01T09:00:00.000Z'),
    });
  });

  afterEach(() => {
    service.__resetDependencies();
  });

  describe('israelMidnightIso', () => {
    it.each([
      ['2026-01-15', '2026-01-14T22:00:00.000Z'],
      ['2026-07-15', '2026-07-14T21:00:00.000Z'],
      // DST starts on the Friday before the last Sunday of March (02:00); midnight is still winter time.
      ['2026-03-27', '2026-03-26T22:00:00.000Z'],
      ['2026-03-28', '2026-03-27T21:00:00.000Z'],
    ])('%s -> %s', (day, expected) => {
      expect(service.israelMidnightIso(day)).toBe(expected);
    });

    it('rejects impossible dates', () => {
      expect(service.israelMidnightIso('2026-02-30')).toBeNull();
      expect(service.israelMidnightIso('15/01/2026')).toBeNull();
    });
  });

  it('reports why rows are invalid without touching the ledger', async () => {
    const result = await service.previewStatementImport({
      credentialId: 3,
      rows: [
        { date: '2026-05-01', description: 'Salary', amount: 1000 },
        { date: 'not a date', description: 'x', amount: 1 },
        { date: '1999-12-31', description: 'Old', amount: 1 },
        { date: '2026-09-01', description: 'Far future', amount: 1 },
        { date: '2026-05-02', description: '   ', amount: 1 },
        { date: '2026-05-02', description: 'NaN', amount: Number.NaN },
        { date: '2026-05-02', description: 'Zero', amount: 0 },
      ],
    });

    expect(result.rows.map((row: any) => row.reason ?? row.status)).toEqual([
      'new', 'invalid_date', 'date_out_of_range', 'date_out_of_range', 'missing_description', 'invalid_amount', 'zero_amount',
    ]);
    expect(result.target).toEqual({
      vendor: 'hapoalim',
      nickname: 'Checking',
      isBank: true,
      accountNumber: '12-345',
      accountNumberOptions: ['12-345'],
    });
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('refuses empty or oversized files and unknown accounts', async () => {
    await expect(service.previewStatementImport({ credentialId: 3, rows: [] }))
      .rejects.toMatchObject({ statusCode: 400, code: 'no_rows' });
    await expect(service.previewStatementImport({
      credentialId: 3,
      rows: Array.from({ length: service.MAX_ROWS + 1 }, () => ({ date: '2026-05-01', description: 'x', amount: 1 })),
    })).rejects.toMatchObject({ statusCode: 400, code: 'too_many_rows' });

    queryMock.mockImplementationOnce(async () => ({ rows: [] }));
    await expect(service.previewStatementImport({ credentialId: 99, rows: [{ date: '2026-05-01', description: 'x', amount: 1 }] }))
      .rejects.toMatchObject({ statusCode: 404, code: 'credential_not_found' });
  });

  it('commits inside the scrape lock, applies rules and pairings, and rolls back on failure', async () => {
    ledger.insertTransaction.mockRejectedValueOnce(new Error('disk full'));

    await expect(service.commitStatementImport({
      credentialId: 3,
      rows: [{ date: '2026-05-01', description: 'Salary', amount: 1000 }],
    })).rejects.toThrow('disk full');

    expect(runExclusive).toHaveBeenCalledTimes(1);
    expect(clientQueryMock).toHaveBeenCalledWith('BEGIN IMMEDIATE');
    expect(clientQueryMock).toHaveBeenCalledWith('ROLLBACK');
    expect(clientQueryMock).not.toHaveBeenCalledWith('COMMIT');
    expect(releaseMock).toHaveBeenCalled();
    expect(clearCaches).not.toHaveBeenCalled();
  });

  it('shapes rows like scraped bank transactions', async () => {
    let count = 0;
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ row_count: count }] };
      return { rows: [] };
    });
    ledger.insertTransaction.mockImplementation(async () => { count += 1; });

    const result = await service.commitStatementImport({
      credentialId: 3,
      rows: [{ date: '2026-05-01', description: '  Salary   ACME ', amount: 1000.004, memo: '' }],
    });

    expect(result).toMatchObject({ requested: 1, inserted: 1, skippedDuplicates: 0, invalid: 0 });
    const [txn, , vendor, isBank, accountNumber, nickname] = ledger.insertTransaction.mock.calls[0];
    expect(txn).toMatchObject({
      identifier: expect.stringMatching(/^stmt-[0-9a-f]{40}$/),
      type: 'normal',
      date: '2026-04-30T21:00:00.000Z',
      processedDate: '2026-04-30T21:00:00.000Z',
      chargedAmount: 1000,
      originalAmount: 1000,
      originalCurrency: 'ILS',
      chargedCurrency: 'ILS',
      description: 'Salary ACME',
      memo: null,
      status: 'completed',
    });
    expect([vendor, isBank, accountNumber, nickname]).toEqual(['hapoalim', true, '12-345', 'Checking']);
    expect(ledger.applyCategorizationRules).toHaveBeenCalled();
    expect(ledger.applyAccountPairings).toHaveBeenCalled();
    expect(clientQueryMock).toHaveBeenCalledWith('COMMIT');
    expect(clearCaches).toHaveBeenCalledTimes(1);
  });
});
