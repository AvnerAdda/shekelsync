import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const service = require('../service.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('../store.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const marketData = require('../../market-data.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const income = require('../income.js');

function sqliteAdapter(db: DatabaseSync) {
  return {
    async query(sql: string, params: unknown[] = []) {
      const bindings: any[] = [];
      const sqliteSql = sql.replace(/\$(\d+)/g, (_, index) => {
        bindings.push(params[Number(index) - 1] ?? null);
        return '?';
      });
      const statement = db.prepare(sqliteSql);
      if (/^\s*(SELECT|WITH)/i.test(sqliteSql) || /RETURNING/i.test(sqliteSql)) {
        return { rows: statement.all(...bindings) };
      }
      statement.run(...bindings);
      return { rows: [] };
    },
  };
}

const mortgagePayload = {
  tracks: [
    { type: 'prime', margin: -0.75, termMonths: 360, firstPaymentDate: '2026-10-10', tranches: [{ drawDate: '2026-09-10', amount: 500000 }] },
    { type: 'fixed_unlinked', rate: 4.54, rateConvention: 'effective', termMonths: 360, firstPaymentDate: '2026-10-10', tranches: [{ drawDate: '2026-09-10', amount: 745500 }] },
  ],
};

describe('mortgage service', () => {
  let db: DatabaseSync;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE investment_accounts (id INTEGER PRIMARY KEY, account_name TEXT);
      CREATE TABLE real_estate_properties (
        account_id INTEGER PRIMARY KEY, mortgage_balance REAL, monthly_mortgage_payment REAL,
        mortgage_interest_rate REAL, mortgage_term_years REAL, purchase_date TEXT,
        last_valuation_date TEXT, ownership_percentage REAL, estimated_value REAL,
        estimated_net_equity REAL, updated_at TEXT, purchase_price REAL, annual_growth_rate REAL,
        annual_expenses REAL, manual_estimated_value REAL, monthly_rent REAL
      );
      CREATE TABLE category_definitions (id INTEGER PRIMARY KEY, name TEXT, name_en TEXT, category_type TEXT, is_counted_as_income INTEGER);
      CREATE TABLE transactions (identifier TEXT, date TEXT, price REAL, category_definition_id INTEGER, category_type TEXT);
      INSERT INTO category_definitions VALUES (1, 'משכורת', 'Salary', 'income', 1);
      INSERT INTO transactions VALUES ('s1', '2026-09-01T00:00:00.000Z', 25000, 1, NULL), ('s2', '2026-10-01T00:00:00.000Z', 25000, 1, NULL);
      INSERT INTO investment_accounts VALUES (1, 'Off-plan'), (2, 'Legacy');
      INSERT INTO real_estate_properties (account_id, mortgage_balance, ownership_percentage, estimated_value, estimated_net_equity)
        VALUES (1, 999, 100, 2730000, 2729001);
      INSERT INTO real_estate_properties (account_id, mortgage_balance, monthly_mortgage_payment, mortgage_interest_rate, last_valuation_date, ownership_percentage, estimated_value)
        VALUES (2, 100000, 1060.66, 5, '2026-06-01', 50, 400000);
    `);
    const adapter = sqliteAdapter(db);
    store.__setDatabase(adapter);
    marketData.__setDatabase(adapter);
    income.__setDatabase(adapter);
    service.__setDependencies({ database: adapter, now: () => new Date('2026-11-01T09:00:00Z') });
    await marketData.ensureSchema();
    db.exec(`
      INSERT INTO market_series (series_key, source, frequency, last_synced_at) VALUES ('boi.policy_rate', 'boi', 'D', '2026-11-01T00:00:00Z');
      INSERT INTO market_series_points (series_key, period, value) VALUES ('boi.policy_rate', '2026-09-03', 3.25);
    `);
  });

  afterEach(() => {
    store.__resetDatabase();
    marketData.__resetDatabase();
    income.__resetDatabase();
    service.__resetDependencies();
    db.close();
  });

  it('saves tracks, computes the view from cached prime, and refreshes legacy columns', async () => {
    const view = await service.saveMortgage(1, mortgagePayload);
    expect(view.source).toBe('tracks');
    expect(view.market.currentPrime).toBeCloseTo(4.75, 6);
    const prime = view.summary.tracks.find((track: any) => track.type === 'prime');
    expect(prime.currentRate).toBeCloseTo(4, 6);
    expect(view.summary.nextPaymentDate).toBe('2026-11-10');
    expect(view.summary.nextPayment).toBeGreaterThan(6100);
    expect(view.summary.nextPayment).toBeLessThan(6200);

    const row = db.prepare('SELECT * FROM real_estate_properties WHERE account_id = 1').get() as any;
    expect(row.mortgage_balance).toBe(Math.round(view.summary.balance));
    expect(row.monthly_mortgage_payment).toBeCloseTo(view.summary.nextPayment, 1);
    expect(row.mortgage_term_years).toBeCloseTo(29.8, 1);
    expect(row.estimated_net_equity).toBe(2730000 - Math.round(view.summary.balance));
  });

  it('counts drawdowns still to come as debt for off-plan purchases', async () => {
    const offPlan = {
      tracks: [{ ...mortgagePayload.tracks[1], tranches: [{ drawDate: '2026-09-10', amount: 745500 }, { drawDate: '2026-12-10', amount: 372750, status: 'planned' }] }],
    };
    const view = await service.saveMortgage(1, offPlan);
    expect(view.summary.undrawn).toBe(372750);
    const row = db.prepare('SELECT mortgage_balance, estimated_net_equity FROM real_estate_properties WHERE account_id = 1').get() as any;
    expect(row.mortgage_balance).toBe(Math.round(view.summary.balance + 372750));
    const enriched = await service.enrichOverview({
      summary: {},
      properties: [{ accountId: 1, ownershipPercentage: 100, ownedPropertyValue: 2730000, propertyMarketValue: 2730000, netEquity: 0, hasProfile: false }],
    });
    const property = enriched.properties[0];
    expect(property.drawnMortgageBalance).toBe(Math.round(view.summary.balance));
    expect(property.totalMortgageBalance).toBe(Math.round(view.summary.balance + 372750));
    expect(property.netEquity).toBe(2730000 - property.totalMortgageBalance);
    expect(property.loanToValue).toBeCloseTo((property.totalMortgageBalance / 2730000) * 100, 1);
  });

  it('keeps the assumed market rate when a planned drawdown is marked drawn', async () => {
    db.exec(`
      INSERT INTO market_series (series_key, source, frequency, last_synced_at) VALUES ('boi.mrtg.fixed_unlinked', 'boi', 'M', '2026-11-01T00:00:00Z');
      INSERT INTO market_series_points (series_key, period, value) VALUES ('boi.mrtg.fixed_unlinked', '2026-09', 5.1);
    `);
    const planned = { drawDate: '2026-12-10', amount: 372750, status: 'planned' };
    const track = { ...mortgagePayload.tracks[1], tranches: [{ drawDate: '2026-09-10', amount: 745500 }, planned] };
    const before = await service.saveMortgage(1, { tracks: [track] });
    const drawn = await service.saveMortgage(1, { tracks: [{ ...track, tranches: [track.tranches[0], { ...planned, status: 'drawn' }] }] });
    const tranches = (await store.getMortgageForAccount(1)).tracks[0].tranches;
    expect(tranches.map((tranche: any) => [tranche.status, tranche.rate])).toEqual([['drawn', null], ['drawn', 5.1]]);
    const paymentOn = (view: any, date: string) => view.schedule.tracks[0].rows.find((row: any) => row.date === date)?.payment;
    expect(paymentOn(drawn, '2027-01-10')).toBeCloseTo(paymentOn(before, '2027-01-10'), 2);
    // An explicit rate entered by the user wins.
    await service.saveMortgage(1, { tracks: [{ ...track, tranches: [track.tranches[0], { ...planned, status: 'drawn', rate: 4.2 }] }] });
    expect((await store.getMortgageForAccount(1)).tracks[0].tranches[1].rate).toBe(4.2);
  });

  it('clears cached forecasts when the mortgage or its matcher changes', async () => {
    let cleared = 0;
    service.__setDependencies({ invalidateForecastCaches: () => { cleared += 1; } });
    await service.saveMortgage(1, mortgagePayload);
    expect(cleared).toBe(1);
    await service.deleteMortgage(1);
    expect(cleared).toBe(2);
  });

  it('stores settings and costs and builds the sale analysis and health', async () => {
    db.exec("UPDATE real_estate_properties SET purchase_price = 2730000, purchase_date = '2026-08-01', annual_growth_rate = 3 WHERE account_id = 1");
    await service.saveMortgage(1, mortgagePayload);
    const settings = await service.savePropertySettings(1, { usageType: 'owner_occupied', marketRent: 7500, deliveryDate: '2026-12-10', brokerPct: 1.5 });
    expect(settings).toMatchObject({ usageType: 'owner_occupied', marketRent: 7500, brokerPct: 1.5, deliveryDate: '2026-12-10' });
    const costs = await service.savePropertyCosts(1, [
      { type: 'down_payment', amount: 682500, date: '2026-08-01' },
      { type: 'purchase_tax', amount: 40000, date: '2026-08-15' },
    ]);
    expect(costs.map((cost: any) => cost.deductible)).toEqual([false, true]);
    await expect(service.savePropertyCosts(1, [{ type: 'nope', amount: 1 }])).rejects.toMatchObject({ status: 400 });

    const result = await service.getPropertyAnalysis(1);
    expect(result.sale.cashInvested.upfront).toBe(722500);
    expect(result.sale.assumptions).not.toContain('down_payment_derived');
    expect(result.sale.settings.brokerPct).toBe(1.5);
    expect(result.sale.breakEven.clearDebtPrice).toBeGreaterThan(1_200_000);
    expect(result.health.affordability.income.monthly).toBe(25000);
    expect(result.health.affordability.paymentToIncomePct).toBeGreaterThan(20);
    expect(result.health.prepayment.trackId).toBeDefined();

    await service.savePropertySettings(1, { monthlyIncomeOverride: 30000 });
    const overridden = await service.getPropertyAnalysis(1);
    expect(overridden.health.affordability.income).toMatchObject({ monthly: 30000, source: 'manual' });
  });

  it('refreshes the net-worth snapshot and re-values price-index properties', async () => {
    db.exec(`
      CREATE TABLE investment_holdings (id INTEGER PRIMARY KEY, account_id INTEGER, current_value REAL, as_of_date TEXT, holding_type TEXT, notes TEXT);
      ALTER TABLE real_estate_properties ADD COLUMN valuation_method TEXT;
      ALTER TABLE real_estate_properties ADD COLUMN scenario_base REAL;
      ALTER TABLE real_estate_properties ADD COLUMN scenario_conservative REAL;
      ALTER TABLE real_estate_properties ADD COLUMN scenario_optimistic REAL;
      UPDATE real_estate_properties SET purchase_price = 2000000, purchase_date = '2025-01-15', valuation_method = 'price_index' WHERE account_id = 1;
      INSERT INTO market_series (series_key, source, frequency, last_synced_at) VALUES ('cbs.hpi.national', 'cbs', 'M', '2026-11-01T00:00:00Z');
      INSERT INTO market_series_points (series_key, period, value) VALUES ('cbs.hpi.national', '2025-01', 500), ('cbs.hpi.national', '2026-07', 510);
    `);
    const applied: any[] = [];
    service.__setDependencies({ simulator: { applyRealEstateValuation: async (params: any) => { applied.push(params); } } });
    const valuation = await service.priceIndexValuation(1);
    expect(valuation).toMatchObject({ series: 'cbs.hpi.national', fromPeriod: '2025-01', toPeriod: '2026-07', value: 2040000 });

    await store.replaceMortgageForAccount(1, mortgagePayload);
    const result = await service.refreshValuationSnapshot(1);
    expect(result).toEqual({ refreshed: true, asOf: '2026-11-01' });
    expect(applied).toEqual([{ accountId: 1, asOfDate: '2026-11-01' }]);
    const row = db.prepare('SELECT estimated_value, estimated_net_equity, mortgage_balance FROM real_estate_properties WHERE account_id = 1').get() as any;
    expect(row.estimated_value).toBe(2040000);
    expect(row.estimated_net_equity).toBe(2040000 - row.mortgage_balance);

    // A fresh snapshot with the same value is not rewritten.
    db.prepare("INSERT INTO investment_holdings (account_id, current_value, as_of_date, holding_type, notes) VALUES (1, ?, '2026-11-01', 'standard', 'Real estate simulator valuation (net_equity)')")
      .run(row.estimated_net_equity);
    expect(await service.refreshValuationSnapshot(1)).toMatchObject({ refreshed: false, reason: 'fresh' });
  });

  it('reconciles computed payments with matched bank debits', async () => {
    await store.replaceMortgageForAccount(1, mortgagePayload);
    db.exec(`
      CREATE TABLE transaction_account_links (account_id INTEGER, transaction_identifier TEXT, transaction_vendor TEXT);
      ALTER TABLE transactions ADD COLUMN vendor TEXT;
      ALTER TABLE transactions ADD COLUMN account_number TEXT;
      ALTER TABLE transactions ADD COLUMN name TEXT;
      INSERT INTO transactions (identifier, date, price, vendor, account_number, name) VALUES
        ('m1', '2026-10-10T00:00:00.000Z', -6200, 'discount', '0162', 'דסק-משכנתא חיוב');
      INSERT INTO transaction_account_links VALUES (1, 'm1', 'discount');
    `);
    const result = await service.getReconciliation(1);
    expect(result.matcher).toMatchObject({ vendor: 'discount', source: 'linked_transactions' });
    expect(result.months.find((item: any) => item.month === '2026-10')).toMatchObject({ actual: 6200, status: expect.stringMatching(/ok|drift/) });
    expect(result.candidates[0]).toMatchObject({ vendor: 'discount', count: 1 });
    const saved = await service.savePaymentMatcher(1, { vendor: 'discount', accountNumber: '0162', pattern: 'משכנתא' });
    expect(saved.matcher).toMatchObject({ source: 'saved', pattern: 'משכנתא' });
  });

  it('runs stress scenarios and compares a refinance offer', async () => {
    await store.replaceMortgageForAccount(1, mortgagePayload);
    const stress = await service.getStressTest(1, { scenarios: [{ label: 'Prime +5', scenario: { primeShiftPct: 5 } }] });
    expect(stress.scenarios.map((item: any) => item.key)).toEqual(['base', 'prime1', 'prime2', 'prime3', 'cpi4', 'combined', 'custom1']);
    expect(stress.monthlyIncome).toBe(25000);
    expect(stress.scenarios.at(-1).label).toBe('Prime +5');

    const saved = await store.getMortgageForAccount(1);
    const fixedId = String(saved.tracks[1].id);
    const preview = await service.previewRefinance(1, {
      closeTrackIds: [fixedId, 'unknown'],
      offerTracks: [{ type: 'fixed_unlinked', rate: 3.9, termMonths: 358 }],
    });
    expect(preview.closedTrackIds).toEqual([fixedId]);
    expect(preview.savings.monthlyPaymentChange).toBeLessThan(0);
    await expect(service.previewRefinance(1, { closeTrackIds: [fixedId], offerTracks: [{ type: 'prime' }] }))
      .rejects.toMatchObject({ status: 400 });
    await expect(service.previewRefinance(1, { closeTrackIds: [fixedId], offerTracks: [{ type: 'fixed_unlinked', rate: 4 }], date: '2020-01-01' }))
      .rejects.toMatchObject({ status: 400 });

    const check = await service.getRefinanceCheck(1, { switchingCosts: '1000' });
    expect(check.switchingCosts).toBe(1000);
    expect(check.tracks.map((track: any) => track.status)).toEqual(['no_benchmark', 'no_benchmark']); // no market averages cached
  });

  it('persists an applied refinance and closes the replaced track', async () => {
    const view = await service.saveMortgage(1, {
      tracks: [
        ...mortgagePayload.tracks,
        { type: 'fixed_unlinked', rate: 3.9, termMonths: 358, firstPaymentDate: '2026-12-10', tranches: [{ drawDate: '2026-11-10', amount: 744000, status: 'planned', rate: 3.9 }] },
      ],
      events: [{ type: 'refinance', date: '2026-11-10', trackIndex: null, closeTrackIndexes: [1], fee: 60 }],
    });
    expect(view.mortgage.events[0]).toMatchObject({ type: 'refinance', closeTrackIndexes: [1] });
    const closed = view.schedule.tracks[1];
    expect(closed.closedDate).toBe('2026-11-10');
    expect(view.schedule.tracks[2].rows[0]).toMatchObject({ date: '2026-12-10' });
    const dec = view.schedule.monthly.find((point: any) => point.month === '2026-12');
    expect(dec.byTrack[String(closed.trackId)]).toBe(0);
  });

  it('leaves consistent single-mortgage fields when tracks are deleted', async () => {
    db.exec("UPDATE real_estate_properties SET last_valuation_date = '2023-01-01' WHERE account_id = 1");
    const saved = await service.saveMortgage(1, mortgagePayload);
    await service.deleteMortgage(1);
    const row = db.prepare('SELECT mortgage_balance, last_valuation_date FROM real_estate_properties WHERE account_id = 1').get() as any;
    expect(row.last_valuation_date).toBe('2026-11-01');
    const view = await service.getMortgageView(1);
    expect(view.source).toBe('legacy');
    // Same debt as before deleting, not amortized again since 2023.
    expect(view.summary.balance).toBeCloseTo(saved.summary.balance, -2);
  });

  it('projects legacy single-mortgage properties without writing to them', async () => {
    const view = await service.getMortgageView(2);
    expect(view.source).toBe('legacy');
    expect(view.legacy.termSource).toBe('solved_from_payment');
    expect(view.summary.balance).toBeLessThan(100000);
    expect(await service.syncLegacyColumns(2)).toEqual({ updated: false, reason: 'no_tracks' });
  });

  it('applies scenarios in previews and rejects invalid drafts', async () => {
    const base = await service.previewMortgage({ mortgage: mortgagePayload });
    const stressed = await service.previewMortgage({ mortgage: mortgagePayload, scenario: { primeShiftPct: 2 } });
    // The shift applies from today on: the next payment (period from 10 Oct) is unchanged.
    expect(stressed.summary.nextPayment).toBe(base.summary.nextPayment);
    const january = (preview: any) => preview.schedule.monthly.find((m: any) => m.month === '2027-01').payment;
    expect(january(stressed)).toBeGreaterThan(january(base) + 500);
    await expect(service.previewMortgage({ mortgage: { tracks: [] } })).rejects.toMatchObject({ status: 400 });
    await expect(service.previewMortgage({ mortgage: mortgagePayload, scenario: { primeShiftPct: 'x' } }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('enriches the overview with live mortgage figures', async () => {
    await store.replaceMortgageForAccount(1, mortgagePayload);
    const overview = {
      summary: {},
      properties: [
        { accountId: 1, ownershipPercentage: 100, ownedPropertyValue: 2730000, propertyMarketValue: 2730000, netEquity: 2729001, monthlyRent: 0, annualExpenses: 0, hasProfile: false },
        { accountId: 2, ownershipPercentage: 50, ownedPropertyValue: 200000, propertyMarketValue: 400000, netEquity: 150000, hasProfile: true },
      ],
    };
    const enriched = await service.enrichOverview(overview, {
      summarize: (properties: any[]) => ({ count: properties.length, netEquity: properties.reduce((s, p) => s + p.netEquity, 0) }),
    });
    const [offPlan, legacy] = enriched.properties;
    expect(offPlan.mortgage.source).toBe('tracks');
    expect(offPlan.totalMortgageBalance).toBe(Math.round(offPlan.mortgage.balance));
    expect(offPlan.undrawnMortgageAmount).toBe(0);
    expect(offPlan.netEquity).toBe(2730000 - offPlan.ownedMortgageBalance);
    expect(offPlan.loanToValue).toBeCloseTo((offPlan.mortgage.balance / 2730000) * 100, 6);
    // Legacy properties keep their stored figures but expose the projection.
    expect(legacy.netEquity).toBe(150000);
    expect(legacy.mortgage.source).toBe('legacy');
    expect(enriched.summary.count).toBe(2);
    expect(enriched.market.currentPrime).toBeCloseTo(4.75, 6);
  });
});
