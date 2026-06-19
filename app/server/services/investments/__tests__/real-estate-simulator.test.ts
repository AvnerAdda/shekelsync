import { beforeEach, describe, expect, it, vi } from 'vitest';

let simulatorService: any;

beforeEach(async () => {
  const module = await import('../real-estate-simulator.js');
  simulatorService = module.default ?? module;
  simulatorService.__resetDatabase();
});

function mockSchemaQueries(query: ReturnType<typeof vi.fn>) {
  query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
  return query;
}

describe('real estate simulator service', () => {
  it('estimates a manual valuation with scenarios and net equity', () => {
    const estimate = simulatorService.estimateRealEstateValue({
      manual_estimated_value: 700000,
      mortgage_balance: 200000,
      valuation_method: 'manual',
    }, {
      valuationDate: '2026-06-01',
    });

    expect(estimate).toMatchObject({
      valuation_date: '2026-06-01',
      valuation_method: 'manual',
      confidence: 'manual',
      estimated_value: 700000,
      estimated_net_equity: 500000,
      scenario_conservative: 644000,
      scenario_base: 700000,
      scenario_optimistic: 756000,
    });
  });

  it('uses ownership percentage for rental yield valuation', () => {
    const estimate = simulatorService.estimateRealEstateValue({
      monthly_rent: 3000,
      annual_expenses: 6000,
      rental_yield_rate: 3,
      ownership_percentage: 50,
      valuation_method: 'rent_yield',
    });

    expect(estimate.estimated_value).toBe(500000);
    expect(estimate.sources).toContainEqual({
      method: 'rent_yield',
      grossValue: 1000000,
      ownedValue: 500000,
    });
  });

  it('blends multiple valuation sources and reports high confidence when profile data is rich', () => {
    const estimate = simulatorService.estimateRealEstateValue({
      city: 'Haifa',
      purchase_price: 500000,
      purchase_date: '2024-06-01',
      annual_growth_rate: 4,
      monthly_rent: 3000,
      annual_expenses: 6000,
      rental_yield_rate: 3,
      square_meters: 80,
      price_per_sqm: 8000,
      valuation_method: 'blended',
    }, {
      valuationDate: '2026-06-01',
    });

    expect(estimate.confidence).toBe('high');
    expect(estimate.valuation_method).toBe('blended');
    expect(estimate.sources.map((source: any) => source.method)).toEqual([
      'purchase_growth',
      'rent_yield',
      'price_per_sqm',
    ]);
    expect(estimate.estimated_value).toBeGreaterThan(0);
  });

  it('supports purchase-price-only valuation when no purchase date is available', () => {
    const estimate = simulatorService.estimateRealEstateValue({
      purchase_price: 1000000,
      ownership_percentage: 50,
      valuation_method: 'purchase_price',
    });

    expect(estimate).toMatchObject({
      valuation_method: 'purchase_price',
      estimated_value: 500000,
      scenario_base: 500000,
    });
    expect(estimate.sources).toContainEqual({
      method: 'purchase_price',
      grossValue: 1000000,
      ownedValue: 500000,
    });
  });

  it('subtracts only the owned share of total mortgage balance', () => {
    const estimate = simulatorService.estimateRealEstateValue({
      purchase_price: 2730000,
      manual_estimated_value: 682500,
      mortgage_balance: 2047500,
      ownership_percentage: 25,
      valuation_method: 'manual',
    }, {
      valuationDate: '2026-06-01',
    });

    expect(estimate).toMatchObject({
      estimated_value: 682500,
      estimated_net_equity: 170625,
      scenario_base: 682500,
    });
  });

  it('upserts a profile with computed estimate fields', async () => {
    const query = mockSchemaQueries(vi.fn())
      .mockResolvedValueOnce({
        rows: [{ id: 9, account_name: 'Property', account_type: 'real_estate', currency: 'ILS' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          account_id: 9,
          city: 'Tel Aviv',
          property_type: 'apartment',
          ownership_percentage: 100,
          manual_estimated_value: 700000,
          valuation_method: 'manual',
          estimated_value: 700000,
          estimated_net_equity: 650000,
          confidence: 'manual',
          scenario_conservative: 644000,
          scenario_base: 700000,
          scenario_optimistic: 756000,
          assumptions_json: '{"sources":[]}',
        }],
      });

    const result = await simulatorService.upsertRealEstateProfile(9, {
      city: ' Tel Aviv ',
      manual_estimated_value: 700000,
      mortgage_balance: 50000,
      valuation_method: 'manual',
    }, { query });

    expect(result.profile).toMatchObject({
      account_id: 9,
      city: 'Tel Aviv',
      estimated_value: 700000,
      confidence: 'manual',
    });
    expect(query).toHaveBeenCalledTimes(8);
    expect(String(query.mock.calls[7][0])).toContain('INSERT INTO real_estate_properties');
    expect(query.mock.calls[7][1]).toEqual(expect.arrayContaining([
      9,
      'Tel Aviv',
      700000,
      'manual',
      700000,
      650000,
    ]));
  });

  it('normalizes profile payload values before saving', async () => {
    const query = mockSchemaQueries(vi.fn())
      .mockResolvedValueOnce({
        rows: [{ id: 9, account_name: 'Property', account_type: 'real_estate', currency: 'ILS' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          account_id: 9,
          property_type: 'other',
          has_elevator: 1,
          has_parking: 0,
          has_balcony: '1',
          has_storage: '0',
          ownership_percentage: 100,
          purchase_price: '1000',
          estimated_value: '1000',
          estimated_net_equity: '1000',
          assumptions_json: '{"sources":[]}',
        }],
      });

    const result = await simulatorService.upsertRealEstateProfile(9, {
      city: '   ',
      property_type: 'castle',
      has_elevator: 'true',
      has_parking: 'false',
      has_balcony: 1,
      has_storage: 0,
      ownership_percentage: 150,
      purchase_price: '1000',
      valuation_method: 'unknown',
    }, { query });

    expect(query.mock.calls[7][1]).toEqual(expect.arrayContaining([
      9,
      null,
      null,
      'other',
      null,
      null,
      null,
      null,
      1,
      0,
      1,
      0,
      100,
    ]));
    expect(result.profile).toMatchObject({
      property_type: 'other',
      has_elevator: true,
      has_parking: false,
      has_balcony: true,
      has_storage: false,
      ownership_percentage: 100,
      purchase_price: 1000,
      assumptions: { sources: [] },
    });
  });

  it('applies an available valuation to investment holdings', async () => {
    const query = mockSchemaQueries(vi.fn())
      .mockResolvedValueOnce({
        rows: [{ id: 9, account_name: 'Property', account_type: 'real_estate', currency: 'ILS' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          account_id: 9,
          city: 'Jerusalem',
          ownership_percentage: 50,
          purchase_price: 1000000,
          estimated_value: 600000,
          confidence: 'medium',
          assumptions_json: '{}',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 33, account_id: 9, current_value: 600000 }] });

    const result = await simulatorService.applyRealEstateValuation({
      accountId: 9,
      asOfDate: '2026-06-01',
    }, { query });

    expect(result.holding).toMatchObject({ id: 33, current_value: 600000 });
    expect(String(query.mock.calls[8][0])).toContain('INSERT INTO investment_holdings');
    expect(query.mock.calls[8][1]).toEqual([
      9,
      'Jerusalem',
      600000,
      500000,
      '2026-06-01',
      'Real estate simulator valuation (estimated_value, medium confidence)',
    ]);
  });

  it('applies mortgage-backed valuations as net equity holdings', async () => {
    const query = mockSchemaQueries(vi.fn())
      .mockResolvedValueOnce({
        rows: [{ id: 9, account_name: 'Property', account_type: 'real_estate', currency: 'ILS' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          account_id: 9,
          city: 'Haifa',
          ownership_percentage: 100,
          purchase_price: 800000,
          mortgage_balance: 200000,
          estimated_value: 700000,
          estimated_net_equity: 500000,
          confidence: 'medium',
          assumptions_json: '{}',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 34, account_id: 9, current_value: 500000 }] });

    const result = await simulatorService.applyRealEstateValuation({
      accountId: 9,
      asOfDate: '2026-06-01',
    }, { query });

    expect(result.valuationApplied).toEqual({
      currentValue: 500000,
      costBasis: 600000,
      valueBasis: 'net_equity',
    });
    expect(query.mock.calls[8][1]).toEqual([
      9,
      'Haifa',
      500000,
      600000,
      '2026-06-01',
      'Real estate simulator valuation (net_equity, medium confidence)',
    ]);
  });

  it('applies shared-property mortgages using owned mortgage share', async () => {
    const query = mockSchemaQueries(vi.fn())
      .mockResolvedValueOnce({
        rows: [{ id: 9, account_name: 'Property', account_type: 'real_estate', currency: 'ILS' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          account_id: 9,
          city: 'Bat Yam',
          ownership_percentage: 25,
          purchase_price: 2730000,
          mortgage_balance: 2047500,
          estimated_value: 682500,
          estimated_net_equity: 170625,
          confidence: 'manual',
          assumptions_json: '{}',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 35, account_id: 9, current_value: 170625 }] });

    const result = await simulatorService.applyRealEstateValuation({
      accountId: 9,
      asOfDate: '2026-06-01',
    }, { query });

    expect(result.valuationApplied).toEqual({
      currentValue: 170625,
      costBasis: 170625,
      valueBasis: 'net_equity',
    });
    expect(query.mock.calls[8][1]).toEqual([
      9,
      'Bat Yam',
      170625,
      170625,
      '2026-06-01',
      'Real estate simulator valuation (net_equity, manual confidence)',
    ]);
  });

  it('builds a real estate overview with mortgage KPIs', async () => {
    const query = mockSchemaQueries(vi.fn())
      .mockResolvedValueOnce({
        rows: [{
          account_id: 9,
          account_name: 'נדל"ן',
          currency: 'ILS',
          profile_id: 1,
          city: 'Bat Yam',
          neighborhood: 'Kodshei Kahir',
          property_type: 'apartment',
          ownership_percentage: 100,
          purchase_price: 2730000,
          purchase_date: '2026-05-26',
          mortgage_balance: 2047500,
          monthly_mortgage_payment: 9500,
          mortgage_interest_rate: 4.5,
          mortgage_term_years: 30,
          monthly_rent: null,
          annual_expenses: 0,
          price_per_sqm: null,
          annual_growth_rate: 3,
          rental_yield_rate: 3.2,
          manual_estimated_value: 2730000,
          valuation_method: 'manual',
          estimated_value: 2730000,
          estimated_net_equity: 682500,
          confidence: 'manual',
          scenario_conservative: 2511600,
          scenario_base: 2730000,
          scenario_optimistic: 2948400,
          assumptions_json: '{}',
          last_valuation_date: '2026-06-01',
          holding_current_value: 682500,
          holding_cost_basis: 682500,
          holding_as_of_date: '2026-06-01',
        }],
      });

    const result = await simulatorService.getRealEstateOverview({ query });

    expect(result.summary).toMatchObject({
      propertyCount: 1,
      propertyMarketValue: 2730000,
      ownedPropertyValue: 2730000,
      netEquity: 682500,
      totalMortgageBalance: 2047500,
      monthlyMortgagePayment: 9500,
    });
    expect(result.summary.averageLoanToValue).toBe(75);
    expect(result.properties[0]).toMatchObject({
      accountId: 9,
      city: 'Bat Yam',
      propertyMarketValue: 2730000,
      netEquity: 682500,
      loanToValue: 75,
      monthlyMortgagePayment: 9500,
      monthlyCashFlow: -9500,
    });
  });

  it('returns null profile rows and rejects invalid real estate account requests', async () => {
    const noQuery = vi.fn();
    await expect(simulatorService.getRealEstateProfile('not-a-number', { query: noQuery }))
      .rejects.toMatchObject({ status: 400 });
    expect(noQuery).not.toHaveBeenCalled();

    const missingProfileQuery = mockSchemaQueries(vi.fn())
      .mockResolvedValueOnce({
        rows: [{ id: 9, account_name: 'Property', account_type: 'real_estate', currency: 'ILS' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await simulatorService.getRealEstateProfile(9, { query: missingProfileQuery });
    expect(result).toEqual({ profile: null });

    const wrongTypeQuery = mockSchemaQueries(vi.fn())
      .mockResolvedValueOnce({
        rows: [{ id: 10, account_name: 'Brokerage', account_type: 'brokerage', currency: 'ILS' }],
      });

    await expect(simulatorService.getRealEstateProfile(10, { query: wrongTypeQuery }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('handles optional schema column duplicates and propagates unexpected schema errors', async () => {
    const duplicateQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('duplicate column name: monthly_mortgage_payment'))
      .mockRejectedValueOnce(new Error('column already exists'))
      .mockRejectedValueOnce(new Error('exists'));

    await expect(simulatorService.ensureSchema({ query: duplicateQuery })).resolves.toBeUndefined();
    expect(duplicateQuery).toHaveBeenCalledTimes(6);

    const failingQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('database locked'));

    await expect(simulatorService.ensureSchema({ query: failingQuery }))
      .rejects.toThrow('database locked');
  });

  it('rejects valuation application when no estimate is available', async () => {
    const query = mockSchemaQueries(vi.fn())
      .mockResolvedValueOnce({
        rows: [{ id: 9, account_name: 'Property', account_type: 'real_estate', currency: 'ILS' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          account_id: 9,
          city: 'Empty estimate',
          estimated_value: null,
          assumptions_json: null,
        }],
      });

    await expect(simulatorService.applyRealEstateValuation({ accountId: 9 }, { query }))
      .rejects.toMatchObject({
        status: 400,
        message: 'No real estate estimate is available to apply',
      });
  });

  it('builds overview fallbacks for accounts without simulator profiles', async () => {
    const query = mockSchemaQueries(vi.fn())
      .mockResolvedValueOnce({
        rows: [{
          account_id: 11,
          account_name: 'Unprofiled property',
          currency: 'ILS',
          profile_id: null,
          holding_current_value: 123000,
          holding_cost_basis: 100000,
          holding_as_of_date: '2026-06-01',
        }],
      });

    const result = await simulatorService.getRealEstateOverview({ query });

    expect(result.summary).toMatchObject({
      propertyCount: 1,
      propertyMarketValue: 123000,
      ownedPropertyValue: 123000,
      netEquity: 123000,
      missingProfiles: 1,
    });
    expect(result.properties[0]).toMatchObject({
      accountId: 11,
      accountName: 'Unprofiled property',
      hasProfile: false,
      lastValuationDate: '2026-06-01',
    });
  });
});
