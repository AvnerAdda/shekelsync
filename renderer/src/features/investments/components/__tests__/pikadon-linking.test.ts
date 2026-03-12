import { describe, expect, it } from 'vitest';
import {
  buildPikadonCandidateFromSuggestionTransaction,
  transactionLooksLikePikadonDeposit,
} from '../pikadon-linking';

describe('pikadon-linking helpers', () => {
  it('detects pikadon-looking negative transactions', () => {
    expect(transactionLooksLikePikadonDeposit({
      transactionIdentifier: 'tx-1',
      transactionVendor: 'discount',
      transactionDate: '2026-03-10',
      transactionAmount: -5000,
      transactionName: 'הפקדה לפיקדון שנתי',
    })).toBe(true);

    expect(transactionLooksLikePikadonDeposit({
      transactionIdentifier: 'tx-2',
      transactionVendor: 'discount',
      transactionDate: '2026-03-10',
      transactionAmount: -5000,
      transactionName: 'Monthly investment contribution',
    })).toBe(false);
  });

  it('builds pending setup candidates from grouped suggestion transactions', () => {
    expect(buildPikadonCandidateFromSuggestionTransaction({
      transactionIdentifier: 'tx-1',
      transactionVendor: 'discount',
      transactionDate: '2026-03-10',
      transactionAmount: -5000,
      transactionName: 'פיקדון מובנה',
    }, 7, 'פיקדונות')).toEqual({
      account_id: 7,
      account_name: 'פיקדונות',
      transaction_identifier: 'tx-1',
      transaction_vendor: 'discount',
      principal: 5000,
      deposit_date: '2026-03-10',
      transaction_name: 'פיקדון מובנה',
    });
  });
});
