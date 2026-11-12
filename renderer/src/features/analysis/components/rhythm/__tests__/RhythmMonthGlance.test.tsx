import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '@renderer/i18n/locales/en.json';
import RhythmMonthGlance from '../RhythmMonthGlance';
import { clearRhythmComparisonCache } from '../useRhythmComparison';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: { get } }));
vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({ formatCurrency: (value: number) => `₪${Math.round(Math.abs(value)).toLocaleString('en-US')}` }),
}));

const instance = i18n.createInstance();
beforeAll(async () => {
  await instance.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } } });
});

function renderGlance() {
  return render(
    <I18nextProvider i18n={instance}>
      <RhythmMonthGlance />
    </I18nextProvider>,
  );
}

describe('RhythmMonthGlance', () => {
  beforeEach(() => {
    clearRhythmComparisonCache();
    get.mockReset();
  });

  it('shows spending so far this month against the usual pace', async () => {
    get.mockResolvedValue({
      ok: true,
      data: {
        granularity: 'month', metric: 'spend', scope: 'all', asOf: '2026-11-11',
        pace: {
          x: 11, length: 30, current: 8147, median: 10248, low: 9401, high: 11881, status: 'below',
          deltaAmount: -2101, deltaPercent: -21, typicalTotal: 23779, projectedTotal: 21407,
        },
        points: [{ x: 1, current: 500, previous: 400, median: 600, low: 550, high: 700 }],
      },
    });
    renderGlance();

    expect(await screen.findByText('₪8,147')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/api/analytics/rhythm-comparison?granularity=month&metric=spend&scope=all');
    expect(screen.getByText('Spending through the month · Day 11 of 30')).toBeTruthy();
    expect(screen.getByText('21% below usual (₪2,101)')).toBeTruthy();
    expect(screen.queryByText(/On pace for/)).toBeNull();
  });

  it('says so when the comparison cannot load', async () => {
    get.mockResolvedValue({ ok: false });
    renderGlance();

    expect(await screen.findByText("Couldn't load the comparison.")).toBeTruthy();
  });
});
