const actualDatabase = require('../database.js');
const { dialect } = require('../../../lib/sql-dialect.js');

let database = actualDatabase;
let schemaEnsured = false;

const PROPERTY_TYPES = new Set(['apartment', 'house', 'land', 'commercial', 'other']);
const VALUATION_METHODS = new Set(['blended', 'manual', 'purchase_growth', 'purchase_price', 'rent_yield', 'price_per_sqm']);
const CONFIDENCE_LEVELS = new Set(['manual', 'high', 'medium', 'low']);

const DEFAULT_ANNUAL_GROWTH_RATE = 3;
const DEFAULT_RENTAL_YIELD_RATE = 3.2;
const DEFAULT_OWNERSHIP_PERCENTAGE = 100;

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBooleanStorage(value) {
  if (value === true || value === 1 || value === '1') return 1;
  if (typeof value === 'string' && value.toLowerCase() === 'true') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  if (typeof value === 'string' && value.toLowerCase() === 'false') return 0;
  return null;
}

function fromBooleanStorage(value) {
  if (value === null || value === undefined) return null;
  return value === true || value === 1 || value === '1';
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.split('T')[0];
  return new Date(value).toISOString().split('T')[0];
}

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function clampPercentage(value, fallback = null) {
  const parsed = toNumber(value, fallback);
  if (parsed === null) return null;
  return Math.min(Math.max(parsed, 0), 100);
}

function normalizePropertyType(value) {
  const normalized = String(value || 'apartment').trim().toLowerCase();
  return PROPERTY_TYPES.has(normalized) ? normalized : 'other';
}

function normalizeValuationMethod(value) {
  const normalized = String(value || 'blended').trim().toLowerCase();
  return VALUATION_METHODS.has(normalized) ? normalized : 'blended';
}

function normalizeProfilePayload(payload = {}) {
  const ownershipPercentage = clampPercentage(
    payload.ownership_percentage,
    DEFAULT_OWNERSHIP_PERCENTAGE,
  ) || DEFAULT_OWNERSHIP_PERCENTAGE;

  return {
    city: normalizeText(payload.city),
    neighborhood: normalizeText(payload.neighborhood),
    property_type: normalizePropertyType(payload.property_type),
    rooms: toNumber(payload.rooms),
    square_meters: toNumber(payload.square_meters),
    floor: toNumber(payload.floor),
    total_floors: toNumber(payload.total_floors),
    has_elevator: toBooleanStorage(payload.has_elevator),
    has_parking: toBooleanStorage(payload.has_parking),
    has_balcony: toBooleanStorage(payload.has_balcony),
    has_storage: toBooleanStorage(payload.has_storage),
    ownership_percentage: ownershipPercentage,
    purchase_price: toNumber(payload.purchase_price),
    purchase_date: normalizeDate(payload.purchase_date),
    mortgage_balance: toNumber(payload.mortgage_balance, 0),
    monthly_mortgage_payment: toNumber(payload.monthly_mortgage_payment),
    mortgage_interest_rate: toNumber(payload.mortgage_interest_rate),
    mortgage_term_years: toNumber(payload.mortgage_term_years),
    monthly_rent: toNumber(payload.monthly_rent),
    annual_expenses: toNumber(payload.annual_expenses, 0),
    price_per_sqm: toNumber(payload.price_per_sqm),
    annual_growth_rate: toNumber(payload.annual_growth_rate, DEFAULT_ANNUAL_GROWTH_RATE),
    rental_yield_rate: toNumber(payload.rental_yield_rate, DEFAULT_RENTAL_YIELD_RATE),
    manual_estimated_value: toNumber(payload.manual_estimated_value),
    valuation_method: normalizeValuationMethod(payload.valuation_method),
    last_valuation_date: normalizeDate(payload.last_valuation_date) || new Date().toISOString().split('T')[0],
  };
}

function yearsBetween(startDate, endDate = new Date()) {
  if (!startDate) return null;
  const start = new Date(startDate);
  const end = endDate instanceof Date ? endDate : new Date(endDate);
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return diffMs / (365.25 * 24 * 60 * 60 * 1000);
}

function applyOwnership(value, ownershipPercentage) {
  if (value === null || value === undefined) return null;
  return value * ((ownershipPercentage || DEFAULT_OWNERSHIP_PERCENTAGE) / 100);
}

function roundMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function positiveMoney(value) {
  const rounded = roundMoney(value);
  if (rounded === null) return null;
  return Math.max(rounded, 0);
}

function buildSource(name, grossValue, ownershipPercentage) {
  if (grossValue === null || grossValue === undefined || !Number.isFinite(grossValue) || grossValue <= 0) {
    return null;
  }
  return {
    method: name,
    grossValue: roundMoney(grossValue),
    ownedValue: roundMoney(applyOwnership(grossValue, ownershipPercentage)),
  };
}

function estimateRealEstateValue(input = {}, options = {}) {
  const profile = normalizeProfilePayload(input);
  const valuationDate = normalizeDate(options.valuationDate || profile.last_valuation_date)
    || new Date().toISOString().split('T')[0];
  const ownershipPercentage = profile.ownership_percentage || DEFAULT_OWNERSHIP_PERCENTAGE;
  const sources = [];

  const manualSource = buildSource(
    'manual',
    profile.manual_estimated_value === null
      ? null
      : profile.manual_estimated_value / (ownershipPercentage / 100),
    ownershipPercentage,
  );
  if (manualSource) sources.push(manualSource);

  const holdingYears = yearsBetween(profile.purchase_date, valuationDate);
  if (profile.purchase_price !== null && holdingYears !== null) {
    const growthRate = (profile.annual_growth_rate ?? DEFAULT_ANNUAL_GROWTH_RATE) / 100;
    sources.push(buildSource(
      'purchase_growth',
      profile.purchase_price * Math.pow(1 + growthRate, holdingYears),
      ownershipPercentage,
    ));
  } else if (profile.purchase_price !== null) {
    sources.push(buildSource('purchase_price', profile.purchase_price, ownershipPercentage));
  }

  const rentalYieldRate = profile.rental_yield_rate ?? DEFAULT_RENTAL_YIELD_RATE;
  if (profile.monthly_rent !== null && rentalYieldRate > 0) {
    const annualNetRent = Math.max((profile.monthly_rent * 12) - (profile.annual_expenses || 0), 0);
    sources.push(buildSource('rent_yield', annualNetRent / (rentalYieldRate / 100), ownershipPercentage));
  }

  if (profile.square_meters !== null && profile.price_per_sqm !== null) {
    sources.push(buildSource('price_per_sqm', profile.square_meters * profile.price_per_sqm, ownershipPercentage));
  }

  const validSources = sources.filter(Boolean);
  let selectedSource = null;
  if (profile.valuation_method !== 'blended') {
    selectedSource = validSources.find((source) => source.method === profile.valuation_method) || null;
  }

  let estimatedValue = null;
  let method = profile.valuation_method;
  if (selectedSource) {
    estimatedValue = selectedSource.ownedValue;
    method = selectedSource.method;
  } else if (validSources.length > 0) {
    estimatedValue = roundMoney(
      validSources.reduce((sum, source) => sum + source.ownedValue, 0) / validSources.length,
    );
    method = validSources.length === 1 ? validSources[0].method : 'blended';
  }

  const confidence = (() => {
    if (method === 'manual') return 'manual';
    if (validSources.length >= 3 && profile.city && profile.square_meters) return 'high';
    if (validSources.length >= 2) return 'medium';
    if (validSources.length === 1) return 'low';
    return 'low';
  })();

  const conservative = estimatedValue === null ? null : roundMoney(estimatedValue * 0.92);
  const optimistic = estimatedValue === null ? null : roundMoney(estimatedValue * 1.08);
  const ownedMortgageBalance = applyOwnership(profile.mortgage_balance || 0, ownershipPercentage);
  const estimatedNetEquity = estimatedValue === null
    ? null
    : roundMoney(estimatedValue - ownedMortgageBalance);

  return {
    valuation_date: valuationDate,
    valuation_method: method,
    confidence,
    estimated_value: estimatedValue,
    estimated_net_equity: estimatedNetEquity,
    scenario_conservative: conservative,
    scenario_base: estimatedValue,
    scenario_optimistic: optimistic,
    sources: validSources,
    assumptions: {
      ownership_percentage: ownershipPercentage,
      annual_growth_rate: profile.annual_growth_rate,
      rental_yield_rate: profile.rental_yield_rate,
    },
  };
}

function buildValuationHoldingAmounts(profile) {
  const estimatedValue = positiveMoney(profile.estimated_value);
  const mortgageBalance = positiveMoney(applyOwnership(
    profile.mortgage_balance || 0,
    profile.ownership_percentage || DEFAULT_OWNERSHIP_PERCENTAGE,
  )) || 0;
  const estimatedNetEquity = profile.estimated_net_equity === null || profile.estimated_net_equity === undefined
    ? null
    : positiveMoney(profile.estimated_net_equity);
  const currentValue = mortgageBalance > 0
    ? estimatedNetEquity
    : estimatedValue;

  const ownedPurchasePrice = positiveMoney(applyOwnership(
    profile.purchase_price || profile.estimated_value,
    profile.purchase_price ? profile.ownership_percentage : DEFAULT_OWNERSHIP_PERCENTAGE,
  ));
  const costBasis = mortgageBalance > 0 && ownedPurchasePrice !== null
    ? Math.max(ownedPurchasePrice - mortgageBalance, 0)
    : ownedPurchasePrice;

  return {
    currentValue,
    costBasis: costBasis ?? currentValue,
    valueBasis: mortgageBalance > 0 ? 'net_equity' : 'estimated_value',
  };
}

async function ensureSchema(dbAdapter = database) {
  if (schemaEnsured && dbAdapter === database) return;

  await dbAdapter.query(`
    CREATE TABLE IF NOT EXISTS real_estate_properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL UNIQUE,
      city TEXT,
      neighborhood TEXT,
      property_type TEXT NOT NULL DEFAULT 'apartment',
      rooms REAL,
      square_meters REAL,
      floor REAL,
      total_floors REAL,
      has_elevator INTEGER CHECK (has_elevator IN (0,1) OR has_elevator IS NULL),
      has_parking INTEGER CHECK (has_parking IN (0,1) OR has_parking IS NULL),
      has_balcony INTEGER CHECK (has_balcony IN (0,1) OR has_balcony IS NULL),
      has_storage INTEGER CHECK (has_storage IN (0,1) OR has_storage IS NULL),
      ownership_percentage REAL NOT NULL DEFAULT 100,
      purchase_price REAL,
      purchase_date TEXT,
      mortgage_balance REAL,
      monthly_mortgage_payment REAL,
      mortgage_interest_rate REAL,
      mortgage_term_years REAL,
      monthly_rent REAL,
      annual_expenses REAL,
      price_per_sqm REAL,
      annual_growth_rate REAL,
      rental_yield_rate REAL,
      manual_estimated_value REAL,
      valuation_method TEXT NOT NULL DEFAULT 'blended',
      estimated_value REAL,
      estimated_net_equity REAL,
      confidence TEXT,
      scenario_conservative REAL,
      scenario_base REAL,
      scenario_optimistic REAL,
      assumptions_json TEXT,
      last_valuation_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE
    )
  `);
  await dbAdapter.query('CREATE INDEX IF NOT EXISTS idx_real_estate_properties_account ON real_estate_properties(account_id)');
  await dbAdapter.query('CREATE INDEX IF NOT EXISTS idx_real_estate_properties_city ON real_estate_properties(city)');
  await ensureOptionalColumn(dbAdapter, 'monthly_mortgage_payment REAL');
  await ensureOptionalColumn(dbAdapter, 'mortgage_interest_rate REAL');
  await ensureOptionalColumn(dbAdapter, 'mortgage_term_years REAL');

  if (dbAdapter === database) {
    schemaEnsured = true;
  }
}

async function ensureOptionalColumn(dbAdapter, columnDefinition) {
  try {
    await dbAdapter.query(`ALTER TABLE real_estate_properties ADD COLUMN ${columnDefinition}`);
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (
      message.includes('duplicate column')
      || message.includes('already exists')
      || message.includes('exists')
    ) {
      return;
    }
    throw error;
  }
}

async function verifyRealEstateAccount(accountId, dbAdapter = database) {
  const result = await dbAdapter.query(
    `
      SELECT id, account_name, account_type, currency
      FROM investment_accounts
      WHERE id = $1
      LIMIT 1
    `,
    [accountId],
  );
  const account = result.rows?.[0] || null;
  if (!account) {
    throw serviceError(404, 'Real estate investment account not found');
  }
  if (account.account_type !== 'real_estate') {
    throw serviceError(400, 'Account is not a real estate investment');
  }
  return account;
}

function normalizeProfileRow(row) {
  if (!row) return null;
  return {
    ...row,
    rooms: toNumber(row.rooms),
    square_meters: toNumber(row.square_meters),
    floor: toNumber(row.floor),
    total_floors: toNumber(row.total_floors),
    has_elevator: fromBooleanStorage(row.has_elevator),
    has_parking: fromBooleanStorage(row.has_parking),
    has_balcony: fromBooleanStorage(row.has_balcony),
    has_storage: fromBooleanStorage(row.has_storage),
    ownership_percentage: toNumber(row.ownership_percentage, DEFAULT_OWNERSHIP_PERCENTAGE),
    purchase_price: toNumber(row.purchase_price),
    mortgage_balance: toNumber(row.mortgage_balance),
    monthly_mortgage_payment: toNumber(row.monthly_mortgage_payment),
    mortgage_interest_rate: toNumber(row.mortgage_interest_rate),
    mortgage_term_years: toNumber(row.mortgage_term_years),
    monthly_rent: toNumber(row.monthly_rent),
    annual_expenses: toNumber(row.annual_expenses),
    price_per_sqm: toNumber(row.price_per_sqm),
    annual_growth_rate: toNumber(row.annual_growth_rate),
    rental_yield_rate: toNumber(row.rental_yield_rate),
    manual_estimated_value: toNumber(row.manual_estimated_value),
    estimated_value: toNumber(row.estimated_value),
    estimated_net_equity: toNumber(row.estimated_net_equity),
    scenario_conservative: toNumber(row.scenario_conservative),
    scenario_base: toNumber(row.scenario_base),
    scenario_optimistic: toNumber(row.scenario_optimistic),
    assumptions: row.assumptions_json ? JSON.parse(row.assumptions_json) : null,
  };
}

async function getRealEstateProfile(accountId, dbAdapter = database) {
  const numericAccountId = Number(accountId);
  if (!Number.isFinite(numericAccountId)) {
    throw serviceError(400, 'account_id must be numeric');
  }

  await ensureSchema(dbAdapter);
  await verifyRealEstateAccount(numericAccountId, dbAdapter);

  const result = await dbAdapter.query(
    'SELECT * FROM real_estate_properties WHERE account_id = $1 LIMIT 1',
    [numericAccountId],
  );

  return {
    profile: normalizeProfileRow(result.rows?.[0] || null),
  };
}

async function upsertRealEstateProfile(accountId, payload = {}, dbAdapter = database) {
  const numericAccountId = Number(accountId);
  if (!Number.isFinite(numericAccountId)) {
    throw serviceError(400, 'account_id must be numeric');
  }

  await ensureSchema(dbAdapter);
  const account = await verifyRealEstateAccount(numericAccountId, dbAdapter);
  const profile = normalizeProfilePayload(payload);
  const estimate = estimateRealEstateValue(profile, {
    valuationDate: profile.last_valuation_date,
  });
  const confidence = CONFIDENCE_LEVELS.has(estimate.confidence) ? estimate.confidence : 'low';
  const assumptionsJson = JSON.stringify({
    ...estimate.assumptions,
    sources: estimate.sources,
  });

  const values = [
    numericAccountId,
    profile.city,
    profile.neighborhood,
    profile.property_type,
    profile.rooms,
    profile.square_meters,
    profile.floor,
    profile.total_floors,
    profile.has_elevator,
    profile.has_parking,
    profile.has_balcony,
    profile.has_storage,
    profile.ownership_percentage,
    profile.purchase_price,
    profile.purchase_date,
    profile.mortgage_balance,
    profile.monthly_mortgage_payment,
    profile.mortgage_interest_rate,
    profile.mortgage_term_years,
    profile.monthly_rent,
    profile.annual_expenses,
    profile.price_per_sqm,
    profile.annual_growth_rate,
    profile.rental_yield_rate,
    profile.manual_estimated_value,
    estimate.valuation_method,
    estimate.estimated_value,
    estimate.estimated_net_equity,
    confidence,
    estimate.scenario_conservative,
    estimate.scenario_base,
    estimate.scenario_optimistic,
    assumptionsJson,
    estimate.valuation_date,
  ];

  const result = await dbAdapter.query(
    `
      INSERT INTO real_estate_properties (
        account_id, city, neighborhood, property_type, rooms, square_meters,
        floor, total_floors, has_elevator, has_parking, has_balcony, has_storage,
        ownership_percentage, purchase_price, purchase_date, mortgage_balance,
        monthly_mortgage_payment, mortgage_interest_rate, mortgage_term_years,
        monthly_rent, annual_expenses, price_per_sqm, annual_growth_rate,
        rental_yield_rate, manual_estimated_value, valuation_method, estimated_value,
        estimated_net_equity, confidence, scenario_conservative, scenario_base,
        scenario_optimistic, assumptions_json, last_valuation_date
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22, $23, $24,
        $25, $26, $27, $28,
        $29, $30, $31, $32,
        $33, $34
      )
      ON CONFLICT(account_id) DO UPDATE SET
        city = EXCLUDED.city,
        neighborhood = EXCLUDED.neighborhood,
        property_type = EXCLUDED.property_type,
        rooms = EXCLUDED.rooms,
        square_meters = EXCLUDED.square_meters,
        floor = EXCLUDED.floor,
        total_floors = EXCLUDED.total_floors,
        has_elevator = EXCLUDED.has_elevator,
        has_parking = EXCLUDED.has_parking,
        has_balcony = EXCLUDED.has_balcony,
        has_storage = EXCLUDED.has_storage,
        ownership_percentage = EXCLUDED.ownership_percentage,
        purchase_price = EXCLUDED.purchase_price,
        purchase_date = EXCLUDED.purchase_date,
        mortgage_balance = EXCLUDED.mortgage_balance,
        monthly_mortgage_payment = EXCLUDED.monthly_mortgage_payment,
        mortgage_interest_rate = EXCLUDED.mortgage_interest_rate,
        mortgage_term_years = EXCLUDED.mortgage_term_years,
        monthly_rent = EXCLUDED.monthly_rent,
        annual_expenses = EXCLUDED.annual_expenses,
        price_per_sqm = EXCLUDED.price_per_sqm,
        annual_growth_rate = EXCLUDED.annual_growth_rate,
        rental_yield_rate = EXCLUDED.rental_yield_rate,
        manual_estimated_value = EXCLUDED.manual_estimated_value,
        valuation_method = EXCLUDED.valuation_method,
        estimated_value = EXCLUDED.estimated_value,
        estimated_net_equity = EXCLUDED.estimated_net_equity,
        confidence = EXCLUDED.confidence,
        scenario_conservative = EXCLUDED.scenario_conservative,
        scenario_base = EXCLUDED.scenario_base,
        scenario_optimistic = EXCLUDED.scenario_optimistic,
        assumptions_json = EXCLUDED.assumptions_json,
        last_valuation_date = EXCLUDED.last_valuation_date,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `,
    values,
  );

  return {
    account,
    profile: normalizeProfileRow(result.rows?.[0] || null),
    estimate,
  };
}

async function applyRealEstateValuation(params = {}, dbAdapter = database) {
  const numericAccountId = Number(params.accountId || params.account_id);
  if (!Number.isFinite(numericAccountId)) {
    throw serviceError(400, 'account_id must be numeric');
  }

  await ensureSchema(dbAdapter);
  await verifyRealEstateAccount(numericAccountId, dbAdapter);

  const profileResult = await dbAdapter.query(
    'SELECT * FROM real_estate_properties WHERE account_id = $1 LIMIT 1',
    [numericAccountId],
  );
  const profile = normalizeProfileRow(profileResult.rows?.[0] || null);
  if (!profile || !profile.estimated_value || profile.estimated_value <= 0) {
    throw serviceError(400, 'No real estate estimate is available to apply');
  }

  const asOfDate = normalizeDate(params.asOfDate || params.as_of_date)
    || profile.last_valuation_date
    || new Date().toISOString().split('T')[0];
  const holdingAmounts = buildValuationHoldingAmounts(profile);
  if (holdingAmounts.currentValue === null) {
    throw serviceError(400, 'No real estate estimate is available to apply');
  }

  const holdingResult = await dbAdapter.query(
    `
      INSERT INTO investment_holdings (
        account_id, asset_name, asset_type, current_value, cost_basis,
        as_of_date, notes, holding_type, status
      ) VALUES ($1, $2, 'real_estate', $3, $4, $5, $6, 'standard', 'active')
      ON CONFLICT (account_id, as_of_date) WHERE holding_type = 'standard'
      DO UPDATE SET
        asset_name = EXCLUDED.asset_name,
        asset_type = EXCLUDED.asset_type,
        current_value = EXCLUDED.current_value,
        cost_basis = EXCLUDED.cost_basis,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `,
    [
      numericAccountId,
      profile.city || profile.neighborhood || 'Real estate property',
      holdingAmounts.currentValue,
      holdingAmounts.costBasis,
      asOfDate,
      `Real estate simulator valuation (${holdingAmounts.valueBasis}, ${profile.confidence || 'low'} confidence)`,
    ],
  );

  return {
    profile,
    holding: holdingResult.rows?.[0] || null,
    valuationApplied: holdingAmounts,
  };
}

function safeDivide(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function safePercent(numerator, denominator) {
  const ratio = safeDivide(numerator, denominator);
  return ratio === null ? null : ratio * 100;
}

function buildRealEstateOverviewProperty(row) {
  const profile = normalizeProfileRow(row);
  const ownershipPercentage = profile?.ownership_percentage || DEFAULT_OWNERSHIP_PERCENTAGE;
  const ownershipRatio = ownershipPercentage / 100;
  const estimatedOwnedValue = roundMoney(profile?.estimated_value)
    ?? roundMoney(row.holding_current_value);
  const propertyMarketValue = estimatedOwnedValue === null
    ? null
    : roundMoney(safeDivide(estimatedOwnedValue, ownershipRatio));
  const totalMortgageBalance = roundMoney(profile?.mortgage_balance) || 0;
  const ownedMortgageBalance = roundMoney(applyOwnership(totalMortgageBalance, ownershipPercentage)) || 0;
  const netEquity = profile?.estimated_net_equity === null || profile?.estimated_net_equity === undefined
    ? (estimatedOwnedValue === null ? roundMoney(row.holding_current_value) : roundMoney(estimatedOwnedValue - ownedMortgageBalance))
    : roundMoney(profile.estimated_net_equity);
  const ownedPurchasePrice = profile?.purchase_price === null || profile?.purchase_price === undefined
    ? null
    : roundMoney(applyOwnership(profile.purchase_price, ownershipPercentage));
  const valueChange = estimatedOwnedValue === null || ownedPurchasePrice === null
    ? null
    : roundMoney(estimatedOwnedValue - ownedPurchasePrice);
  const monthlyMortgagePayment = roundMoney(profile?.monthly_mortgage_payment);
  const monthlyRent = roundMoney(profile?.monthly_rent) || 0;
  const monthlyExpenses = roundMoney((profile?.annual_expenses || 0) / 12) || 0;
  const monthlyCashFlow = monthlyMortgagePayment === null && monthlyRent === 0 && monthlyExpenses === 0
    ? null
    : roundMoney(monthlyRent - (monthlyMortgagePayment || 0) - monthlyExpenses);
  const annualDebtService = monthlyMortgagePayment === null ? null : roundMoney(monthlyMortgagePayment * 12);
  const annualRent = monthlyRent * 12;

  return {
    accountId: Number(row.account_id || row.id),
    accountName: row.account_name || 'Real estate property',
    currency: row.currency || 'ILS',
    city: profile?.city || null,
    neighborhood: profile?.neighborhood || null,
    propertyType: profile?.property_type || 'apartment',
    ownershipPercentage,
    propertyMarketValue,
    ownedPropertyValue: estimatedOwnedValue,
    netEquity,
    totalMortgageBalance,
    ownedMortgageBalance,
    monthlyMortgagePayment,
    mortgageInterestRate: profile?.mortgage_interest_rate ?? null,
    mortgageTermYears: profile?.mortgage_term_years ?? null,
    loanToValue: propertyMarketValue === null ? null : safePercent(totalMortgageBalance, propertyMarketValue),
    equityRatio: estimatedOwnedValue === null || netEquity === null
      ? null
      : safePercent(netEquity, estimatedOwnedValue),
    purchasePrice: roundMoney(profile?.purchase_price),
    purchaseDate: profile?.purchase_date || null,
    valueChange,
    valueChangePercent: valueChange === null || ownedPurchasePrice === null
      ? null
      : safePercent(valueChange, ownedPurchasePrice),
    monthlyRent: profile?.monthly_rent ?? null,
    annualExpenses: profile?.annual_expenses ?? null,
    monthlyCashFlow,
    annualDebtService,
    debtServiceCoverage: annualDebtService === null || annualDebtService === 0
      ? null
      : safeDivide(annualRent, annualDebtService),
    valuationMethod: profile?.valuation_method || null,
    confidence: profile?.confidence || null,
    lastValuationDate: profile?.last_valuation_date || row.holding_as_of_date || null,
    scenarioConservative: profile?.scenario_conservative ?? null,
    scenarioBase: profile?.scenario_base ?? null,
    scenarioOptimistic: profile?.scenario_optimistic ?? null,
    hasProfile: Boolean(row.profile_id),
  };
}

function summarizeOverview(properties) {
  const totals = properties.reduce((summary, property) => {
    summary.propertyMarketValue += property.propertyMarketValue || 0;
    summary.ownedPropertyValue += property.ownedPropertyValue || 0;
    summary.netEquity += property.netEquity || 0;
    summary.totalMortgageBalance += property.totalMortgageBalance || 0;
    summary.ownedMortgageBalance += property.ownedMortgageBalance || 0;
    summary.monthlyMortgagePayment += property.monthlyMortgagePayment || 0;
    summary.monthlyRent += property.monthlyRent || 0;
    summary.monthlyCashFlow += property.monthlyCashFlow || 0;
    if (!property.hasProfile) {
      summary.missingProfiles += 1;
    }
    return summary;
  }, {
    propertyCount: properties.length,
    propertyMarketValue: 0,
    ownedPropertyValue: 0,
    netEquity: 0,
    totalMortgageBalance: 0,
    ownedMortgageBalance: 0,
    monthlyMortgagePayment: 0,
    monthlyRent: 0,
    monthlyCashFlow: 0,
    missingProfiles: 0,
  });

  return {
    ...totals,
    averageLoanToValue: totals.propertyMarketValue > 0
      ? (totals.totalMortgageBalance / totals.propertyMarketValue) * 100
      : null,
    equityRatio: totals.ownedPropertyValue > 0
      ? (totals.netEquity / totals.ownedPropertyValue) * 100
      : null,
  };
}

async function getRealEstateOverview(dbAdapter = database) {
  await ensureSchema(dbAdapter);

  const activeValue = dialect.useSqlite ? 1 : true;
  const result = await dbAdapter.query(
    `
      SELECT
        ia.id AS account_id,
        ia.account_name,
        ia.currency,
        rep.id AS profile_id,
        rep.city,
        rep.neighborhood,
        rep.property_type,
        rep.rooms,
        rep.square_meters,
        rep.floor,
        rep.total_floors,
        rep.has_elevator,
        rep.has_parking,
        rep.has_balcony,
        rep.has_storage,
        rep.ownership_percentage,
        rep.purchase_price,
        rep.purchase_date,
        rep.mortgage_balance,
        rep.monthly_mortgage_payment,
        rep.mortgage_interest_rate,
        rep.mortgage_term_years,
        rep.monthly_rent,
        rep.annual_expenses,
        rep.price_per_sqm,
        rep.annual_growth_rate,
        rep.rental_yield_rate,
        rep.manual_estimated_value,
        rep.valuation_method,
        rep.estimated_value,
        rep.estimated_net_equity,
        rep.confidence,
        rep.scenario_conservative,
        rep.scenario_base,
        rep.scenario_optimistic,
        rep.assumptions_json,
        rep.last_valuation_date,
        ih.current_value AS holding_current_value,
        ih.cost_basis AS holding_cost_basis,
        ih.as_of_date AS holding_as_of_date
      FROM investment_accounts ia
      LEFT JOIN real_estate_properties rep
        ON rep.account_id = ia.id
      LEFT JOIN investment_holdings ih
        ON ih.id = (
          SELECT ih2.id
          FROM investment_holdings ih2
          WHERE ih2.account_id = ia.id
            AND COALESCE(ih2.holding_type, 'standard') = 'standard'
          ORDER BY ih2.as_of_date DESC, ih2.id DESC
          LIMIT 1
        )
      WHERE ia.is_active = $1
        AND ia.account_type = 'real_estate'
      ORDER BY ia.account_name ASC
    `,
    [activeValue],
  );

  const properties = (result.rows || []).map(buildRealEstateOverviewProperty);

  return {
    generatedAt: new Date().toISOString(),
    valuationSource: 'manual_simulator',
    marketCompsAvailable: false,
    summary: summarizeOverview(properties),
    properties,
  };
}

module.exports = {
  estimateRealEstateValue,
  buildValuationHoldingAmounts,
  getRealEstateProfile,
  upsertRealEstateProfile,
  applyRealEstateValuation,
  getRealEstateOverview,
  ensureSchema,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
    schemaEnsured = false;
  },
  __resetDatabase() {
    database = actualDatabase;
    schemaEnsured = false;
  },
};

module.exports.default = module.exports;
