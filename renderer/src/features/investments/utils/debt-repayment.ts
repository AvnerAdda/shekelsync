import type { InvestmentLiability } from '@renderer/types/investments';

export type DebtStrategy = 'avalanche' | 'snowball';
export type DebtPlanStatus = 'paid_off' | 'incomplete' | 'non_amortizing' | 'horizon' | 'numeric_limit';
export type DebtInputField = 'balance' | 'interest_rate' | 'monthly_payment' | 'currency';

export interface DebtInputIssue {
  debtId: number;
  name: string;
  fields: DebtInputField[];
}

export interface DebtScheduleMonth {
  month: number;
  paymentCents: number;
  interestCents: number;
  remainingCents: number;
  paidOffNames: string[];
}

export interface DebtPlan {
  status: DebtPlanStatus;
  months: number | null;
  initialBalanceCents: number;
  monthlyBudgetCents: number;
  totalInterestCents: number;
  totalPaidCents: number;
  remainingCents: number;
  issues: DebtInputIssue[];
  schedule: DebtScheduleMonth[];
}

interface Options {
  strategy?: DebtStrategy;
  extraMonthly?: number;
  /** Baseline keeps each debt's own payment and stops that payment when it closes. */
  rollOverPayments?: boolean;
  maxMonths?: number;
}

const MAX_CENTS = Number.MAX_SAFE_INTEGER;
const MAX_CENTS_BIGINT = BigInt(MAX_CENTS);
const RATE_SCALE = 1_000_000;
const MONTHLY_RATE_DENOMINATOR = BigInt(1200 * RATE_SCALE);

/** Round the decimal input half up, without binary floating-point tie errors. */
function decimalUnits(value: number, places: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > MAX_CENTS / 10 ** places) return null;
  const [coefficient, exponent = '0'] = String(value).split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = BigInt(whole + fraction);
  const shift = Number(exponent) - fraction.length + places;
  const divisor = shift < 0 ? 10n ** BigInt(-shift) : 1n;
  const rounded = shift < 0 ? (digits + divisor / 2n) / divisor : digits * 10n ** BigInt(shift);
  return rounded > MAX_CENTS_BIGINT ? null : Number(rounded);
}

const cents = (value: number) => decimalUnits(value, 2);

/** Nominal APR / 12, with every month's interest rounded half up to cents. */
function monthlyInterest(balanceCents: number, annualRateUnits: number): number | null {
  const numerator = BigInt(balanceCents) * BigInt(annualRateUnits);
  const rounded = (numerator + MONTHLY_RATE_DENOMINATOR / 2n) / MONTHLY_RATE_DENOMINATOR;
  return rounded > MAX_CENTS_BIGINT ? null : Number(rounded);
}

export function calculateDebtPlan(liabilities: InvestmentLiability[], options: Options = {}): DebtPlan {
  const { strategy = 'avalanche', extraMonthly = 0, rollOverPayments = true, maxMonths = 600 } = options;
  const result: DebtPlan = {
    status: 'incomplete', months: null, initialBalanceCents: 0, monthlyBudgetCents: 0,
    totalInterestCents: 0, totalPaidCents: 0, remainingCents: 0, issues: [], schedule: [],
  };
  const active = liabilities.filter((debt) => debt.is_active !== false);
  const currencies = new Set(active.filter((debt) => debt.balance !== 0).map((debt) => debt.currency?.trim().toUpperCase()));
  const debts: Array<{ id: number; name: string; balance: number; minimum: number; rate: number }> = [];
  for (const debt of active) {
    const balance = cents(debt.balance);
    if (balance === 0) continue;
    const fields: DebtInputField[] = [];
    const minimum = debt.monthly_payment == null ? null : cents(debt.monthly_payment);
    const rate = debt.interest_rate == null ? null : decimalUnits(debt.interest_rate, 6);
    if (balance === null) fields.push('balance');
    if (minimum === null) fields.push('monthly_payment');
    if (rate === null || !Number.isSafeInteger(rate) || rate < 0) fields.push('interest_rate');
    if (!/^[A-Z]{3}$/.test(debt.currency?.trim().toUpperCase() || '') || currencies.size > 1) fields.push('currency');
    if (fields.length) result.issues.push({ debtId: debt.id, name: debt.liability_name, fields });
    else debts.push({ id: debt.id, name: debt.liability_name, balance: balance!, minimum: minimum!, rate: rate! });
  }
  const extra = cents(extraMonthly);
  if (result.issues.length || extra === null || !Number.isInteger(maxMonths) || maxMonths < 1 || maxMonths > 1200) return result;
  result.initialBalanceCents = debts.reduce((sum, debt) => sum + debt.balance, 0);
  result.remainingCents = result.initialBalanceCents;
  result.monthlyBudgetCents = debts.reduce((sum, debt) => sum + debt.minimum, extra);
  if (!Number.isSafeInteger(result.initialBalanceCents) || !Number.isSafeInteger(result.monthlyBudgetCents)) {
    result.status = 'numeric_limit';
    return result;
  }
  if (result.remainingCents === 0) return { ...result, status: 'paid_off', months: 0 };

  for (let month = 1; month <= maxMonths; month += 1) {
    const openingBalances = debts.map((debt) => debt.balance);
    let interestTotal = 0;
    for (const debt of debts) {
      const interest = monthlyInterest(debt.balance, debt.rate);
      if (interest === null || !Number.isSafeInteger(debt.balance + interest)) return { ...result, status: 'numeric_limit' };
      debt.balance += interest;
      interestTotal += interest;
    }
    let paid = 0;
    for (const debt of debts) {
      const payment = Math.min(debt.minimum, debt.balance);
      debt.balance -= payment;
      paid += payment;
    }
    // A fixed total payment automatically releases paid-off minimums, including
    // unused payment from a debt's final month, into the chosen priority order.
    let available = rollOverPayments ? Math.max(0, result.monthlyBudgetCents - paid) : extra;
    const ordered = [...debts].filter((debt) => debt.balance > 0).sort((a, b) => (
      strategy === 'avalanche' ? b.rate - a.rate || a.balance - b.balance || a.id - b.id
        : a.balance - b.balance || b.rate - a.rate || a.id - b.id
    ));
    for (const debt of ordered) {
      const payment = Math.min(available, debt.balance);
      debt.balance -= payment;
      available -= payment;
      paid += payment;
      if (!available) break;
    }
    const remaining = debts.reduce((sum, debt) => sum + debt.balance, 0);
    if (![remaining, paid, interestTotal, result.totalInterestCents + interestTotal, result.totalPaidCents + paid].every(Number.isSafeInteger)) {
      return { ...result, status: 'numeric_limit' };
    }
    result.totalInterestCents += interestTotal;
    result.totalPaidCents += paid;
    result.remainingCents = remaining;
    result.schedule.push({
      month, paymentCents: paid, interestCents: interestTotal, remainingCents: remaining,
      paidOffNames: debts.filter((debt, index) => openingBalances[index] > 0 && debt.balance === 0).map((debt) => debt.name),
    });
    if (remaining === 0) return { ...result, status: 'paid_off', months: month };
    // If no remaining balance shrank, constant payments/rates cannot improve it
    // in future months. A growing debt alone does not trigger this while another
    // debt is shrinking and may later release its payment.
    if (debts.every((debt, index) => debt.balance >= openingBalances[index])) return { ...result, status: 'non_amortizing' };
  }
  return { ...result, status: 'horizon' };
}

/** Payments start next month; month-end dates avoid invalid February dates. */
export function debtPayoffMonth(months: number, startDate: Date = new Date()): Date {
  return new Date(startDate.getFullYear(), startDate.getMonth() + months + 1, 0, 12);
}
