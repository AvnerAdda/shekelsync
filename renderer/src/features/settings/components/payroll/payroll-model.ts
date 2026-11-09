// Mirrors app/server/services/payroll (service.js + calculator.js).

export type PayrollMember = 'self' | 'spouse';
export type PlanKind = 'pension' | 'severance' | 'keren_hishtalmut';

export const PLAN_KINDS: readonly PlanKind[] = ['pension', 'severance', 'keren_hishtalmut'];

export interface ContributionPlan {
  id?: number;
  kind: PlanKind;
  account_id: number | null;
  employee_pct: number;
  employer_pct: number;
  salary_cap: number | null;
  start_date: string | null;
  is_active: 0 | 1;
}

export interface Employment {
  id: number;
  member: PayrollMember;
  employer_name: string | null;
  gross_monthly: number | null;
  salary_match_pattern: string | null;
  salary_match_vendor: string | null;
  salary_match_account_number: string | null;
  is_active: 0 | 1;
  updated_at: string | null;
}

export interface ContributionItem {
  kind: PlanKind;
  base: number;
  employee: number;
  employer: number;
  total: number;
}

export interface ContributionBreakdown {
  items: ContributionItem[];
  totals: { employee: number; employer: number; total: number };
}

export interface PayrollMemberView {
  member: PayrollMember;
  displayName: string | null;
  available: boolean;
  employment: Employment | null;
  plans: ContributionPlan[];
  breakdown: ContributionBreakdown;
}

export interface PayrollAccount {
  id: number;
  account_name: string;
  account_type: string;
  institution: string | null;
}

export interface PlanDefaults {
  employee_pct: number;
  employer_pct: number;
  salary_cap: number | null;
}

export interface PayrollSetup {
  members: PayrollMemberView[];
  accounts: PayrollAccount[];
  defaults: {
    plans: Record<PlanKind, PlanDefaults>;
    preferredAccountTypes: Record<PlanKind, string[]>;
  };
}

export interface SalaryMatchRule {
  salary_match_pattern: string | null;
  salary_match_vendor: string | null;
  salary_match_account_number: string | null;
}

export interface SalaryCandidate {
  key: string;
  name: string;
  vendor: string;
  vendorNickname: string | null;
  accountNumber: string | null;
  match: SalaryMatchRule;
  monthCount: number;
  depositCount: number;
  medianAmount: number;
  lastDate: string | null;
  looksLikeSalary: boolean;
  claimedBy: PayrollMember | null;
}

function round2(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function finiteOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function computePlanContribution(grossMonthly: number | null | undefined, plan: ContributionPlan): ContributionItem {
  const gross = Math.max(0, finiteOrZero(grossMonthly));
  const cap = Number(plan.salary_cap);
  const base = plan.salary_cap !== null && Number.isFinite(cap) && cap > 0 ? Math.min(gross, cap) : gross;
  const employee = round2((base * Math.max(0, finiteOrZero(plan.employee_pct))) / 100);
  const employer = round2((base * Math.max(0, finiteOrZero(plan.employer_pct))) / 100);
  return { kind: plan.kind, base: round2(base), employee, employer, total: round2(employee + employer) };
}

export function computeContributionBreakdown(
  grossMonthly: number | null | undefined,
  plans: ContributionPlan[],
): ContributionBreakdown {
  const items = plans.filter((plan) => plan.is_active === 1).map((plan) => computePlanContribution(grossMonthly, plan));
  const totals = items.reduce(
    (sum, item) => ({
      employee: sum.employee + item.employee,
      employer: sum.employer + item.employer,
      total: sum.total + item.total,
    }),
    { employee: 0, employer: 0, total: 0 },
  );
  return {
    items,
    totals: { employee: round2(totals.employee), employer: round2(totals.employer), total: round2(totals.total) },
  };
}

/**
 * Plans for the dialog: stored plans where they exist, defaults otherwise.
 * A brand-new setup starts with every plan switched on.
 */
export function buildDraftPlans(
  stored: ContributionPlan[],
  defaults: Record<PlanKind, PlanDefaults>,
  accounts: PayrollAccount[],
  preferredAccountTypes: Record<PlanKind, string[]>,
): ContributionPlan[] {
  const isNewSetup = stored.length === 0;
  return PLAN_KINDS.map((kind) => {
    const existing = stored.find((plan) => plan.kind === kind);
    if (existing) return { ...existing };
    const preferred = preferredAccountTypes[kind] ?? [];
    const suggestedAccount = accounts.find((account) => preferred.includes(account.account_type));
    return {
      kind,
      account_id: suggestedAccount?.id ?? null,
      employee_pct: defaults[kind].employee_pct,
      employer_pct: defaults[kind].employer_pct,
      salary_cap: defaults[kind].salary_cap,
      start_date: null,
      is_active: isNewSetup ? 1 : 0,
    };
  });
}

/** Accounts for a plan's picker, preferred account types first. */
export function sortAccountsForPlan(
  accounts: PayrollAccount[],
  preferredTypes: string[] = [],
): PayrollAccount[] {
  return [...accounts].sort((left, right) => {
    const leftPreferred = preferredTypes.includes(left.account_type) ? 0 : 1;
    const rightPreferred = preferredTypes.includes(right.account_type) ? 0 : 1;
    return leftPreferred - rightPreferred;
  });
}

export function candidateMatchesRule(candidate: SalaryCandidate, rule: SalaryMatchRule | null | undefined): boolean {
  if (!rule?.salary_match_pattern) return false;
  return candidate.match.salary_match_pattern === rule.salary_match_pattern
    && (candidate.match.salary_match_vendor ?? null) === (rule.salary_match_vendor ?? null)
    && (candidate.match.salary_match_account_number ?? null) === (rule.salary_match_account_number ?? null);
}
