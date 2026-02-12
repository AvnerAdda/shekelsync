import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const getClientMock = vi.fn();
const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const getActivePairingsMock = vi.fn();
const getVendorCodesByTypesMock = vi.fn();
const repaymentConditionMock = vi.fn(() => "cd.name = 'Credit Card Repayment'");

let unpairedService;

beforeAll(async () => {
  const module = await import('../unpaired.js');
  unpairedService = module.default ?? module;
});

beforeEach(() => {
  getClientMock.mockReset();
  clientQueryMock.mockReset();
  clientReleaseMock.mockReset();
  getActivePairingsMock.mockReset();
  getVendorCodesByTypesMock.mockReset();
  repaymentConditionMock.mockClear();

  getClientMock.mockResolvedValue({
    query: clientQueryMock,
    release: clientReleaseMock,
  });

  getActivePairingsMock.mockResolvedValue([]);
  getVendorCodesByTypesMock.mockResolvedValue(['hapoalim']);
  clientQueryMock.mockResolvedValue({ rows: [] });
  unpairedService.__resetDependencies?.();
  unpairedService.__setDatabase({
    getClient: getClientMock,
  });
  unpairedService.__setPairingsService({
    getActivePairings: getActivePairingsMock,
  });
  unpairedService.__setVendorCodesResolver(getVendorCodesByTypesMock);
  unpairedService.__setRepaymentCategoryResolver(repaymentConditionMock);
});

afterEach(() => {
  unpairedService.__resetDependencies?.();
  vi.restoreAllMocks();
});

describe('accounts unpaired service', () => {
  it('returns only count when include_details is false and excludes transactions covered by active pairings', async () => {
    getVendorCodesByTypesMock.mockResolvedValue(['hapoalim', 'leumi']);
    getActivePairingsMock.mockResolvedValue([
      {
        bankVendor: 'hapoalim',
        bankAccountNumber: '1111',
        matchPatterns: ['isracard'],
      },
    ]);
    clientQueryMock.mockResolvedValue({
      rows: [
        {
          identifier: 't-filtered',
          vendor: 'hapoalim',
          account_number: '1111',
          name: 'isracard repayment',
          price: -1000,
          category_definition_id: 10,
          category_name: 'Repayment',
          institution_id: 1,
        },
        {
          identifier: 't-kept',
          vendor: 'leumi',
          account_number: '9999',
          name: 'Card payment',
          price: -500,
          category_definition_id: 10,
          category_name: 'Repayment',
          institution_id: null,
        },
      ],
    });

    const result = await unpairedService.getTrulyUnpairedTransactions({ include_details: false });

    const [sql, params] = clientQueryMock.mock.calls[0];
    expect(String(sql).replace(/\s+/g, ' ')).toContain('WHERE vendor IN ($1, $2)');
    expect(params).toEqual(['hapoalim', 'leumi']);
    expect(result).toEqual({ count: 1 });
    expect(clientReleaseMock).toHaveBeenCalledTimes(1);
  });

  it('returns detailed unpaired transactions with institution mapping when include_details is true', async () => {
    getVendorCodesByTypesMock.mockResolvedValue(['hapoalim']);
    clientQueryMock.mockResolvedValue({
      rows: [
        {
          identifier: 'u1',
          vendor: 'hapoalim',
          date: '2026-01-05',
          name: 'Repayment not paired',
          price: -700,
          category_definition_id: 10,
          category_name: 'Repayment',
          account_number: '1111',
          institution_id: 1,
          institution_name_he: 'הפועלים',
          institution_name_en: 'Hapoalim',
          institution_logo: 'https://logo.example/hapoalim.png',
          institution_type: 'bank',
        },
        {
          identifier: 'u2',
          vendor: 'hapoalim',
          date: '2026-01-06',
          name: 'Repayment no institution',
          price: -100,
          category_definition_id: 10,
          category_name: 'Repayment',
          account_number: '1111',
          institution_id: null,
          institution_name_he: null,
          institution_name_en: null,
          institution_logo: null,
          institution_type: null,
        },
      ],
    });

    const result = await unpairedService.getTrulyUnpairedTransactions({ include_details: true });

    expect(result.count).toBe(2);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      identifier: 'u1',
      institution: {
        id: 1,
        display_name_en: 'Hapoalim',
        institution_type: 'bank',
      },
    });
    expect(result.transactions[1].institution).toBeNull();
    expect(clientReleaseMock).toHaveBeenCalledTimes(1);
  });

  it('returns unpaired transaction count via helper method', async () => {
    clientQueryMock.mockResolvedValue({
      rows: [
        {
          identifier: 'only-row',
          vendor: 'hapoalim',
          account_number: '1',
          name: 'unpaired',
          price: -1,
          category_definition_id: 10,
          category_name: 'Repayment',
        },
      ],
    });

    await expect(unpairedService.getUnpairedTransactionCount()).resolves.toBe(1);
  });

  it('falls back to empty vendor list when vendor registry lookup fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getVendorCodesByTypesMock.mockRejectedValue(new Error('registry unavailable'));

    const result = await unpairedService.getTrulyUnpairedTransactions({ include_details: true });

    expect(result).toEqual({
      count: 0,
      transactions: [],
    });
    expect(clientQueryMock).not.toHaveBeenCalled();
    expect(clientReleaseMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('caches bank vendors between calls within ttl', async () => {
    getVendorCodesByTypesMock.mockResolvedValue(['hapoalim', 'leumi']);
    clientQueryMock.mockResolvedValue({ rows: [] });

    await unpairedService.getTrulyUnpairedTransactions({ include_details: false });
    await unpairedService.getTrulyUnpairedTransactions({ include_details: false });

    expect(getVendorCodesByTypesMock).toHaveBeenCalledTimes(1);
    expect(clientQueryMock).toHaveBeenCalledTimes(2);
    expect(clientReleaseMock).toHaveBeenCalledTimes(2);
  });

  it('releases DB client when query fails', async () => {
    getVendorCodesByTypesMock.mockResolvedValue(['hapoalim']);
    clientQueryMock.mockRejectedValue(new Error('query failed'));

    await expect(
      unpairedService.getTrulyUnpairedTransactions({ include_details: false }),
    ).rejects.toThrow('query failed');

    expect(clientReleaseMock).toHaveBeenCalledTimes(1);
  });
});
