import { describe, expect, it } from 'vitest';
import { estimateRealEstatePreview } from '../RealEstateSimulatorFields';

describe('RealEstateSimulatorFields helpers', () => {
  it('estimates net equity separately from gross property value', () => {
    const estimate = estimateRealEstatePreview({
      manual_estimated_value: '700000',
      mortgage_balance: '200000',
      valuation_method: 'manual',
    });

    expect(estimate).toMatchObject({
      estimated_value: 700000,
      estimated_net_equity: 500000,
      scenario_base: 700000,
    });
  });

  it('uses owned mortgage share for partial ownership', () => {
    const estimate = estimateRealEstatePreview({
      purchase_price: '2730000',
      ownership_percentage: '25',
      manual_estimated_value: '682500',
      mortgage_balance: '2047500',
      valuation_method: 'manual',
    });

    expect(estimate).toMatchObject({
      estimated_value: 682500,
      estimated_net_equity: 170625,
      scenario_base: 682500,
    });
  });

  it('supports purchase-price-only valuation when no purchase date is available', () => {
    const estimate = estimateRealEstatePreview({
      purchase_price: '1000000',
      ownership_percentage: '50',
      valuation_method: 'purchase_price',
    });

    expect(estimate).toMatchObject({
      valuation_method: 'purchase_price',
      estimated_value: 500000,
      scenario_base: 500000,
    });
  });
});
