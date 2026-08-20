import { describe, expect, it } from 'vitest';
import type { InvestmentPosition } from '@renderer/types/investments';
import {
  buildPositionActivityPayload,
  createPositionActivityDraft,
  validatePositionActivityDraft,
} from '../PositionActivityDialog';

const position: InvestmentPosition = {
  id: 55,
  account_id: 7,
  position_name: 'Global Fund',
  asset_symbol: 'VWRA',
  asset_type: 'etf',
  currency: 'USD',
  status: 'open',
  opened_at: '2026-01-01',
  units: 10,
  average_cost: 90,
  current_price: 110,
  original_cost_basis: 900,
  open_cost_basis: 900,
  current_value: 1100,
};

describe('PositionActivityDialog helpers', () => {
  it('builds a sale with explicit proceeds and disposed basis', () => {
    const draft = {
      ...createPositionActivityDraft(),
      event_type: 'sell' as const,
      effective_date: '2026-08-12',
      proceeds_amount: '500',
      disposed_cost_basis: '400',
      units: '4',
      fee_amount: '5',
      tax_amount: '10',
      current_value: '660',
      close_action: 'partial_close' as const,
    };

    expect(validatePositionActivityDraft(draft, position)).toEqual({});
    expect(buildPositionActivityPayload(position.id, draft)).toEqual({
      position_id: 55,
      event_type: 'sell',
      effective_date: '2026-08-12',
      notes: null,
      proceeds_amount: 500,
      disposed_cost_basis: 400,
      close_action: 'partial_close',
      units: 4,
      fee_amount: 5,
      tax_amount: 10,
      current_value: 660,
    });
  });

  it('keeps cash income separate unless reinvestment is explicit', () => {
    const cashDividend = {
      ...createPositionActivityDraft(),
      event_type: 'dividend' as const,
      effective_date: '2026-08-12',
      income_amount: '25',
      units: '0.2',
    };
    const reinvestedDividend = { ...cashDividend, reinvested: true };

    expect(buildPositionActivityPayload(55, cashDividend)).toEqual({
      position_id: 55,
      event_type: 'dividend',
      effective_date: '2026-08-12',
      notes: null,
      income_amount: 25,
      reinvested: false,
    });
    expect(buildPositionActivityPayload(55, reinvestedDividend)).toMatchObject({
      income_amount: 25,
      reinvested: true,
      units: 0.2,
    });
  });

  it('only requests a value deduction when the fee flag is set', () => {
    const fee = {
      ...createPositionActivityDraft(),
      event_type: 'fee' as const,
      effective_date: '2026-08-12',
      fee_amount: '7.5',
      deducted_from_position: true,
    };

    expect(buildPositionActivityPayload(55, fee)).toMatchObject({
      event_type: 'fee',
      fee_amount: 7.5,
      deducted_from_position: true,
    });
  });

  it('accepts a zero valuation but rejects retroactive and over-disposal events', () => {
    const valuation = {
      ...createPositionActivityDraft(),
      event_type: 'valuation' as const,
      effective_date: '2026-08-12',
      current_value: '0',
    };
    expect(validatePositionActivityDraft(valuation, position)).toEqual({});

    const invalidSale = {
      ...createPositionActivityDraft(),
      event_type: 'sell' as const,
      effective_date: '2025-12-31',
      proceeds_amount: '100',
      disposed_cost_basis: '901',
      units: '11',
    };
    expect(validatePositionActivityDraft(invalidSale, position)).toMatchObject({
      effective_date: expect.any(String),
      disposed_cost_basis: expect.any(String),
      units: expect.any(String),
    });
  });

  it('accepts localized validation messages while retaining English defaults', () => {
    const invalidDraft = {
      ...createPositionActivityDraft(),
      effective_date: '',
      principal_amount: '',
    };

    expect(validatePositionActivityDraft(invalidDraft, position)).toMatchObject({
      effective_date: 'Choose an activity date.',
      principal_amount: 'Enter the invested amount.',
    });
    expect(validatePositionActivityDraft(
      invalidDraft,
      position,
      (key) => `translated:${key}`,
    )).toMatchObject({
      effective_date: 'translated:dateRequired',
      principal_amount: 'translated:investedAmountRequired',
    });
  });
});
