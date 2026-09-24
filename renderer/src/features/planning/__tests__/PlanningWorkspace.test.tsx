import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FinancePrivacyProvider } from '@app/contexts/FinancePrivacyContext';
import { FINANCIAL_TRUTH_CHANGED_EVENT } from '@renderer/features/financial-truth/types';
import PlanningWorkspace from '../components/PlanningWorkspace';
import { PLANNING_CHANGED_EVENT } from '../types';
import labels from '../locales/en.json';
import spendLabels from '../locales/spendability-en.json';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: { get } }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get } }));
vi.mock('react-i18next', () => ({
  useTranslation: (_namespace: string, options: { keyPrefix: string }) => ({
    i18n: { language: 'en' },
    t: (key: string, values: Record<string, unknown> = {}) => {
      const source = options.keyPrefix === 'planning.spendability' ? spendLabels : labels;
      const translation = key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)?.[part], source);
      let value = String(translation || values.defaultValue || key);
      for (const [name, replacement] of Object.entries(values)) value = value.replaceAll(`{{${name}}}`, String(replacement));
      return value;
    },
  }),
}));

const planning = {
  settings: { cash_buffer: 500, next_income_date: null, card_commitments_amount: null },
  goals: [], scenarios: [],
};
const projection = {
  status: 'ready', available_spend: 1234, shortfall: 0, cash_balance: 2534,
  cash_buffer: 500, reserved_cash: 200, planned_contributions: 100,
  card_commitments: 200, latest_balance_date: '2026-09-14',
  next_income_date: '2026-09-30', forecast_expenses_until_income: 300, reasons: [],
  next_income_source: 'detected', card_commitments_source: 'imported',
};
const response = (path: string) => ({ ok: true, data: path.endsWith('/projection') ? projection : planning });
const reads = (path: string) => get.mock.calls.filter(([endpoint]) => endpoint === path).length;
const expectReads = (count: number) => {
  expect(reads('/api/planning')).toBe(count);
  expect(reads('/api/planning/projection')).toBe(count);
};

async function show() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<StrictMode><MemoryRouter><FinancePrivacyProvider locale="en"><PlanningWorkspace /></FinancePrivacyProvider></MemoryRouter></StrictMode>);
  });
  return view;
}

describe('shared planning reads', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 14, 12));
    localStorage.clear();
    get.mockReset();
    get.mockImplementation(async (path: string) => response(path));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads all three panels with one planning read, including StrictMode mount replay', async () => {
    await show();
    expect(screen.getByText('₪1,234')).toBeVisible();
    expect(screen.getByText(labels.goals.emptyTitle)).toBeVisible();
    expect(screen.getByText(labels.scenarios.emptyTitle)).toBeVisible();
    expectReads(1);
  });

  it('coalesces visibility and focus refreshes and skips them while hidden', async () => {
    await show();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(100);
    });
    expectReads(1);
    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(10);
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(100);
    });
    expectReads(2);
  });

  it.each([PLANNING_CHANGED_EVENT, FINANCIAL_TRUTH_CHANGED_EVENT, 'dataRefresh'])(
    'shares one read when %s invalidates the plan', async (event) => {
      await show();
      get.mockImplementation(async (path: string) => path.endsWith('/projection')
        ? { ok: true, data: { ...projection, available_spend: 934 } } : response(path));
      await act(async () => { window.dispatchEvent(new Event(event)); });
      expect(screen.getByText('₪934')).toBeVisible();
      expectReads(2);
    },
  );

  it('queues a fresh read after each in-flight mutation and never displays the obsolete estimate', async () => {
    await show();
    const pending = new Map<string, (value: unknown) => void>();
    get.mockImplementation((path: string) => new Promise((resolve) => { pending.set(path, resolve); }));
    act(() => { window.dispatchEvent(new Event('dataRefresh')); });
    expectReads(2);
    expect(screen.queryByText('₪1,234')).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event(PLANNING_CHANGED_EVENT));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    expectReads(2);
    const finishRead = async (amount: number) => {
      await act(async () => {
        pending.get('/api/planning')!({ ok: true, data: planning });
        pending.get('/api/planning/projection')!({ ok: true, data: { ...projection, available_spend: amount } });
      });
    };
    await finishRead(9999);
    expectReads(3);
    expect(screen.queryByText('₪9,999')).not.toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event(PLANNING_CHANGED_EVENT)); });
    await finishRead(8888);
    expectReads(4);
    expect(screen.queryByText('₪8,888')).not.toBeInTheDocument();
    await finishRead(934);
    expect(screen.getByText('₪934')).toBeVisible();
    expectReads(4);
  });

  it('refreshes once at the next local day', async () => {
    vi.setSystemTime(new Date(2026, 8, 14, 23, 59, 59));
    await show();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expectReads(2);
  });

  it('keeps goals and scenarios available if the projection fails and retries the card', async () => {
    get.mockImplementation(async (path: string) => path.endsWith('/projection') ? { ok: false } : response(path));
    await show();
    expect(screen.getByText(spendLabels.loadError)).toBeVisible();
    expect(screen.getByText(labels.goals.emptyTitle)).toBeVisible();
    expect(screen.getByText(labels.scenarios.emptyTitle)).toBeVisible();
    get.mockImplementation(async (path: string) => response(path));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: spendLabels.retry })); });
    expect(screen.getByText('₪1,234')).toBeVisible();
    expectReads(2);
  });

  it('removes refresh listeners and timers when the workspace unmounts', async () => {
    const view = await show();
    view.unmount();
    await act(async () => {
      window.dispatchEvent(new Event(PLANNING_CHANGED_EVENT));
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    });
    expectReads(1);
  });
});
