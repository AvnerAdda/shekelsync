const actualDatabase = require('../database.js');
let database = actualDatabase;
const {
  INSTITUTION_SELECT_FIELDS,
  buildInstitutionFromRow,
  getInstitutionByVendorCode,
} = require('../institutions.js');

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function parseOptionalNumber(value, fieldName, options = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return options.allowNull === false ? 0 : null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw serviceError(400, `${fieldName} must be a finite number`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw serviceError(400, `${fieldName} must be at least ${options.min}`);
  }
  return parsed;
}

function normalizeCurrency(value, fallback = 'USD') {
  const currency = String(value || fallback).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw serviceError(400, 'currency must be a three-letter ISO currency code');
  }
  return currency;
}

function normalizeDate(value) {
  if (!value) return null;
  const candidate = typeof value === 'string'
    ? value.split('T')[0]
    : new Date(value).toISOString().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw serviceError(400, 'valuation_date must be a valid date');
  }
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().split('T')[0] !== candidate) {
    throw serviceError(400, 'valuation_date must be a valid date');
  }
  return candidate;
}

function normalizeAsset(row) {
  if (!row) return null;

  const units = row.units === null || row.units === undefined ? null : Number(row.units);
  const averageCost = row.average_cost === null || row.average_cost === undefined
    ? null
    : Number(row.average_cost);
  const currentPrice = row.current_price === null || row.current_price === undefined
    ? (row.asset_type === 'cash' ? 1 : null)
    : Number(row.current_price);
  const storedCurrentValue = row.current_value === null || row.current_value === undefined
    ? null
    : Number(row.current_value);
  const storedCostBasis = row.cost_basis === null || row.cost_basis === undefined
    ? null
    : Number(row.cost_basis);
  const currentValue = storedCurrentValue
    ?? (units !== null && currentPrice !== null ? units * currentPrice : null);
  const costBasis = storedCostBasis
    ?? (units !== null && averageCost !== null
      ? units * averageCost
      : row.asset_type === 'cash' ? units : null);
  const valuationDate = row.valuation_date || null;

  return {
    ...row,
    asset_symbol: row.asset_symbol || null,
    symbol: row.asset_symbol || null,
    name: row.asset_name,
    units,
    quantity: units,
    average_cost: averageCost,
    avg_price: averageCost,
    current_price: currentPrice,
    price: currentPrice,
    current_value: currentValue,
    market_value: currentValue,
    cost_basis: costBasis,
    valuation_date: valuationDate,
    as_of_date: valuationDate,
  };
}

async function listAssets(params = {}) {
  const accountId = params.accountId || params.account_id;
  const includeInactive = params.includeInactive === 'true'
    || params.includeInactive === true
    || params.include_inactive === 'true'
    || params.include_inactive === true;

  const filters = [];
  const values = [];

  if (accountId) {
    filters.push(`iasset.account_id = $${values.length + 1}`);
    values.push(accountId);
  }

  if (!includeInactive) {
    filters.push('iasset.is_active = true');
    filters.push('ia.is_active = true');
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await database.query(
    `
      SELECT
        iasset.*,
        ia.account_name,
        ia.account_type,
        ia.institution,
        ${INSTITUTION_SELECT_FIELDS}
      FROM investment_assets iasset
      JOIN investment_accounts ia ON iasset.account_id = ia.id
      LEFT JOIN institution_nodes fi ON ia.institution_id = fi.id AND fi.node_type = 'institution'
      ${whereClause}
      ORDER BY ia.account_name, iasset.asset_name
    `,
    values,
  );

  const assets = await Promise.all(
    (result.rows || []).map(async (row) => {
      let institution = buildInstitutionFromRow(row);
      if (!institution && row.account_type) {
        institution = await getInstitutionByVendorCode(database, row.account_type);
      }

      return normalizeAsset({
        ...row,
        institution: institution || null,
      });
    }),
  );

  return { assets, history: [] };
}

async function verifyAccount(accountId) {
  const checkResult = await database.query(
    'SELECT id, currency FROM investment_accounts WHERE id = $1 AND is_active = true',
    [accountId],
  );

  if (!checkResult.rows.length) {
    throw serviceError(404, 'Active account not found');
  }
  return checkResult.rows[0];
}

function normalizeCreatePayload(payload, accountCurrency) {
  const assetSymbol = firstDefined(payload.asset_symbol, payload.symbol) || null;
  const assetName = firstDefined(payload.asset_name, payload.name, assetSymbol);
  const units = parseOptionalNumber(firstDefined(payload.units, payload.quantity), 'units', { min: 0 });
  if (!assetName || !String(assetName).trim() || units === undefined || units === null) {
    throw serviceError(400, 'account_id, asset_name (or symbol), and units (or quantity) are required');
  }

  const averageCost = parseOptionalNumber(
    firstDefined(payload.average_cost, payload.avg_price),
    'average_cost',
    { min: 0 },
  );
  let currentPrice = parseOptionalNumber(
    firstDefined(payload.current_price, payload.price),
    'current_price',
    { min: 0 },
  );
  if ((currentPrice === undefined || currentPrice === null) && payload.asset_type === 'cash') {
    currentPrice = 1;
  }
  const explicitCurrentValue = parseOptionalNumber(
    firstDefined(payload.current_value, payload.market_value),
    'current_value',
    { min: 0 },
  );
  const explicitCostBasis = parseOptionalNumber(payload.cost_basis, 'cost_basis', { min: 0 });
  const currentValue = explicitCurrentValue
    ?? (currentPrice !== undefined && currentPrice !== null ? units * currentPrice : null);
  const costBasis = explicitCostBasis
    ?? (averageCost !== undefined && averageCost !== null
      ? units * averageCost
      : payload.asset_type === 'cash' ? units : null);
  const valuationInput = firstDefined(payload.valuation_date, payload.as_of_date);

  return {
    accountId: payload.account_id,
    assetSymbol,
    assetName: String(assetName).trim(),
    assetType: payload.asset_type || null,
    units,
    averageCost: averageCost ?? null,
    currentPrice: currentPrice ?? null,
    currentValue,
    costBasis,
    valuationDate: valuationInput
      ? normalizeDate(valuationInput)
      : (currentValue === null ? null : new Date().toISOString().split('T')[0]),
    currency: normalizeCurrency(payload.currency, accountCurrency),
    notes: payload.notes || null,
  };
}

async function createAsset(payload = {}) {
  if (!payload.account_id) {
    throw serviceError(400, 'account_id, asset_name (or symbol), and units (or quantity) are required');
  }

  const account = await verifyAccount(payload.account_id);
  const normalized = normalizeCreatePayload(payload, account.currency || 'USD');
  const insertResult = await database.query(
    `
      INSERT INTO investment_assets (
        account_id, asset_symbol, asset_name, asset_type,
        units, average_cost, current_price, current_value, cost_basis,
        valuation_date, currency, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `,
    [
      normalized.accountId,
      normalized.assetSymbol,
      normalized.assetName,
      normalized.assetType,
      normalized.units,
      normalized.averageCost,
      normalized.currentPrice,
      normalized.currentValue,
      normalized.costBasis,
      normalized.valuationDate,
      normalized.currency,
      normalized.notes,
    ],
  );

  return { asset: normalizeAsset(insertResult.rows[0]) };
}

async function updateAsset(payload = {}) {
  const id = payload.id || payload.asset_id;
  if (!id) throw serviceError(400, 'Asset id is required');

  const recognizedFields = [
    'asset_symbol', 'symbol', 'asset_name', 'name', 'asset_type', 'units', 'quantity',
    'average_cost', 'avg_price', 'current_price', 'price', 'current_value', 'market_value',
    'cost_basis', 'valuation_date', 'as_of_date', 'currency', 'notes', 'is_active',
  ];
  if (!recognizedFields.some((field) => hasOwn(payload, field))) {
    throw serviceError(400, 'No fields to update');
  }

  const existingResult = await database.query(
    'SELECT * FROM investment_assets WHERE id = $1 LIMIT 1',
    [id],
  );
  if (!existingResult.rows.length) throw serviceError(404, 'Asset not found');
  const existing = normalizeAsset(existingResult.rows[0]);

  const nameInput = firstDefined(payload.asset_name, payload.name);
  const assetName = nameInput === undefined ? existing.asset_name : String(nameInput).trim();
  if (!assetName) throw serviceError(400, 'asset_name cannot be empty');

  const unitsInput = parseOptionalNumber(firstDefined(payload.units, payload.quantity), 'units', { min: 0 });
  const averageCostInput = parseOptionalNumber(firstDefined(payload.average_cost, payload.avg_price), 'average_cost', { min: 0 });
  const currentPriceInput = parseOptionalNumber(firstDefined(payload.current_price, payload.price), 'current_price', { min: 0 });
  const currentValueInput = parseOptionalNumber(firstDefined(payload.current_value, payload.market_value), 'current_value', { min: 0 });
  const costBasisInput = parseOptionalNumber(payload.cost_basis, 'cost_basis', { min: 0 });

  const units = unitsInput === undefined ? existing.units : unitsInput;
  const averageCost = averageCostInput === undefined ? existing.average_cost : averageCostInput;
  const currentPrice = currentPriceInput === undefined ? existing.current_price : currentPriceInput;
  const currentValue = currentValueInput !== undefined
    ? currentValueInput
    : (unitsInput !== undefined || currentPriceInput !== undefined) && currentPrice !== null
      ? units * currentPrice
      : existing.current_value;
  const costBasis = costBasisInput !== undefined
    ? costBasisInput
    : (unitsInput !== undefined || averageCostInput !== undefined) && averageCost !== null
      ? units * averageCost
      : existing.cost_basis;
  const valuationInput = firstDefined(payload.valuation_date, payload.as_of_date);
  const valuationDate = valuationInput !== undefined
    ? normalizeDate(valuationInput)
    : currentValueInput !== undefined || currentPriceInput !== undefined
      ? new Date().toISOString().split('T')[0]
      : existing.valuation_date;

  const result = await database.query(
    `
      UPDATE investment_assets
      SET asset_symbol = $1,
          asset_name = $2,
          asset_type = $3,
          units = $4,
          average_cost = $5,
          current_price = $6,
          current_value = $7,
          cost_basis = $8,
          valuation_date = $9,
          currency = $10,
          notes = $11,
          is_active = $12,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $13
      RETURNING *
    `,
    [
      firstDefined(payload.asset_symbol, payload.symbol, existing.asset_symbol) || null,
      assetName,
      hasOwn(payload, 'asset_type') ? payload.asset_type || null : existing.asset_type,
      units,
      averageCost,
      currentPrice,
      currentValue,
      costBasis,
      valuationDate,
      hasOwn(payload, 'currency') ? normalizeCurrency(payload.currency) : existing.currency,
      hasOwn(payload, 'notes') ? payload.notes || null : existing.notes,
      hasOwn(payload, 'is_active') ? Boolean(payload.is_active) : Boolean(existing.is_active),
      id,
    ],
  );

  return { asset: normalizeAsset(result.rows[0]) };
}

async function deactivateAsset(params = {}) {
  const id = params.id || params.asset_id;
  if (!id) throw serviceError(400, 'Asset id is required');

  const result = await database.query(
    `
      UPDATE investment_assets
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `,
    [id],
  );
  if (!result.rows.length) throw serviceError(404, 'Asset not found');

  return {
    message: 'Asset deactivated',
    asset: normalizeAsset(result.rows[0]),
  };
}

module.exports = {
  listAssets,
  createAsset,
  updateAsset,
  deactivateAsset,
  __test: {
    normalizeAsset,
    normalizeCreatePayload,
  },
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
