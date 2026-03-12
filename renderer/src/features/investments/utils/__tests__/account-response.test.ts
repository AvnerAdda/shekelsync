import { describe, expect, it } from 'vitest';
import { getCreatedInvestmentAccountId } from '../account-response';

describe('getCreatedInvestmentAccountId', () => {
  it('reads the nested account response used by the investments API', () => {
    expect(getCreatedInvestmentAccountId({
      account: { id: 44, account_name: 'Brokerage' },
    })).toBe(44);
  });

  it('falls back to a legacy top-level id when present', () => {
    expect(getCreatedInvestmentAccountId({ id: 12 })).toBe(12);
  });

  it('returns null when no usable id exists', () => {
    expect(getCreatedInvestmentAccountId({ account: {} })).toBeNull();
    expect(getCreatedInvestmentAccountId(null)).toBeNull();
  });
});
