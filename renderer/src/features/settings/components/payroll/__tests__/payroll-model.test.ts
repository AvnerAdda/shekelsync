import { describe, expect, it } from 'vitest';
import {
  ContributionPlan,
  PayrollAccount,
  SalaryCandidate,
  buildDraftPlans,
  candidateMatchesRule,
  computeContributionBreakdown,
  sortAccountsForPlan,
} from '../payroll-model';

const defaults = {
  pension: { employee_pct: 6, employer_pct: 6.5, salary_cap: null },
  severance: { employee_pct: 0, employer_pct: 6, salary_cap: null },
  keren_hishtalmut: { employee_pct: 2.5, employer_pct: 7.5, salary_cap: 15712 },
};
const preferred = { pension: ['pension'], severance: ['pension'], keren_hishtalmut: ['provident'] };
const accounts: PayrollAccount[] = [
  { id: 2, account_name: 'Gemel', account_type: 'study_fund', institution: null },
  { id: 8, account_name: 'Clal KH', account_type: 'provident', institution: 'Clal' },
  { id: 7, account_name: 'Harel Pension', account_type: 'pension', institution: 'Harel' },
];

describe('payroll model', () => {
  it('matches the server breakdown, including the keren hishtalmut cap', () => {
    const plans = buildDraftPlans([], defaults, accounts, preferred);
    const breakdown = computeContributionBreakdown(20000, plans);
    expect(breakdown.items.map((item) => [item.kind, item.total])).toEqual([
      ['pension', 2500],
      ['severance', 1200],
      ['keren_hishtalmut', 1571.2],
    ]);
    expect(breakdown.totals).toEqual({ employee: 1592.8, employer: 3678.4, total: 5271.2 });
  });

  it('starts a new setup with every plan on and suggests matching accounts', () => {
    const plans = buildDraftPlans([], defaults, accounts, preferred);
    expect(plans.map((plan) => [plan.kind, plan.is_active, plan.account_id])).toEqual([
      ['pension', 1, 7],
      ['severance', 1, 7],
      ['keren_hishtalmut', 1, 8],
    ]);
  });

  it('keeps stored plans and adds missing kinds switched off', () => {
    const stored: ContributionPlan[] = [{
      id: 5, kind: 'pension', account_id: 7, employee_pct: 7, employer_pct: 7.5, salary_cap: null, start_date: '2026-01-01', is_active: 1,
    }];
    const plans = buildDraftPlans(stored, defaults, accounts, preferred);
    expect(plans[0]).toEqual(stored[0]);
    expect(plans.slice(1).map((plan) => plan.is_active)).toEqual([0, 0]);
  });

  it('sorts preferred account types first', () => {
    expect(sortAccountsForPlan(accounts, ['provident']).map((account) => account.id)).toEqual([8, 2, 7]);
  });

  it('matches a candidate to a stored rule exactly', () => {
    const candidate = {
      match: { salary_match_pattern: 'משכורת', salary_match_vendor: 'hapoalim', salary_match_account_number: '1' },
    } as SalaryCandidate;
    expect(candidateMatchesRule(candidate, candidate.match)).toBe(true);
    expect(candidateMatchesRule(candidate, { ...candidate.match, salary_match_account_number: '2' })).toBe(false);
    expect(candidateMatchesRule(candidate, null)).toBe(false);
  });
});
