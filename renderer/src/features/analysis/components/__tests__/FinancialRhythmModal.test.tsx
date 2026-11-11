import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '@renderer/i18n/locales/en.json';
import FinancialRhythmModal from '../FinancialRhythmModal';
import { clearRhythmComparisonCache } from '../rhythm/useRhythmComparison';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: { get, post }, invalidateApiCache: vi.fn() }));
vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({ formatCurrency: (value: number) => `₪${Math.round(Math.abs(value)).toLocaleString('en-US')}` }),
}));

const instance = i18n.createInstance();
beforeAll(async () => {
  await instance.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } } });
});

const monthPayload = {
  granularity: 'month', metric: 'spend', scope: 'all', asOf: '2026-11-11', coverageStart: '2026-05-03',
  pace: {
    x: 11, length: 30, current: 8147, median: 10248, low: 9401, high: 11881, status: 'below',
    deltaAmount: -2101, deltaPercent: -21, typicalTotal: 23779, projectedTotal: 21407,
  },
  points: Array.from({ length: 31 }, (_, index) => ({
    x: index + 1, current: index < 11 ? 700 * (index + 1) : null, previous: 600 * (index + 1),
    median: 900 * (index + 1), low: 800 * (index + 1), high: 1000 * (index + 1),
  })),
  drivers: [{ categoryId: 20, name: 'אלקטרוניקה', nameEn: 'Electronics', nameFr: null, current: 0, typical: 4031, delta: -4031 }],
  newMerchants: [],
  periods: [
    { key: '2026-10', start: '2026-10-01', end: '2026-10-31', isCurrent: false, total: 19536 },
    { key: '2026-11', start: '2026-11-01', end: '2026-11-30', isCurrent: true, total: 8147, projected: 21407 },
  ],
  checks: [{
    type: 'type_mismatch', count: 1,
    transactions: [{
      identifier: 'a', vendor: 'discount', date: '2026-11-10', name: 'בנק לאומי משכורת', amount: 7029,
      storedType: 'expense', categoryType: 'income', categoryName: 'משכורת', categoryNameEn: 'Salary', categoryNameFr: null,
    }],
  }],
};

function renderModal() {
  return render(
    <I18nextProvider i18n={instance}>
      <FinancialRhythmModal open onClose={() => undefined} />
    </I18nextProvider>,
  );
}

describe('FinancialRhythmModal', () => {
  beforeEach(() => {
    clearRhythmComparisonCache();
    get.mockReset();
    post.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url.includes('granularity=day')) {
        return { ok: true, data: { ...monthPayload, granularity: 'day', pace: { ...monthPayload.pace, x: 7, length: 7, status: 'within' }, days: [], unusualDays: 0, checks: [] } };
      }
      return { ok: true, data: monthPayload };
    });
  });

  it('opens on the month comparison with the pace, its drivers and data checks', async () => {
    renderModal();

    expect(await screen.findByText('Day 11 of 30')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/api/analytics/rhythm-comparison?granularity=month&metric=spend&scope=all');
    expect(screen.getByText('21% below usual (₪2,101)')).toBeTruthy();
    expect(screen.getByText('On pace for ₪21,407 this month · a usual month is ₪23,779')).toBeTruthy();
    expect(screen.getByText('Electronics')).toBeTruthy();
    expect(screen.getByText('1 transaction is stored as an expense but filed under an income or investment category')).toBeTruthy();
  });

  it('repairs mis-typed transactions and reloads', async () => {
    post.mockResolvedValue({ ok: true, data: { repaired: 1 } });
    renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'Fix now' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/analytics/rhythm-comparison/repair-types', {}));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('switches to income without the everyday filter, and to the day view', async () => {
    renderModal();
    await screen.findByText('Day 11 of 30');

    fireEvent.click(screen.getByRole('button', { name: 'Income' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/analytics/rhythm-comparison?granularity=month&metric=income&scope=all'));
    expect(screen.queryByRole('button', { name: 'Everyday' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
    expect(await screen.findByText('Last 7 days')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/api/analytics/rhythm-comparison?granularity=day&metric=income&scope=all');
  });
});
