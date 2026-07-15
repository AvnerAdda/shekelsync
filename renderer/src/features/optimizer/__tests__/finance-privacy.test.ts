import { describe, expect, it } from 'vitest';

import { maskFinancialText } from '@renderer/shared/utils/finance-privacy';

describe('maskFinancialText', () => {
  it('masks prefix, suffix, and unlabelled financial figures', () => {
    const masked = maskFinancialText(
      'Save ₪500, 600 ₪, ILS 700, 800 NIS, or another 900 per month at 15%.',
    );

    expect(masked).toBe(
      'Save ₪***, *** ₪, ILS ***, *** NIS, or another *** per month at ***%.',
    );
    expect(masked).not.toMatch(/\d/);
  });
});
