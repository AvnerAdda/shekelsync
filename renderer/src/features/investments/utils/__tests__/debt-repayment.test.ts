import { describe, expect, it } from 'vitest';
import type { InvestmentLiability } from '@renderer/types/investments';
import { calculateDebtPlan, debtPayoffMonth } from '../debt-repayment';

function debt(overrides: Partial<InvestmentLiability> = {}): InvestmentLiability {
  return {
    id: 1, liability_name: 'Loan', liability_type: 'loan', balance: 100,
    currency: 'ILS', interest_rate: 12, monthly_payment: 60, as_of_date: '2026-09-08',
    included_in_net_worth: true, is_active: true, ...overrides,
  };
}

describe('calculateDebtPlan', () => {
  it('calculates a known two-payment amortization and caps the final payment', () => {
    const liability = debt();
    const result = calculateDebtPlan([liability]);
    expect(result).toMatchObject({ status: 'paid_off', months: 2, totalInterestCents: 141, totalPaidCents: 10141 });
    expect(result.schedule).toEqual([
      { month: 1, paymentCents: 6000, interestCents: 100, remainingCents: 4100, paidOffNames: [] },
      { month: 2, paymentCents: 4141, interestCents: 41, remainingCents: 0, paidOffNames: ['Loan'] },
    ]);
    expect(liability.balance).toBe(100);
  });

  it('pays zero-interest debts to the last cent without phantom interest', () => {
    const result = calculateDebtPlan([debt({ balance: 100.01, interest_rate: 0, monthly_payment: 25 })]);
    expect(result).toMatchObject({ status: 'paid_off', months: 5, totalInterestCents: 0, totalPaidCents: 10001 });
    expect(result.schedule.at(-1)?.paymentCents).toBe(1);
  });

  it('rounds decimal inputs and exact half-cent interest upward', () => {
    expect(calculateDebtPlan([debt({ balance: 10.075, interest_rate: 0 })]).initialBalanceCents).toBe(1008);
    expect(calculateDebtPlan([debt({ balance: 0.5, interest_rate: 12 })]).totalInterestCents).toBe(1);
    expect(calculateDebtPlan([debt({ balance: 0.49, interest_rate: 12 })]).totalInterestCents).toBe(0);
    expect(calculateDebtPlan([debt({ balance: 0.01, interest_rate: 1e-8 })]).totalInterestCents).toBe(0);
  });

  it('rolls unused final payments into another debt during the same month', () => {
    const liabilities = [
      debt({ id: 1, liability_name: 'Small', balance: 30, interest_rate: 0, monthly_payment: 50 }),
      debt({ id: 2, liability_name: 'Large', balance: 200, interest_rate: 0, monthly_payment: 50 }),
    ];
    const result = calculateDebtPlan(liabilities);
    const baseline = calculateDebtPlan(liabilities, { rollOverPayments: false });
    expect(result.monthlyBudgetCents).toBe(10000);
    expect(result.schedule.map((row) => row.paymentCents)).toEqual([10000, 10000, 3000]);
    expect(baseline.schedule.map((row) => row.paymentCents)).toEqual([8000, 5000, 5000, 5000]);
    expect(result.months).toBe(3);
    expect(baseline.months).toBe(4);
  });

  it('compares highest-rate and smallest-balance priority using the same budget', () => {
    const liabilities = [
      debt({ id: 1, liability_name: 'High rate', balance: 500, interest_rate: 24, monthly_payment: 10 }),
      debt({ id: 2, liability_name: 'Small balance', balance: 100, interest_rate: 0, monthly_payment: 0 }),
    ];
    const avalanche = calculateDebtPlan(liabilities, { extraMonthly: 100, strategy: 'avalanche' });
    const snowball = calculateDebtPlan(liabilities, { extraMonthly: 100, strategy: 'snowball' });
    expect(avalanche.status).toBe('paid_off');
    expect(snowball.status).toBe('paid_off');
    expect(avalanche.monthlyBudgetCents).toBe(snowball.monthlyBudgetCents);
    expect(snowball.schedule[0].paidOffNames).toEqual(['Small balance']);
    expect(avalanche.schedule[0].paidOffNames).toEqual([]);
    expect(avalanche.totalInterestCents).toBeLessThan(snowball.totalInterestCents);
    for (const result of [avalanche, snowball]) {
      expect(result.totalPaidCents).toBe(result.initialBalanceCents + result.totalInterestCents);
      expect(result.schedule.every((row) => row.paymentCents <= result.monthlyBudgetCents && row.remainingCents >= 0)).toBe(true);
    }
  });

  it('shortens a loan and lowers interest with extra monthly payments', () => {
    const liabilities = [debt({ balance: 1000, monthly_payment: 100 })];
    const baseline = calculateDebtPlan(liabilities, { rollOverPayments: false });
    const accelerated = calculateDebtPlan(liabilities, { extraMonthly: 50 });
    expect(baseline.months).toBe(11);
    expect(accelerated.months).toBe(7);
    expect(accelerated.totalInterestCents).toBeLessThan(baseline.totalInterestCents);
  });

  it('detects payments that cannot reduce any remaining debt', () => {
    expect(calculateDebtPlan([debt({ balance: 1000, interest_rate: 12, monthly_payment: 10 })])).toMatchObject({ status: 'non_amortizing', months: null });
    expect(calculateDebtPlan([debt({ balance: 1000, interest_rate: 12, monthly_payment: 9 })]).remainingCents).toBe(100100);
    expect(calculateDebtPlan([debt({ interest_rate: 0, monthly_payment: 0 })]).status).toBe('non_amortizing');
  });

  it('allows a temporarily growing debt when another payment will become available', () => {
    const liabilities = [
      debt({ id: 1, balance: 1000, interest_rate: 12, monthly_payment: 5 }),
      debt({ id: 2, balance: 100, interest_rate: 0, monthly_payment: 50 }),
    ];
    expect(calculateDebtPlan(liabilities).status).toBe('paid_off');
    expect(calculateDebtPlan(liabilities, { rollOverPayments: false }).status).toBe('non_amortizing');
  });

  it('reports missing rates and payments instead of inventing zero-interest estimates', () => {
    const result = calculateDebtPlan([debt({ interest_rate: null, monthly_payment: null })]);
    expect(result).toMatchObject({ status: 'incomplete', months: null, schedule: [] });
    expect(result.issues[0].fields).toEqual(['monthly_payment', 'interest_rate']);
  });

  it.each([
    { balance: NaN }, { balance: -0.01 }, { balance: null },
    { monthly_payment: Infinity }, { monthly_payment: -1 },
    { interest_rate: NaN }, { interest_rate: -0.000000001 }, { currency: '' },
  ])('rejects malformed financial input %j', (overrides) => {
    expect(calculateDebtPlan([debt(overrides as Partial<InvestmentLiability>)]).status).toBe('incomplete');
  });

  it('rejects combined currencies while accepting normalized single-currency values', () => {
    const mixed = calculateDebtPlan([debt(), debt({ id: 2, currency: 'USD' })]);
    expect(mixed.status).toBe('incomplete');
    expect(mixed.issues).toHaveLength(2);
    expect(mixed.issues.every((issue) => issue.fields.includes('currency'))).toBe(true);
    expect(calculateDebtPlan([debt({ currency: ' ils ' }), debt({ id: 2 })]).status).toBe('paid_off');
  });

  it('ignores inactive and already paid debts, including missing optional terms', () => {
    expect(calculateDebtPlan([
      debt({ is_active: false, currency: 'USD' }),
      debt({ id: 2, balance: 0, interest_rate: null, monthly_payment: null }),
    ])).toMatchObject({ status: 'paid_off', months: 0, initialBalanceCents: 0, issues: [] });
  });

  it('keeps partial schedules distinguishable from payoff totals at its horizon', () => {
    const result = calculateDebtPlan([debt({ balance: 1000, interest_rate: 0, monthly_payment: 1 })], { maxMonths: 24 });
    expect(result).toMatchObject({ status: 'horizon', months: null, remainingCents: 97600 });
    expect(result.schedule).toHaveLength(24);
  });

  it('rejects unsafe sums and stops interest overflow', () => {
    const enormous = debt({ balance: 50_000_000_000_000, monthly_payment: 1 });
    expect(calculateDebtPlan([enormous, { ...enormous, id: 2 }]).status).toBe('numeric_limit');
    expect(calculateDebtPlan([debt({ balance: 1_000_000_000_000, interest_rate: 1_000_000_000 })]).status).toBe('numeric_limit');
  });

  it.each([{ extraMonthly: -1 }, { extraMonthly: NaN }, { maxMonths: 0 }, { maxMonths: Infinity }])('rejects invalid planner options %j', (options) => {
    expect(calculateDebtPlan([debt()], options).status).toBe('incomplete');
  });
});

describe('debtPayoffMonth', () => {
  it('starts next month and handles month-end and year boundaries', () => {
    const february = debtPayoffMonth(1, new Date(2026, 0, 31));
    expect([february.getFullYear(), february.getMonth(), february.getDate()]).toEqual([2026, 1, 28]);
    const january = debtPayoffMonth(1, new Date(2026, 11, 31));
    expect([january.getFullYear(), january.getMonth()]).toEqual([2027, 0]);
    expect(debtPayoffMonth(1, new Date(2028, 0, 31)).getDate()).toBe(29);
  });
});
