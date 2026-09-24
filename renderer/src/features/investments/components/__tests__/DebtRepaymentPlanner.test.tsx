import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestmentLiability } from '@renderer/types/investments';
import en from '../../locales/debt-planning-en.json';
import he from '../../locales/debt-planning-he.json';
import fr from '../../locales/debt-planning-fr.json';
import DebtRepaymentPlanner from '../DebtRepaymentPlanner';

const privacy = vi.hoisted(() => ({ maskAmounts: false }));
vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    maskAmounts: privacy.maskAmounts,
    formatCurrency: (value: number, options: { currencySymbol: string }) => `${options.currencySymbol}${value.toFixed(2)}`,
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, values: Record<string, unknown> = {}) => {
      const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
      return String(value ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ''));
    },
  }),
}));

function debt(overrides: Partial<InvestmentLiability> = {}): InvestmentLiability {
  return {
    id: 1, liability_name: 'Loan', liability_type: 'loan', balance: 1000, currency: 'ILS',
    interest_rate: 12, monthly_payment: 100, as_of_date: '2026-09-08',
    included_in_net_worth: true, is_active: true, ...overrides,
  };
}

function keys(resource: object, prefix = ''): string[] {
  return Object.entries(resource).flatMap(([key, value]) => typeof value === 'object'
    ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`]).sort();
}

describe('DebtRepaymentPlanner', () => {
  beforeEach(() => { privacy.maskAmounts = false; });

  it('shows earlier payoff and less interest after adding an extra monthly payment', () => {
    render(<DebtRepaymentPlanner liabilities={[debt()]} />);
    fireEvent.change(screen.getByLabelText('Extra per month (ILS)'), { target: { value: '50' } });
    expect(screen.getByText('Monthly payment budget: ₪150.00')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: en.comparison });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getByText('11')).toBeInTheDocument();
    expect(within(rows[2]).getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/4 months earlier/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.showSchedule }));
    expect(within(screen.getByRole('table', { name: en.schedule })).getAllByRole('row')).toHaveLength(8);
  });

  it('isolates currencies and retains each currency’s extra payment when switching', () => {
    render(<DebtRepaymentPlanner liabilities={[debt(), debt({ id: 2, balance: 200, currency: 'USD' })]} />);
    expect(screen.getByText(en.separateCurrencies)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Extra per month (ILS)'), { target: { value: '50' } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: en.currency }));
    fireEvent.click(screen.getByRole('option', { name: 'USD' }));
    expect(screen.getByText('Starting balance: USD 200.00')).toBeInTheDocument();
    expect(screen.getByLabelText('Extra per month (USD)')).toHaveValue(0);
    fireEvent.change(screen.getByLabelText('Extra per month (USD)'), { target: { value: '25' } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: en.currency }));
    fireEvent.click(screen.getByRole('option', { name: 'ILS' }));
    expect(screen.getByLabelText('Extra per month (ILS)')).toHaveValue(50);
    expect(screen.getByText('Starting balance: ₪1000.00')).toBeInTheDocument();
  });

  it('identifies missing debt terms and does not show misleading payoff estimates', () => {
    render(<DebtRepaymentPlanner liabilities={[debt({ interest_rate: null, monthly_payment: null })]} />);
    expect(screen.getByText(/Loan: monthly payment, annual interest rate/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: en.comparison })).not.toBeInTheDocument();
  });

  it('keeps debts with missing currencies visible for correction', () => {
    render(<DebtRepaymentPlanner liabilities={[debt({ currency: null as unknown as string })]} />);
    expect(screen.getByText(/Loan: valid currency/)).toBeInTheDocument();
    expect(screen.queryByText(en.empty)).not.toBeInTheDocument();
  });

  it('explains non-amortizing payments and withholds interest savings against an invalid baseline', () => {
    render(<DebtRepaymentPlanner liabilities={[debt({ monthly_payment: 5 })]} />);
    expect(screen.getByText(en.status.non_amortizing)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Extra per month (ILS)'), { target: { value: '95' } });
    expect(screen.queryByText(en.status.non_amortizing)).not.toBeInTheDocument();
    expect(screen.queryByText(/less interest/)).not.toBeInTheDocument();
    expect(screen.getByText(en.shortStatus.non_amortizing)).toBeInTheDocument();
  });

  it('rejects negative extra payments without preserving an outdated result', () => {
    render(<DebtRepaymentPlanner liabilities={[debt()]} />);
    fireEvent.change(screen.getByLabelText('Extra per month (ILS)'), { target: { value: '-1' } });
    expect(screen.getByText(en.invalidExtra)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: en.comparison })).not.toBeInTheDocument();
  });

  it('masks both calculated amounts and the extra-payment input', () => {
    privacy.maskAmounts = true;
    render(<DebtRepaymentPlanner liabilities={[debt()]} />);
    const input = screen.getByLabelText('Extra per month (ILS)');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: '50' } });
    expect(screen.getByText('Starting balance: ***')).toBeInTheDocument();
    expect(screen.queryByText(/₪/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.showSchedule }));
    expect(within(screen.getByRole('table', { name: en.schedule })).getAllByText('***').length).toBeGreaterThan(0);
  });

  it('has distinct unavailable, empty and refresh-error states', () => {
    const { rerender } = render(<DebtRepaymentPlanner />);
    expect(screen.getByText(en.unavailable)).toBeInTheDocument();
    rerender(<DebtRepaymentPlanner liabilities={[]} />);
    expect(screen.getByText(en.empty)).toBeInTheDocument();
    rerender(<DebtRepaymentPlanner liabilities={[debt()]} error="Offline" />);
    expect(screen.getByText(en.loadError)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('paginates a long monthly schedule', () => {
    render(<DebtRepaymentPlanner liabilities={[debt({ balance: 1500, interest_rate: 0, monthly_payment: 100 })]} />);
    fireEvent.click(screen.getByRole('button', { name: en.showSchedule }));
    expect(within(screen.getByRole('table', { name: en.schedule })).getAllByRole('row')).toHaveLength(13);
    fireEvent.click(screen.getByRole('button', { name: en.paginationActions.next }));
    expect(within(screen.getByRole('table', { name: en.schedule })).getAllByRole('row')).toHaveLength(4);
    expect(screen.getByText('13–15 of 15 months')).toBeInTheDocument();
  });

  it('provides every planner translation in Hebrew, English and French', () => {
    expect(keys(he)).toEqual(keys(en));
    expect(keys(fr)).toEqual(keys(en));
  });
});
