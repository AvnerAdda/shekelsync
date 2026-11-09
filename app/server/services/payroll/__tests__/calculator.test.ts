import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const calculator = require('../calculator.js');

describe('payroll calculator', () => {
  it('computes employee and employer shares of gross salary', () => {
    const result = calculator.computePlanContribution(20000, { kind: 'pension', employee_pct: 6, employer_pct: 6.5 });
    expect(result).toEqual({ kind: 'pension', base: 20000, employee: 1200, employer: 1300, total: 2500 });
  });

  it('caps the keren hishtalmut base at the salary ceiling', () => {
    const result = calculator.computePlanContribution(30000, {
      kind: 'keren_hishtalmut',
      ...calculator.PLAN_DEFAULTS.keren_hishtalmut,
    });
    expect(result.base).toBe(15712);
    expect(result.employee).toBeCloseTo(392.8, 2);
    expect(result.employer).toBeCloseTo(1178.4, 2);
    expect(result.total).toBeCloseTo(1571.2, 2);
  });

  it('does not cap salaries below the ceiling', () => {
    const result = calculator.computePlanContribution(12000, { kind: 'keren_hishtalmut', employee_pct: 2.5, employer_pct: 7.5, salary_cap: 15712 });
    expect(result.base).toBe(12000);
    expect(result.total).toBe(1200);
  });

  it('sums only active plans', () => {
    const breakdown = calculator.computeContributionBreakdown(20000, [
      { kind: 'pension', employee_pct: 6, employer_pct: 6.5, is_active: 1 },
      { kind: 'severance', employee_pct: 0, employer_pct: 6, is_active: 1 },
      { kind: 'keren_hishtalmut', employee_pct: 2.5, employer_pct: 7.5, salary_cap: 15712, is_active: 0 },
    ]);
    expect(breakdown.items.map((item: any) => item.kind)).toEqual(['pension', 'severance']);
    expect(breakdown.totals).toEqual({ employee: 1200, employer: 2500, total: 3700 });
  });

  it('treats missing gross as zero', () => {
    expect(calculator.computePlanContribution(null, { kind: 'pension', employee_pct: 6, employer_pct: 6.5 }).total).toBe(0);
  });

  describe('matchesSalaryDeposit', () => {
    const employment = {
      salary_match_pattern: 'משכורת אינטל',
      salary_match_vendor: 'hapoalim',
      salary_match_account_number: '12345',
    };

    it('matches despite changing dates and punctuation in the name', () => {
      expect(calculator.matchesSalaryDeposit(employment, {
        name: 'משכורת-אינטל 10/26', price: 18000, vendor: 'hapoalim', account_number: '12345',
      })).toBe(true);
    });

    it('rejects other vendors, accounts, outflows and unrelated names', () => {
      const base = { name: 'משכורת אינטל', price: 18000, vendor: 'hapoalim', account_number: '12345' };
      expect(calculator.matchesSalaryDeposit(employment, { ...base, vendor: 'leumi' })).toBe(false);
      expect(calculator.matchesSalaryDeposit(employment, { ...base, account_number: '999' })).toBe(false);
      expect(calculator.matchesSalaryDeposit(employment, { ...base, price: -18000 })).toBe(false);
      expect(calculator.matchesSalaryDeposit(employment, { ...base, name: 'העברה מאמא' })).toBe(false);
    });

    it('ignores vendor and account when the rule does not set them', () => {
      expect(calculator.matchesSalaryDeposit(
        { salary_match_pattern: 'salary' },
        { name: 'SALARY ACME LTD', price: 1, vendor: 'any', account_number: null },
      )).toBe(true);
    });

    it('never matches without a pattern', () => {
      expect(calculator.matchesSalaryDeposit({ salary_match_pattern: '  ' }, { name: 'x', price: 1 })).toBe(false);
    });
  });
});
