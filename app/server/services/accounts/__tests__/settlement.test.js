import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const getClientMock = vi.fn();
const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const getActivePairingsMock = vi.fn();
const repaymentConditionMock = vi.fn(() => "cd.name = 'Credit Card Repayment'");

let settlementService;

beforeAll(async () => {
  const module = await import('../settlement.js');
  settlementService = module.default ?? module;
});

beforeEach(() => {
  getClientMock.mockReset();
  clientQueryMock.mockReset();
  clientReleaseMock.mockReset();
  getActivePairingsMock.mockReset();
  repaymentConditionMock.mockClear();

  getClientMock.mockResolvedValue({
    query: clientQueryMock,
    release: clientReleaseMock,
  });
  getActivePairingsMock.mockResolvedValue([]);
  settlementService.__setDatabase({
    getClient: getClientMock,
  });
  settlementService.__setPairingsService({
    getActivePairings: getActivePairingsMock,
  });
  settlementService.__setRepaymentCategoryResolver(repaymentConditionMock);
});

afterEach(() => {
  settlementService.__resetDependencies?.();
  vi.restoreAllMocks();
});

describe('accounts settlement service', () => {
  it('validates required input fields', async () => {
    await expect(settlementService.findSettlementCandidates({})).rejects.toMatchObject({
      status: 400,
      message: 'credit_card_account_number is required',
    });

    await expect(
      settlementService.findSettlementCandidates({ credit_card_account_number: '1234' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'bank_vendor is required',
    });
  });

  it('returns mapped candidates and stats after filtering transactions covered by active pairings', async () => {
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
          identifier: 'tx-filtered',
          vendor: 'hapoalim',
          date: '2026-01-01',
          name: 'isracard repayment',
          price: -1000,
          category_definition_id: 10,
          category_name: 'Credit Card Repayment',
          category_name_en: 'Credit Card Repayment',
          account_number: '1111',
          match_reason: 'account_number_match',
          institution_id: 1,
          institution_vendor_code: 'hapoalim',
          institution_name_he: 'הפועלים',
          institution_name_en: 'Hapoalim',
          institution_logo: null,
          institution_type: 'bank',
        },
        {
          identifier: 'tx-kept',
          vendor: 'hapoalim',
          date: '2026-01-02',
          name: 'monthly keyword transfer',
          price: 350,
          category_definition_id: 11,
          category_name: null,
          category_name_en: 'Transfers',
          account_number: '2222',
          match_reason: 'keyword_match',
          institution_id: 1,
          institution_vendor_code: 'hapoalim',
          institution_name_he: 'הפועלים',
          institution_name_en: 'Hapoalim',
          institution_logo: 'https://logo.example/hapoalim.png',
          institution_type: 'bank',
        },
      ],
    });

    const result = await settlementService.findSettlementCandidates({
      credit_card_account_number: '1234',
      bank_vendor: 'hapoalim',
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      identifier: 'tx-kept',
      categoryName: 'Transfers',
      matchReason: 'keyword_match',
      institution: {
        id: 1,
        vendor_code: 'hapoalim',
        display_name_en: 'Hapoalim',
      },
    });
    expect(result.stats).toEqual({
      total: 1,
      byMatchReason: { keyword_match: 1 },
      totalNegative: 0,
      totalPositive: 1,
    });
    expect(result.filters).toEqual({
      creditCardAccountNumber: '1234',
      bankVendor: 'hapoalim',
      bankAccountNumber: null,
    });
    expect(clientReleaseMock).toHaveBeenCalledTimes(1);
  });

  it('adds bank account constraint when bank_account_number is provided', async () => {
    clientQueryMock.mockResolvedValue({ rows: [] });

    await settlementService.findSettlementCandidates({
      credit_card_account_number: '8888',
      bank_vendor: 'leumi',
      bank_account_number: '9999',
    });

    const [sql, params] = clientQueryMock.mock.calls[0];
    expect(String(sql)).toContain('t.account_number = $');
    expect(params[0]).toBe('8888');
    expect(params[1]).toBe('leumi');
    expect(params[params.length - 1]).toBe('9999');
    expect(clientReleaseMock).toHaveBeenCalledTimes(1);
  });

  it('releases DB client when query fails', async () => {
    clientQueryMock.mockRejectedValue(new Error('db down'));

    await expect(
      settlementService.findSettlementCandidates({
        credit_card_account_number: '1234',
        bank_vendor: 'hapoalim',
      }),
    ).rejects.toThrow('db down');

    expect(clientReleaseMock).toHaveBeenCalledTimes(1);
  });
});
