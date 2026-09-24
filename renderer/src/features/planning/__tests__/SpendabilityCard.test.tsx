import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FinancePrivacyProvider } from '@app/contexts/FinancePrivacyContext';
import SpendabilityCard from '../components/SpendabilityCard';
import labels from '../locales/spendability-en.json';

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: { get, put } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, values: Record<string, unknown> = {}) => {
      let value = String((labels as Record<string, unknown>)[key] || values.defaultValue || key);
      for (const [name, replacement] of Object.entries(values)) value = value.replaceAll(`{{${name}}}`, String(replacement));
      return value;
    },
  }),
}));

const future = new Date();
future.setDate(future.getDate() + 20);
const nextIncome = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
const settings = { cash_buffer: 500, next_income_date: null, card_commitments_amount: null };
const projection = {
  status: 'ready', available_spend: 1234, shortfall: 0, cash_balance: 2534,
  cash_buffer: 500, reserved_cash: 200, planned_contributions: 100,
  card_commitments: 200, card_confirmation_required: false, latest_balance_date: '2026-09-08',
  next_income_date: nextIncome, forecast_expenses_until_income: 300, reasons: [],
  next_income_source: 'detected', card_commitments_source: 'imported', spending_period_end: nextIncome,
};

function show(compact = false) {
  return render(<MemoryRouter><FinancePrivacyProvider locale="en"><SpendabilityCard compact={compact} /></FinancePrivacyProvider></MemoryRouter>);
}

describe('spending estimate', () => {
  beforeEach(() => {
    localStorage.clear();
    get.mockReset();
    put.mockReset();
    get.mockImplementation(async (path: string) => ({ ok: true, data: path.endsWith('/projection') ? projection : { settings, goals: [], scenarios: [] } }));
    put.mockResolvedValue({ ok: true });
  });
  afterEach(cleanup);

  it('loads the standalone compact card without a planning workspace', async () => {
    show(true);
    await screen.findByText('₪1,234');
    expect(screen.queryByLabelText(labels.purchase)).not.toBeInTheDocument();
    expect(get.mock.calls.filter(([path]) => path === '/api/planning')).toHaveLength(1);
    expect(get.mock.calls.filter(([path]) => path === '/api/planning/projection')).toHaveLength(1);
  });

  it('checks an additional purchase against the amount remaining after commitments', async () => {
    show();
    await screen.findByText('₪1,234');
    fireEvent.change(screen.getByLabelText(labels.purchase), { target: { value: '1300' } });
    expect(screen.getByText('This exceeds your available amount by ₪66.')).toBeVisible();
    fireEvent.change(screen.getByLabelText(labels.purchase), { target: { value: '1000' } });
    expect(screen.getByText('This fits the current estimate, leaving ₪234 unallocated.')).toBeVisible();
  });

  it('hides a previous positive amount while refreshing and after source failure', async () => {
    show();
    await screen.findByText('₪1,234');
    let rejectRefresh: (error: Error) => void = () => undefined;
    get.mockImplementation((path: string) => path.endsWith('/projection')
      ? new Promise((_resolve, reject) => { rejectRefresh = reject; })
      : Promise.resolve({ ok: true, data: { settings, goals: [], scenarios: [] } }));
    act(() => window.dispatchEvent(new Event('dataRefresh')));
    expect(screen.queryByText('₪1,234')).not.toBeInTheDocument();
    await act(async () => rejectRefresh(new Error('offline')));
    expect(screen.getByText(labels.loadError)).toBeVisible();
    expect(screen.queryByText('₪1,234')).not.toBeInTheDocument();
  });

  it('never shows an incomplete estimate as zero or an available amount', async () => {
    get.mockImplementation(async (path: string) => ({ ok: true, data: path.endsWith('/projection')
      ? { ...projection, status: 'incomplete', available_spend: null, reasons: [{ code: 'missing_cash', message: 'Sync a bank account.' }] }
      : { settings, goals: [], scenarios: [] } }));
    show();
    await screen.findByText(labels.incomplete);
    expect(screen.getByText('Sync a bank account.')).toBeVisible();
    expect(screen.queryByText('₪0')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(labels.purchase)).not.toBeInTheDocument();
  });

  it('works without setup and preserves automatic inputs when only the buffer changes', async () => {
    show();
    await screen.findByText('₪1,234');
    fireEvent.click(screen.getByRole('button', { name: labels.settings }));
    expect(screen.queryByLabelText(labels.nextIncome)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(labels.commitments)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(labels.buffer), { target: { value: '700' } });
    fireEvent.click(screen.getByRole('button', { name: labels.save, exact: true }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/planning/settings', {
      cash_buffer: 700, next_income_date: null, card_commitments_amount: null,
    }));
  });

  it('offers explicit overrides and lets the user return to automatic calculation', async () => {
    show();
    await screen.findByText('₪1,234');
    fireEvent.click(screen.getByRole('button', { name: labels.settings }));
    fireEvent.click(screen.getByLabelText(labels.overrideIncome));
    expect(screen.getByLabelText(labels.nextIncome)).toHaveValue(nextIncome);
    fireEvent.click(screen.getByLabelText(labels.overrideCards));
    fireEvent.change(screen.getByRole('spinbutton', { name: /Outstanding card commitments/ }), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: labels.save, exact: true }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/planning/settings', {
      cash_buffer: 500, next_income_date: nextIncome, card_commitments_amount: 0,
    }));
    get.mockImplementation(async (path: string) => ({ ok: true, data: path.endsWith('/projection')
      ? { ...projection, next_income_source: 'manual', card_commitments_source: 'manual' } : { settings, goals: [], scenarios: [] } }));
    act(() => window.dispatchEvent(new Event('dataRefresh')));
    await screen.findByText(labels.manualIncome, { exact: false });
    fireEvent.click(await screen.findByRole('button', { name: labels.settings }));
    fireEvent.click(screen.getByLabelText(labels.overrideIncome));
    fireEvent.click(screen.getByLabelText(labels.overrideCards));
    fireEvent.click(screen.getByRole('button', { name: labels.save, exact: true }));
    await waitFor(() => expect(put).toHaveBeenLastCalledWith('/api/planning/settings', {
      cash_buffer: 500, next_income_date: null, card_commitments_amount: null,
    }));
  });

  it('labels the rolling period when income is irregular, without requiring a payday', async () => {
    get.mockImplementation(async (path: string) => ({ ok: true, data: path.endsWith('/projection')
      ? { ...projection, next_income_date: null, next_income_source: null, card_commitments_source: 'estimated' } : { settings, goals: [], scenarios: [] } }));
    show();
    await screen.findByText('₪1,234');
    expect(screen.getByText(labels.rollingHelp, { exact: false })).toBeVisible();
    expect(screen.getByText(labels.estimatedCards, { exact: false })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: labels.settings }));
    expect(screen.getByRole('button', { name: labels.save, exact: true })).toBeEnabled();
  });

  it('respects amount masking in the estimate and purchase result', async () => {
    localStorage.setItem('finance-mask-amounts', 'true');
    show();
    await screen.findAllByText('₪****');
    expect(screen.queryByText('₪1,234')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(labels.purchase), { target: { value: '1000' } });
    expect(screen.getByText('This fits the current estimate, leaving ₪*** unallocated.')).toBeVisible();
  });
});
