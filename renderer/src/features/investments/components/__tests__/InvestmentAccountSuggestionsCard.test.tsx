import { describe, expect, it } from 'vitest';
import {
  findMatchingInvestmentAccounts,
  getInvestmentSuggestionKey,
} from '../investment-account-suggestions-helpers';

describe('InvestmentAccountSuggestionsCard helpers', () => {
  it('builds deterministic keys from transaction identifiers and fallback fields', () => {
    expect(
      getInvestmentSuggestionKey({
        suggestedAccountType: 'pension',
        suggestedInstitution: 'Menora',
        suggestedAccountName: 'Pension',
        avgConfidence: 0.9,
        transactions: [
          {
            transactionIdentifier: 'b',
            transactionVendor: 'Vendor B',
            transactionDate: '2025-01-01',
            transactionAmount: 100,
            transactionName: 'Txn B',
          },
          {
            transactionIdentifier: 'a',
            transactionVendor: 'Vendor A',
            transactionDate: '2025-01-02',
            transactionAmount: 200,
            transactionName: 'Txn A',
          },
        ],
        totalAmount: 300,
        transactionCount: 2,
        dateRange: { earliest: '2025-01-01', latest: '2025-01-02' },
      } as any),
    ).toBe('a|b');

    expect(
      getInvestmentSuggestionKey({
        suggestedAccountType: 'brokerage',
        suggestedInstitution: null,
        suggestedAccountName: 'Broker',
        avgConfidence: 0.8,
        transactions: [],
        totalAmount: 0,
        transactionCount: 0,
        dateRange: { earliest: '2025-01-01', latest: '2025-01-01' },
      } as any),
    ).toBe('brokerage-Broker-none');
  });

  it('matches accounts by account type or institution name overlap', () => {
    const accounts = [
      {
        id: 1,
        account_name: 'Broker One',
        account_type: 'brokerage',
        institution: {
          id: 11,
          vendor_code: 'broker_one',
          display_name_he: 'ברוקר וואן',
          display_name_en: 'Broker One',
          institution_type: 'investment',
          category: 'investment',
          subcategory: null,
          logo_url: null,
          is_scrapable: true,
          scraper_company_id: null,
        },
        currency: 'ILS',
      },
      {
        id: 2,
        account_name: 'Menora Pension',
        account_type: 'pension',
        institution: {
          id: 12,
          vendor_code: 'menora',
          display_name_he: '',
          display_name_en: 'Menora',
          institution_type: 'investment',
          category: 'investment',
          subcategory: null,
          logo_url: null,
          is_scrapable: true,
          scraper_company_id: null,
        },
        currency: 'ILS',
      },
    ] as any[];

    const typeMatch = findMatchingInvestmentAccounts(
      {
        suggestedAccountType: 'pension',
        suggestedInstitution: null,
      } as any,
      accounts as any,
    );
    expect(typeMatch.map((item) => item.id)).toEqual([2]);

    const institutionMatch = findMatchingInvestmentAccounts(
      {
        suggestedAccountType: 'unknown',
        suggestedInstitution: 'Menora Insurance',
      } as any,
      accounts as any,
    );
    expect(institutionMatch.map((item) => item.id)).toEqual([2]);
  });
});
