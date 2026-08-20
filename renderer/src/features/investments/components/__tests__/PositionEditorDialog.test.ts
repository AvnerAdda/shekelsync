import { describe, expect, it } from 'vitest';
import type { InvestmentAccountSummary, InvestmentPosition } from '@renderer/types/investments';
import {
  buildPositionPayload,
  createPositionDraft,
  validatePositionDraft,
} from '../PositionEditorDialog';

const account: InvestmentAccountSummary = {
  id: 7,
  account_name: 'US Brokerage',
  account_type: 'brokerage',
  currency: 'USD',
  current_value: 1000,
  cost_basis: 900,
};

describe('PositionEditorDialog helpers', () => {
  it('starts a new holding in the selected account native currency', () => {
    const draft = createPositionDraft([account]);

    expect(draft).toMatchObject({
      account_id: '7',
      currency: 'USD',
      units: '0',
      asset_type: 'stock',
    });
  });

  it('builds the canonical position request while preserving explicit zeroes', () => {
    const payload = buildPositionPayload({
      ...createPositionDraft([account]),
      position_name: '  Global Fund  ',
      asset_symbol: ' vwra ',
      asset_type: 'etf',
      units: '0',
      average_cost: '0',
      current_price: '0',
      valuation_date: '2026-08-12',
      notes: '  Long term  ',
    });

    expect(payload).toEqual({
      account_id: 7,
      position_name: 'Global Fund',
      asset_symbol: 'VWRA',
      asset_type: 'etf',
      currency: 'USD',
      units: 0,
      average_cost: 0,
      current_price: 0,
      valuation_date: '2026-08-12',
      notes: 'Long term',
    });
  });

  it('loads canonical position values for editing', () => {
    const position: InvestmentPosition = {
      id: 3,
      account_id: 7,
      position_name: 'Global Fund',
      asset_symbol: 'VWRA',
      asset_type: 'etf',
      currency: 'USD',
      status: 'open',
      opened_at: '2026-02-01',
      units: 4.5,
      average_cost: 100,
      current_price: 110,
      valuation_date: '2026-08-10',
      original_cost_basis: 450,
      open_cost_basis: 450,
      current_value: 495,
    };

    expect(createPositionDraft([account], position)).toMatchObject({
      account_id: '7',
      asset_symbol: 'VWRA',
      units: '4.5',
      average_cost: '100',
      current_price: '110',
      valuation_date: '2026-08-10',
    });
  });

  it('reports actionable validation errors', () => {
    const errors = validatePositionDraft({
      ...createPositionDraft([]),
      currency: 'US',
      units: '-1',
      average_cost: 'bad',
      valuation_date: '',
    });

    expect(errors).toMatchObject({
      account_id: expect.any(String),
      position_name: expect.any(String),
      currency: expect.any(String),
      units: expect.any(String),
      average_cost: expect.any(String),
      valuation_date: expect.any(String),
    });
  });

  it('accepts a translator without changing the English default contract', () => {
    const invalidDraft = {
      ...createPositionDraft([]),
      position_name: '',
    };

    expect(validatePositionDraft(invalidDraft).position_name).toBe('Enter a holding name.');
    expect(validatePositionDraft(
      invalidDraft,
      (key) => `translated:${key}`,
    ).position_name).toBe('translated:nameRequired');
  });
});
