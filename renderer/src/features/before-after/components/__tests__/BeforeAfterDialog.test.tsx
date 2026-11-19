import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '@renderer/i18n/locales/en.json';
import BeforeAfterDialog from '../BeforeAfterDialog';
import { overridesFor } from '../../hooks/useBeforeAfter';
import type { BeforeAfterCategory, BeforeAfterResponse } from '../../types';

const { get, put, mask } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), mask: { value: false } }));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: { get, put }, invalidateApiCache: vi.fn() }));
vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    maskAmounts: mask.value,
    formatCurrency: (value: number, options: { showSign?: boolean } = {}) => {
      if (mask.value) return '₪***';
      const sign = options.showSign && value > 0 ? '+' : value < 0 ? '-' : '';
      return `${sign}₪${Math.round(Math.abs(value)).toLocaleString('en-US')}`;
    },
  }),
}));
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

const instance = i18n.createInstance();
beforeAll(async () => {
  await instance.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } } });
});

function category(overrides: Partial<BeforeAfterCategory>): BeforeAfterCategory {
  return {
    key: '10', categoryId: 10, name: 'מסעדות', nameEn: 'Restaurants', nameFr: null,
    defaultReason: null, defaultNeeded: false, needed: false, overridden: false,
    beforeMonthly: 2100, afterMonthly: 1500, ...overrides,
  };
}

const ready: BeforeAfterResponse = {
  status: 'ready',
  frontier: { day: '2026-05-10', source: 'sync' },
  coverageStart: '2026-02-01',
  windows: {
    status: 'ready', months: 3, frontierMonth: '2026-05', readyOn: null, fullMonthsAfter: 5, fullMonthsBefore: 3,
    before: { months: ['2026-02', '2026-03', '2026-04'], start: '2026-02-01', end: '2026-04-30' },
    after: { months: ['2026-08', '2026-09', '2026-10'], start: '2026-08-01', end: '2026-10-31' },
    historyStart: '2026-02-01',
  },
  metrics: {
    controllableSpend: {
      before: 2100, after: 1500, delta: -600, deltaPercent: -29, verdict: 'better', shareBefore: 21, shareAfter: 15,
      largeOneOffs: {
        threshold: 1000, beforeTotal: 0, afterTotal: 5000, beforeCount: 0, afterCount: 1,
        items: [{ day: '2026-08-21', phase: 'after', name: 'Sofa Store', amount: 5000, categoryId: 10, categoryName: 'רהיטים', categoryNameEn: 'Furniture', categoryNameFr: null }],
      },
    },
    kept: { before: 4000, after: 3500, delta: -500, deltaPercent: -13, verdict: 'worse', rateBefore: 40, rateAfter: 35 },
    fees: { before: 45, after: 44, delta: -1, deltaPercent: -2, verdict: 'unchanged' },
    subscriptions: {
      stopped: [{ name: 'StreamCo', monthlyAmount: 60, yearlyAmount: 720, lastCharge: '2026-04-07' }],
      started: [],
      stoppedYearly: 720, startedYearly: 0, netYearly: 720, verdict: 'better',
    },
    income: { before: 10000, after: 12000, delta: 2000, deltaPercent: 20 },
  },
  categories: [
    category({}),
    category({ key: '20', categoryId: 20, name: 'שכירות', nameEn: 'Rent', defaultReason: 'essential', defaultNeeded: true, needed: true, beforeMonthly: 4000, afterMonthly: 4000 }),
  ],
  monthly: ['2026-02', '2026-03', '2026-04', '2026-08', '2026-09', '2026-10'].map((month, index) => ({
    month, phase: index < 3 ? 'before' : 'after', income: 10000, spend: 6000, controllableSpend: 2000, largeOneOffs: 0, neededSpend: 4000,
    invested: 0, fees: 45, kept: 4000, keptRate: 40, controllableShare: 20,
  })),
};

function renderDialog() {
  return render(
    <I18nextProvider i18n={instance}>
      <BeforeAfterDialog open onClose={() => undefined} />
    </I18nextProvider>,
  );
}

describe('BeforeAfterDialog', () => {
  beforeEach(() => {
    mask.value = false;
    get.mockReset();
    put.mockReset();
  });

  it('shows improvements and regressions side by side, with the income context', async () => {
    get.mockResolvedValue({ ok: true, data: ready });
    renderDialog();

    expect(await screen.findByText('Spending you control')).toBeTruthy();
    expect(screen.getByText('₪2,100')).toBeTruthy();
    expect(screen.getByText('₪1,500')).toBeTruthy();
    expect(screen.getByText('21% → 15% of income · Large payments left out: 0 before, 1 after')).toBeTruthy();
    expect(screen.getByText('Sofa Store')).toBeTruthy();
    expect(screen.getByText('₪5,000')).toBeTruthy();
    expect(screen.getAllByText('Better')).toHaveLength(2);
    expect(screen.getByText('Worse')).toBeTruthy();
    expect(screen.getByText('No clear change')).toBeTruthy();
    expect(screen.getByText('StreamCo')).toBeTruthy();
    expect(screen.getByText('₪720 / year')).toBeTruthy();
    expect(screen.getByText(/Your income also changed/)).toBeTruthy();
    expect(screen.getByText(/not proof that ShekelSync caused it/)).toBeTruthy();
  });

  it('hides every amount when amounts are masked', async () => {
    mask.value = true;
    get.mockResolvedValue({ ok: true, data: ready });
    renderDialog();
    await screen.findByText('Spending you control');
    expect(screen.queryByText('₪2,100')).toBeNull();
    expect(screen.queryByText(/720/)).toBeNull();
  });

  it('saves a needed-category change and reloads the comparison', async () => {
    get.mockResolvedValue({ ok: true, data: ready });
    put.mockResolvedValue({ ok: true, data: { overrides: { 10: true } } });
    renderDialog();

    fireEvent.click(await screen.findByText('What counts as needed'));
    fireEvent.click(await screen.findByLabelText('Restaurants'));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/analytics/before-after/category-overrides', { overrides: { 10: true } }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('explains when the comparison will be ready', async () => {
    get.mockResolvedValue({
      ok: true,
      data: {
        status: 'waiting', frontier: { day: '2026-10-05', source: 'sync' }, metrics: null, categories: [], monthly: [],
        windows: { status: 'waiting', months: 0, frontierMonth: '2026-10', readyOn: '2027-01-01', fullMonthsAfter: 0, fullMonthsBefore: 3, historyStart: null, before: null, after: null },
      },
    });
    renderDialog();
    expect(await screen.findByText('Your comparison is on its way')).toBeTruthy();
    expect(screen.getByText('0 of 2 full months')).toBeTruthy();
  });
});

describe('overridesFor', () => {
  it('keeps only categories that differ from their default', () => {
    const categories = [
      category({}),
      category({ key: '20', defaultNeeded: true, needed: false, overridden: true }),
    ];
    expect(overridesFor(categories, '10', true)).toEqual({ 10: true, 20: false });
    expect(overridesFor(categories, '20', true)).toEqual({});
  });
});
