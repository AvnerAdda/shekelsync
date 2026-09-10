import { describe, expect, it, vi, afterEach } from 'vitest';
const { buildIncomeSchedule, applyIncomeSchedule } = require('../income-schedule.js');
const { prepareProjectionPolicy } = require('../projection-policy.js');
const engine = require('../../forecast.js')._internal;

const tx = (date: string, amount = 1000, extra: any = {}) => ({ date, price: amount,
  name: 'Payroll', vendor: 'bank', category_type: 'income', category_definition_id: 1,
  category_name: 'Salary', category_name_en: 'Salary', is_counted_as_income: 1, ...extra });
const dates = (start: string, count: number) => Array.from({ length: count }, (_, i) => {
  const d = new Date(`${start}T12:00:00`); d.setDate(d.getDate() + i); return engine.formatDate(d);
});
const build = (rows: any[], start = '2026-04-01', count = 30, snapshot: any = {}, options: any = {}) => {
  const now = new Date(`${start}T12:00:00`); now.setDate(now.getDate() - 1);
  return buildIncomeSchedule(rows, dates(start, count), now, engine, snapshot, options);
};
const total = (schedule: Map<any, any>) => [...schedule.values()].reduce((sum, model) => sum + [...model.daily.values()].reduce((s: number, v: any) => s + v, 0), 0);
const monthly = ['2026-01-07', '2026-02-07', '2026-03-07'].map(d => tx(d));
afterEach(() => vi.restoreAllMocks());

describe('income schedules across payment patterns', () => {
  it('learns cadence separately from changing amounts and resists one bonus', () => {
    const rows = [tx('2026-01-07', 1000), tx('2026-02-07', 1100), tx('2026-03-07', 10000)];
    const model = build(rows).get('category:1');
    expect(model.daily.get('2026-04-07')).toBe(1100);
    expect(total(build(rows))).toBe(1100);
  });
  it('uses recent payments after a sustained pay change', () => {
    const rows = [...monthly, tx('2026-04-07', 1400), tx('2026-05-07', 1400)];
    expect(total(build(rows, '2026-06-01'))).toBe(1400);
  });
  it('does not invent a recurring stream from one or two deposits', () => {
    expect(build(monthly.slice(0, 1)).size).toBe(0);
    expect(build(monthly.slice(0, 2)).size).toBe(0);
    expect(build([]).size).toBe(0);
  });
  it('keeps multiple sources and multiple banks separate', () => {
    const rows = [...monthly, ...monthly.map(t => ({ ...t, price: 300, name: 'Second job' })),
      ...monthly.map(t => ({ ...t, price: 200, vendor: 'second-bank' }))];
    expect(total(build(rows))).toBe(1500);
  });
  it('does not forecast a salary payment already received early', () => {
    const rows = [...monthly, tx('2026-03-30')];
    expect(total(build(rows))).toBe(0);
    expect(total(build(rows, '2026-05-01', 31))).toBe(1000);
  });
  it('does not repeat income after several missed cycles', () => {
    const schedule = build(monthly, '2026-07-01');
    expect(schedule.has('category:1')).toBe(true);
    expect(total(schedule)).toBe(0);
  });
  it('keeps a single missed cycle from silently cancelling salary', () => {
    expect(total(build(monthly, '2026-05-01', 31))).toBe(1000);
  });
  it('handles month-end pay, February and leap years', () => {
    const rows = ['2023-11-30', '2023-12-31', '2024-01-31'].map(d => tx(d));
    expect(build(rows, '2024-02-01', 29).get('category:1').daily.get('2024-02-29')).toBe(1000);
    const later = ['2025-11-30', '2025-12-31', '2026-01-31'].map(d => tx(d));
    expect(build(later, '2026-02-01', 28).get('category:1').daily.get('2026-02-28')).toBe(1000);
  });
  it('keeps weekly and biweekly income as separate events', () => {
    const weekly = ['2026-03-05', '2026-03-12', '2026-03-19', '2026-03-26'].map(d => tx(d));
    expect(total(build(weekly))).toBe(5000);
    const fortnightly = ['2026-02-19', '2026-03-05', '2026-03-19'].map(d => tx(d));
    expect(total(build(fortnightly))).toBe(3000);
  });
  it('keeps twice-monthly pay on calendar dates instead of drifting every 14 days', () => {
    const rows = ['2026-01-15', '2026-01-31', '2026-02-15', '2026-02-28', '2026-03-15', '2026-03-31'].map(d => tx(d));
    const model = build(rows).get('category:1');
    expect([...model.daily.keys()]).toEqual(['2026-04-15', '2026-04-30']);
    expect(total(build(rows))).toBe(2000);
  });
  it('supports quarterly and annual recurring income when enough evidence exists', () => {
    const quarterly = ['2025-07-07', '2025-10-07', '2026-01-07'].map(d => tx(d));
    expect(total(build(quarterly))).toBe(1000);
    const annual = ['2023-04-07', '2024-04-07', '2025-04-07'].map(d => tx(d));
    expect(total(build(annual))).toBe(1000);
  });
  it('is invariant to currency scale and input order', () => {
    const base = total(build(monthly));
    expect(total(build([...monthly].reverse().map(t => ({ ...t, price: t.price * 0.01 }))))).toBeCloseTo(base * 0.01);
    expect(total(build(monthly.map(t => ({ ...t, price: t.price * 10000 }))))).toBeCloseTo(base * 10000);
  });
  it('supports custom income categories without relying on merchant or language keywords', () => {
    const rows = monthly.map(t => ({...t, name:'入金',category_name:'定期収入',category_name_en:null}));
    expect(total(build(rows))).toBe(1000);
    expect(build(rows.map(t=>({...t,is_counted_as_income:0}))).size).toBe(0);
  });
  it('ignores future evidence, refunds, negative amounts and invalid inputs', () => {
    expect(total(build([...monthly, tx('2026-05-07', 999999), tx('bad-date'), tx('2026-03-08', NaN), tx('2026-03-08', -500)]))).toBe(1000);
    expect(build(monthly.map(t => ({ ...t, category_name: 'Refunds & Credits', category_name_en: 'Refunds & Credits' }))).size).toBe(0);
  });
  it.each(['end_pattern', 'pause_pattern', 'override_pattern', 'skip_occurrence', 'suppress_pattern'])('honors %s corrections', (action) => {
    const snapshot = { patterns: [{ categoryDefinitionId: 1, source: 'detected', state: 'active', corrections: [{action}] }] };
    expect(build(monthly, '2026-04-01', 30, snapshot).size).toBe(0);
  });
  it('honors explicit manual schedules and confirmations', () => {
    for (const extra of [{source:'manual'}, {confirmed:true}]) {
      expect(build(monthly, '2026-04-01', 30, {patterns:[{categoryDefinitionId:1,source:'detected',state:'active',...extra}]}).size).toBe(0);
    }
  });
  it('does not increase total income when a horizon is shortened', () => {
    const full = build(monthly).get('category:1');
    const partial = build(monthly, '2026-04-01', 10).get('category:1');
    for (const [date, amount] of partial.daily) expect(amount).toBe(full.daily.get(date));
  });
});

describe('projection classification and reconciliation', () => {
  it('does not manufacture recurring refunds but preserves explicitly scheduled non-operating income', () => {
    const rows = [tx('2026-01-01', 500, { category_name_en:'Refunds & Credits' })];
    const pattern = {id:1,direction:'income',source:'detected',categoryDefinitionId:1,displayName:'Refund',corrections:[]};
    expect(prepareProjectionPolicy(rows,{patterns:[pattern]},engine).truthSnapshot.patterns).toEqual([]);
    const result = prepareProjectionPolicy(rows,{patterns:[{...pattern,source:'manual'}]},engine);
    expect(result.truthSnapshot.patterns[0].incomeType).toBe('non_operating');
    expect(result.transactions).toEqual([]);
  });
  it('classifies manual schedules with no transaction history from category metadata', () => {
    const result = prepareProjectionPolicy([], {patterns:[{direction:'expense',source:'manual',categoryDefinitionId:9}]},engine,
      [{id:9,name:'Settlement',name_en:'Bank settlement'}]);
    expect(result.truthSnapshot.patterns[0].expenseType).toBe('non_operating');
  });
  it('does not relabel investment transfers or expense refunds as operating streams', () => {
    const rows = [tx('2026-01-01',-500,{category_type:'investment'}),tx('2026-01-02',100,{category_definition_id:2,category_type:'expense'})];
    const patterns = [{categoryDefinitionId:1,direction:'expense',source:'detected'},
      {categoryDefinitionId:2,direction:'income',source:'detected'}];
    expect(prepareProjectionPolicy(rows,{patterns},engine).truthSnapshot.patterns).toEqual([]);
  });
  it('replaces old income once and reconciles day totals and Monte Carlo entries', () => {
    const schedule = build(monthly);
    const forecasts = dates('2026-04-01',30).map(date => ({date,expectedExpenses:10,expectedIncome:999,
      predictions:[{patternKey:'old',categoryDefinitionId:1,categoryType:'income',incomeType:'operating',probabilityWeightedAmount:999},
        {patternKey:'food',categoryType:'expense',expenseType:'operating',probabilityWeightedAmount:10}]}));
    const simulations = forecasts.map(d => ({date:d.date,monthKey:'2026-04',entries:[{patternKey:'old',categoryType:'income',avgAmount:999,probability:1}]}));
    applyIncomeSchedule(forecasts,simulations,schedule,engine);
    expect(forecasts.reduce((s,d)=>s+d.expectedIncome,0)).toBe(1000);
    expect(forecasts.reduce((s,d)=>s+d.expectedCashFlow,0)).toBe(700);
    expect(simulations.flatMap(d=>d.entries).filter(e=>e.patternKey==='old')).toHaveLength(0);
    expect(simulations.flatMap(d=>d.entries).reduce((s,e)=>s+e.probability*e.avgAmount,0)).toBe(1000);
    for (const day of forecasts) expect(day.expectedOperatingCashFlow).toBe(day.expectedIncome-10);
  });
  it('samples each uncertain receipt at most once across possible dates', () => {
    const entries = ['2026-04-06','2026-04-07','2026-04-08'].map(date => ({date,monthKey:'2026-04',entries:[{
      occurrenceKey:'receipt',categoryType:'income',incomeType:'operating',probability:1/3,avgAmount:1000,stdDev:0,
    }]}));
    vi.spyOn(Math,'random').mockReturnValue(0.5);
    const result = engine.simulateScenario(entries,{});
    expect(result.totalIncome).toBe(1000);
    expect(result.dailyResults.map(d=>d.income)).toEqual([0,1000,0]);
  });
});
