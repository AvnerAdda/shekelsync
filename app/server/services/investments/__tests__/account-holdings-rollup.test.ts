import { beforeAll, describe, expect, it } from 'vitest';

let rollupService: any;

beforeAll(async () => {
  const module = await import('../account-holdings-rollup.js');
  rollupService = module.default ?? module;
});

describe('account holdings rollup', () => {
  it('parses finite numeric values and rejects empty or nonnumeric values', () => {
    expect(rollupService.toNumber(null)).toBeNull();
    expect(rollupService.toNumber(undefined)).toBeNull();
    expect(rollupService.toNumber('')).toBeNull();
    expect(rollupService.toNumber('12.5')).toBe(12.5);
    expect(rollupService.toNumber('not-a-number')).toBeNull();
  });

  it('returns an empty snapshot when no holdings are available', () => {
    expect(rollupService.buildCurrentHoldingSnapshot()).toEqual({
      current_value: null,
      cost_basis: null,
      as_of_date: null,
      uses_pikadon_rollup: false,
    });

    expect(rollupService.buildCurrentHoldingSnapshot('bad input')).toEqual({
      current_value: null,
      cost_basis: null,
      as_of_date: null,
      uses_pikadon_rollup: false,
    });
  });

  it('uses the latest standard holding when no active pikadon rows exist', () => {
    const snapshot = rollupService.buildCurrentHoldingSnapshot([
      { id: 1, holding_type: 'standard', current_value: '100', cost_basis: '90', as_of_date: '2026-01-01' },
      { id: 2, holding_type: 'standard', current_value: '120', cost_basis: '95', as_of_date: '2026-02-01' },
      { id: 3, holding_type: 'pikadon', status: 'matured', current_value: '50', cost_basis: '50', as_of_date: '2026-03-01' },
    ]);

    expect(snapshot).toEqual({
      current_value: 120,
      cost_basis: 95,
      as_of_date: '2026-02-01',
      uses_pikadon_rollup: false,
    });
  });

  it('rolls active pikadon rows into the latest standard snapshot', () => {
    const snapshot = rollupService.buildCurrentHoldingSnapshot([
      { id: 10, holding_type: 'standard', current_value: '500', cost_basis: '480', as_of_date: '2026-01-31' },
      { id: 11, holding_type: 'standard', current_value: '450', cost_basis: '430', as_of_date: '2026-01-01' },
      { id: 12, holding_type: 'pikadon', status: 'active', current_value: '100', cost_basis: '95', as_of_date: '2026-02-15' },
      { id: 13, holding_type: 'pikadon', status: 'active', current_value: null, cost_basis: '80', as_of_date: '2026-02-10' },
      { id: 14, holding_type: 'pikadon', status: 'matured', current_value: '999', cost_basis: '999', as_of_date: '2026-02-20' },
    ]);

    expect(snapshot).toEqual({
      current_value: 680,
      cost_basis: 655,
      as_of_date: '2026-02-15',
      uses_pikadon_rollup: true,
    });
  });

  it('falls back to pikadon dates and values when only active pikadon rows exist', () => {
    const snapshot = rollupService.buildCurrentHoldingSnapshot([
      { id: 20, holding_type: 'pikadon', status: 'active', current_value: '', cost_basis: '100', as_of_date: null },
      { id: 21, holding_type: 'pikadon', status: 'active', current_value: '220', cost_basis: null, as_of_date: '2026-03-01' },
    ]);

    expect(snapshot).toEqual({
      current_value: 320,
      cost_basis: 320,
      as_of_date: '2026-03-01',
      uses_pikadon_rollup: true,
    });
  });
});
