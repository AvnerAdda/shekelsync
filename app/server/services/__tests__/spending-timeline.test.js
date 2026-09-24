import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
const { buildTimeline, timelinePeriod } = require('../analytics/spending-timeline.js');
const electronBinary = require('electron');
const row = (date, amount, spending_category = 'essential', kind = 'expense') => ({ date, amount, spending_category, kind, transaction_count: 1 });

describe('daily rolling spending allocation', () => {
  it('includes exactly N days, including warm-up history, and removes outgoing transactions', () => {
    const period = timelinePeriod({ rollingDays: 3, startDate: '2026-09-03', endDate: '2026-09-05' }, '2026-09-05');
    const points = buildTimeline([
      row('2026-09-01', 1000, null, 'income'), row('2026-09-01', -100),
      row('2026-09-02', -200), row('2026-09-03', -300), row('2026-09-04', 2000, null, 'income'),
    ], period);
    expect(points.map((point) => point.income)).toEqual([1000, 2000, 2000]);
    expect(points.map((point) => point.expenses)).toEqual([600, 500, 300]);
    expect(points[0].window_start).toBe('2026-09-01');
    expect(points[0].percentages.essential).toBe(60);
    expect(points[0].percentages.growth).toBe(40);
    expect(points[1].percentages.growth).toBe(75);
  });

  it('adds only the income surplus to Growth and preserves overspending beyond 100%', () => {
    const period = timelinePeriod({ rollingDays: 1, startDate: '2026-09-01', endDate: '2026-09-02' }, '2026-09-02');
    const points = buildTimeline([
      row('2026-09-01', 100, null, 'income'), row('2026-09-01', -30), row('2026-09-01', -20, 'growth'), row('2026-09-01', -10, 'unallocated'),
      row('2026-09-02', 100, null, 'income'), row('2026-09-02', -120), row('2026-09-02', -10, 'growth'),
    ], period);
    expect(points[0].percentages).toEqual({ essential: 30, growth: 60, stability: 0, reward: 0, unallocated: 10 });
    expect(points[0].surplus).toBe(40);
    expect(points[1].surplus).toBe(0);
    expect(points[1].deficit).toBe(30);
    expect(points[1].percentages.essential).toBe(120);
    expect(points[1].percentages.growth).toBe(10);
  });

  it('nets refunds in their category, handles missing income and preserves cents', () => {
    const period = timelinePeriod({ rollingDays: 1, startDate: '2026-09-01', endDate: '2026-09-03' }, '2026-09-03');
    const points = buildTimeline([row('2026-09-01', -10.1), row('2026-09-01', 0.2), row('2026-09-02', 2)], period);
    expect(points[0].expenses).toBe(9.9);
    expect(points[0].has_income).toBe(false);
    expect(Object.values(points[0].percentages).every((value) => value === null)).toBe(true);
    expect(points[1].expense_amounts.essential).toBe(-2);
    expect(points[2].expenses).toBe(0);
  });

  it('validates dates, leap days and bounded range sizes', () => {
    expect(timelinePeriod({ rollingDays: 30, startDate: '2024-03-01', endDate: '2024-03-01' }).history_start).toBe('2024-02-01');
    for (const params of [{ endDate: 'bad' }, { rollingDays: '30junk' }, { rollingDays: 0 }, { historyDays: 10000 },
      { startDate: '2026-09-11', endDate: '2026-09-10' }, { endDate: '2026-02-30' }]) {
      expect(() => timelinePeriod(params, '2026-09-10')).toThrow();
    }
  });

  it.each([30, 60, 90])('reconciles every %i-day window against independent transaction sums', (rollingDays) => {
    const day = (offset) => new Date(Date.UTC(2023, 10, 1 + offset)).toISOString().slice(0, 10);
    const categories = ['essential', 'growth', 'stability', 'reward', 'unallocated'];
    const rows = [];
    for (let i = 0; i < 455; i++) {
      if (i % 30 === 0 && i < 240) rows.push(row(day(i), 1700.13 + i, null, 'income'));
      if (i === 390) rows.push(row(day(i), -25.19, null, 'income'));
      for (let j = 0; j < categories.length; j++) {
        rows.push(row(day(i), ((i + j) % 11 === 0 ? 1 : -1) * (321 + (i * 17 + j * 31) % 3000) / 100, categories[j]));
      }
    }
    const period = timelinePeriod({ rollingDays, startDate: day(89), endDate: day(454) }, day(454));
    const points = buildTimeline(rows, period);
    expect(points).toHaveLength(366);
    expect(points.some((point) => point.date === '2024-02-29')).toBe(true);
    expect(points.some((point) => point.income < 0)).toBe(true);
    expect(points.some((point) => point.income === 0)).toBe(true);
    for (const point of points) {
      const included = rows.filter((entry) => entry.date >= point.window_start && entry.date <= point.date);
      const income = included.filter((entry) => entry.kind === 'income').reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0);
      let expenseTotal = 0;
      for (const category of categories) {
        const expenses = included.filter((entry) => entry.kind === 'expense' && entry.spending_category === category);
        const cents = expenses.reduce((sum, entry) => sum - Math.round(entry.amount * 100), 0);
        expenseTotal += cents;
        expect(point.expense_amounts[category]).toBe(cents / 100);
        expect(point.transaction_counts[category]).toBe(expenses.length);
      }
      const surplus = Math.max(0, income - expenseTotal);
      expect(point.income).toBe(income / 100);
      expect(point.expenses).toBe(expenseTotal / 100);
      expect(point.net).toBe((income - expenseTotal) / 100);
      expect(point.surplus).toBe(surplus / 100);
      expect(point.deficit).toBe(Math.max(0, expenseTotal - income) / 100);
      expect(point.allocation_amounts.growth).toBeCloseTo(point.expense_amounts.growth + surplus / 100, 10);
      expect(Object.values(point.allocation_amounts).reduce((sum, value) => sum + value, 0)).toBeCloseTo((expenseTotal + surplus) / 100, 10);
      if (income > 0) {
        for (const category of categories) expect(point.percentages[category]).toBeCloseTo(point.allocation_amounts[category] * 10000 / income, 10);
        expect(Object.values(point.percentages).reduce((sum, value) => sum + value, 0)).toBeCloseTo(Math.max(100, expenseTotal / income * 100), 10);
      } else expect(Object.values(point.percentages)).toEqual(categories.map(() => null));
    }
  });

  it('queries real SQLite and serves matching daily totals, targets and drilldowns', () => {
    const result = spawnSync(electronBinary, [path.join(__dirname, 'spending-timeline.runner.cjs')], {
      cwd: path.resolve(__dirname, '../../../..'), encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'test' }, timeout: 30000,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('spending-timeline:ok');
  });
});
