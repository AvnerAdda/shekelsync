const actualDatabase = require('../database.js');
const {
  INSTITUTION_SELECT_FIELDS,
  buildInstitutionFromRow,
  getInstitutionByVendorCode,
} = require('../institutions.js');

let database = actualDatabase;
let schemaEnsured = false;

const VALID_EVENT_TYPES = new Set([
  'deposit',
  'buy',
  'sell',
  'capital_return',
  'dividend',
  'interest',
  'fee',
  'tax',
  'valuation',
  'rollover',
]);

const VALID_CLOSE_ACTIONS = new Set(['keep_open', 'partial_close', 'full_close']);
const BASIS_REDUCTION_EVENT_TYPES = new Set(['sell', 'capital_return', 'rollover']);

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

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  throw serviceError(400, 'Boolean event fields must be true or false');
}

function normalizeCurrency(value, fallback = 'ILS') {
  const currency = String(value || fallback).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw serviceError(400, 'currency must be a three-letter ISO currency code');
  }
  return currency;
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString().split('T')[0];

  const candidate = typeof value === 'string'
    ? value.split('T')[0]
    : new Date(value).toISOString().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw serviceError(400, 'effective_date must be a valid date');
  }

  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().split('T')[0] !== candidate) {
    throw serviceError(400, 'effective_date must be a valid date');
  }
  return candidate;
}

function normalizePosition(row) {
  if (!row) return null;

  const units = row.units === null || row.units === undefined ? 0 : toNumber(row.units);
  const averageCost = row.average_cost === null || row.average_cost === undefined
    ? null
    : toNumber(row.average_cost);
  const currentPrice = row.current_price === null || row.current_price === undefined
    ? null
    : toNumber(row.current_price);
  const currentValue = row.current_value === null || row.current_value === undefined
    ? null
    : toNumber(row.current_value);

  return {
    ...row,
    asset_symbol: row.asset_symbol || null,
    symbol: row.asset_symbol || null,
    units,
    average_cost: averageCost,
    current_price: currentPrice,
    original_cost_basis: toNumber(row.original_cost_basis),
    open_cost_basis: toNumber(row.open_cost_basis),
    cost_basis: toNumber(row.open_cost_basis),
    current_value: currentValue,
    valuation_date: row.valuation_date || null,
    source: row.source || 'manual',
    legacy_asset_id: row.legacy_asset_id === null || row.legacy_asset_id === undefined
      ? null
      : Number(row.legacy_asset_id),
  };
}

function normalizeEvent(row) {
  if (!row) return null;

  const numericFields = [
    'amount',
    'principal_amount',
    'income_amount',
    'fee_amount',
    'units',
    'current_value',
    'current_price',
    'proceeds_amount',
    'disposed_cost_basis',
    'tax_amount',
    'realized_gain_loss',
  ];
  const normalized = { ...row };
  numericFields.forEach((field) => {
    normalized[field] = row[field] === null || row[field] === undefined
      ? null
      : toNumber(row[field]);
  });
  normalized.reinvested = Boolean(row.reinvested);
  normalized.deducted_from_position = Boolean(row.deducted_from_position);

  if (typeof row.metadata === 'string') {
    try {
      normalized.metadata = JSON.parse(row.metadata);
    } catch (_error) {
      // Preserve non-JSON legacy metadata verbatim.
    }
  }
  return normalized;
}

async function ensureLinkedTransactionUniqueIndex() {
  const duplicateResult = await database.query(`
    SELECT duplicate_event.id
    FROM investment_position_events duplicate_event
    WHERE duplicate_event.linked_transaction_identifier IS NOT NULL
      AND duplicate_event.linked_transaction_vendor IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM investment_position_events canonical_event
        WHERE canonical_event.linked_transaction_identifier = duplicate_event.linked_transaction_identifier
          AND canonical_event.linked_transaction_vendor = duplicate_event.linked_transaction_vendor
          AND canonical_event.id < duplicate_event.id
      )
    ORDER BY duplicate_event.id
  `);
  const excludedIds = (duplicateResult?.rows || [])
    .map((row) => Number(row?.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  const legacyDuplicatePredicate = excludedIds.length > 0
    ? `AND id NOT IN (${excludedIds.join(', ')})`
    : '';

  await database.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_position_events_linked_transaction_unique
    ON investment_position_events(
      linked_transaction_identifier,
      linked_transaction_vendor
    )
    WHERE linked_transaction_identifier IS NOT NULL
      AND linked_transaction_vendor IS NOT NULL
      ${legacyDuplicatePredicate}
  `);
  await database.query(`
    CREATE TRIGGER IF NOT EXISTS trg_position_event_link_unique_insert
    BEFORE INSERT ON investment_position_events
    WHEN NEW.linked_transaction_identifier IS NOT NULL
      AND NEW.linked_transaction_vendor IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM investment_position_events existing_event
        WHERE existing_event.linked_transaction_identifier = NEW.linked_transaction_identifier
          AND existing_event.linked_transaction_vendor = NEW.linked_transaction_vendor
      )
    BEGIN
      SELECT RAISE(ABORT, 'position event transaction link already exists');
    END
  `);
  await database.query(`
    CREATE TRIGGER IF NOT EXISTS trg_position_event_link_unique_update
    BEFORE UPDATE OF linked_transaction_identifier, linked_transaction_vendor
    ON investment_position_events
    WHEN NEW.linked_transaction_identifier IS NOT NULL
      AND NEW.linked_transaction_vendor IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM investment_position_events existing_event
        WHERE existing_event.linked_transaction_identifier = NEW.linked_transaction_identifier
          AND existing_event.linked_transaction_vendor = NEW.linked_transaction_vendor
          AND existing_event.id <> OLD.id
      )
    BEGIN
      SELECT RAISE(ABORT, 'position event transaction link already exists');
    END
  `);
}

async function ensureSchema() {
  if (schemaEnsured) return;

  await database.query(`
    CREATE TABLE IF NOT EXISTS investment_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      position_name TEXT NOT NULL,
      asset_symbol TEXT,
      asset_type TEXT,
      currency TEXT NOT NULL DEFAULT 'ILS',
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      units REAL NOT NULL DEFAULT 0,
      average_cost REAL,
      current_price REAL,
      valuation_date TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      legacy_asset_id INTEGER,
      original_cost_basis REAL NOT NULL DEFAULT 0,
      open_cost_basis REAL NOT NULL DEFAULT 0,
      current_value REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE
    )
  `);
  await database.query(`
    CREATE TABLE IF NOT EXISTS investment_position_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      amount REAL,
      principal_amount REAL,
      income_amount REAL,
      fee_amount REAL,
      tax_amount REAL,
      proceeds_amount REAL,
      disposed_cost_basis REAL,
      realized_gain_loss REAL,
      reinvested INTEGER NOT NULL DEFAULT 0,
      deducted_from_position INTEGER NOT NULL DEFAULT 0,
      units REAL,
      current_value REAL,
      current_price REAL,
      close_action TEXT,
      linked_transaction_identifier TEXT,
      linked_transaction_vendor TEXT,
      notes TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (position_id) REFERENCES investment_positions(id) ON DELETE CASCADE,
      FOREIGN KEY (linked_transaction_identifier, linked_transaction_vendor)
        REFERENCES transactions(identifier, vendor)
        ON DELETE SET NULL
    )
  `);
  await database.query('CREATE INDEX IF NOT EXISTS idx_investment_positions_account ON investment_positions(account_id, status)');
  await database.query('CREATE INDEX IF NOT EXISTS idx_investment_positions_status ON investment_positions(status, opened_at DESC)');
  await database.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_positions_legacy_asset ON investment_positions(legacy_asset_id) WHERE legacy_asset_id IS NOT NULL');
  await database.query('CREATE INDEX IF NOT EXISTS idx_investment_position_events_position ON investment_position_events(position_id, effective_date DESC)');
  await ensureLinkedTransactionUniqueIndex();

  schemaEnsured = true;
}

async function getQueryClient() {
  if (typeof database.getClient === 'function') {
    return database.getClient();
  }
  return {
    query: (...args) => database.query(...args),
    release: () => {},
  };
}

async function getPositionById(client, id) {
  const result = await client.query(
    `
      SELECT ip.*, ia.account_name
      FROM investment_positions ip
      JOIN investment_accounts ia ON ia.id = ip.account_id
      WHERE ip.id = $1
      LIMIT 1
    `,
    [id],
  );

  return normalizePosition(result.rows?.[0]);
}

async function verifyAccountExists(client, accountId) {
  const result = await client.query(
    'SELECT id, currency FROM investment_accounts WHERE id = $1 AND is_active = true LIMIT 1',
    [accountId],
  );
  if (!result.rows?.length) {
    throw serviceError(404, 'Active investment account not found');
  }
  return result.rows[0];
}

function normalizePositionInput(payload = {}, accountCurrency = 'ILS', options = {}) {
  const name = firstDefined(payload.position_name, payload.asset_name, payload.name);
  if (!name || !String(name).trim()) {
    throw serviceError(400, 'position_name is required');
  }

  const units = parseOptionalNumber(
    firstDefined(payload.units, payload.quantity),
    'units',
    { min: 0 },
  );
  const averageCost = parseOptionalNumber(
    firstDefined(payload.average_cost, payload.avg_price),
    'average_cost',
    { min: 0 },
  );
  const currentPrice = parseOptionalNumber(
    firstDefined(payload.current_price, payload.price),
    'current_price',
    { min: 0 },
  );
  const explicitCostBasis = parseOptionalNumber(
    firstDefined(payload.open_cost_basis, payload.cost_basis),
    'open_cost_basis',
    { min: 0 },
  );
  const originalCostBasis = parseOptionalNumber(
    payload.original_cost_basis,
    'original_cost_basis',
    { min: 0 },
  );
  const explicitCurrentValue = parseOptionalNumber(
    firstDefined(payload.current_value, payload.market_value),
    'current_value',
    { min: 0 },
  );

  const normalizedUnits = units ?? 0;
  const openCostBasis = explicitCostBasis
    ?? (averageCost !== null && averageCost !== undefined ? normalizedUnits * averageCost : 0);
  const currentValue = explicitCurrentValue
    ?? (currentPrice !== null && currentPrice !== undefined ? normalizedUnits * currentPrice : null);

  return {
    accountId: payload.account_id,
    positionName: String(name).trim(),
    assetSymbol: firstDefined(payload.asset_symbol, payload.symbol) || null,
    assetType: payload.asset_type || null,
    currency: normalizeCurrency(payload.currency, accountCurrency),
    openedAt: normalizeDate(firstDefined(payload.opened_at, payload.effective_date, payload.valuation_date, payload.as_of_date)),
    units: normalizedUnits,
    averageCost: averageCost ?? null,
    currentPrice: currentPrice ?? null,
    valuationDate: firstDefined(payload.valuation_date, payload.as_of_date)
      ? normalizeDate(firstDefined(payload.valuation_date, payload.as_of_date))
      : (currentValue === null ? null : normalizeDate(options.defaultDate)),
    source: String(payload.source || 'manual'),
    legacyAssetId: parseOptionalNumber(payload.legacy_asset_id, 'legacy_asset_id', { min: 1 }) ?? null,
    originalCostBasis: originalCostBasis ?? openCostBasis,
    openCostBasis,
    currentValue,
    notes: payload.notes || null,
  };
}

async function insertPosition(client, normalized) {
  const result = await client.query(
    `
      INSERT INTO investment_positions (
        account_id,
        position_name,
        asset_symbol,
        asset_type,
        currency,
        status,
        opened_at,
        units,
        average_cost,
        current_price,
        valuation_date,
        source,
        legacy_asset_id,
        original_cost_basis,
        open_cost_basis,
        current_value,
        notes
      ) VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `,
    [
      normalized.accountId,
      normalized.positionName,
      normalized.assetSymbol,
      normalized.assetType,
      normalized.currency,
      normalized.openedAt,
      normalized.units,
      normalized.averageCost,
      normalized.currentPrice,
      normalized.valuationDate,
      normalized.source,
      normalized.legacyAssetId,
      normalized.originalCostBasis,
      normalized.openCostBasis,
      normalized.currentValue,
      normalized.notes,
    ],
  );

  return normalizePosition(result.rows?.[0]);
}

async function createPosition(payload = {}) {
  await ensureSchema();
  if (!payload.account_id) {
    throw serviceError(400, 'account_id is required');
  }

  const client = await getQueryClient();
  try {
    await client.query('BEGIN');
    const account = await verifyAccountExists(client, payload.account_id);
    const normalized = normalizePositionInput(payload, account.currency, {
      defaultDate: payload.valuation_date || payload.as_of_date || payload.opened_at,
    });
    const position = await insertPosition(client, normalized);
    await client.query('COMMIT');
    return { position };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release?.();
  }
}

async function updatePosition(payload = {}) {
  await ensureSchema();
  const id = payload.id || payload.position_id;
  if (!id) throw serviceError(400, 'Position id is required');

  const recognizedFields = [
    'position_name', 'asset_name', 'name', 'asset_symbol', 'symbol', 'asset_type',
    'currency', 'units', 'quantity', 'average_cost', 'avg_price', 'current_price',
    'price', 'valuation_date', 'as_of_date', 'source', 'notes', 'current_value',
    'market_value', 'cost_basis', 'open_cost_basis', 'original_cost_basis',
  ];
  if (!recognizedFields.some((field) => hasOwn(payload, field))) {
    throw serviceError(400, 'No fields to update');
  }

  const client = await getQueryClient();
  try {
    await client.query('BEGIN');
    const existing = await getPositionById(client, id);
    if (!existing) throw serviceError(404, 'Investment position not found');

    const positionNameInput = firstDefined(payload.position_name, payload.asset_name, payload.name);
    const positionName = positionNameInput === undefined
      ? existing.position_name
      : String(positionNameInput).trim();
    if (!positionName) throw serviceError(400, 'position_name cannot be empty');

    const unitsInput = parseOptionalNumber(firstDefined(payload.units, payload.quantity), 'units', { min: 0 });
    const averageCostInput = parseOptionalNumber(firstDefined(payload.average_cost, payload.avg_price), 'average_cost', { min: 0 });
    const currentPriceInput = parseOptionalNumber(firstDefined(payload.current_price, payload.price), 'current_price', { min: 0 });
    const currentValueInput = parseOptionalNumber(firstDefined(payload.current_value, payload.market_value), 'current_value', { min: 0 });
    const openBasisInput = parseOptionalNumber(firstDefined(payload.open_cost_basis, payload.cost_basis), 'open_cost_basis', { min: 0 });
    const originalBasisInput = parseOptionalNumber(payload.original_cost_basis, 'original_cost_basis', { min: 0 });

    const units = unitsInput === undefined ? existing.units : unitsInput;
    const averageCost = averageCostInput === undefined ? existing.average_cost : averageCostInput;
    const currentPrice = currentPriceInput === undefined ? existing.current_price : currentPriceInput;
    const shouldRecalculateBasis = unitsInput !== undefined || averageCostInput !== undefined;
    const openCostBasis = openBasisInput !== undefined
      ? (openBasisInput ?? 0)
      : shouldRecalculateBasis && averageCost !== null
        ? units * averageCost
        : existing.open_cost_basis;
    const originalCostBasis = originalBasisInput !== undefined
      ? (originalBasisInput ?? 0)
      : hasOwn(payload, 'cost_basis')
        ? openCostBasis
        : existing.original_cost_basis;
    const shouldRecalculateValue = unitsInput !== undefined || currentPriceInput !== undefined;
    const currentValue = currentValueInput !== undefined
      ? currentValueInput
      : shouldRecalculateValue && currentPrice !== null
        ? units * currentPrice
        : existing.current_value;
    const valuationInput = firstDefined(payload.valuation_date, payload.as_of_date);
    const valuationDate = valuationInput !== undefined
      ? (valuationInput ? normalizeDate(valuationInput) : null)
      : (currentValueInput !== undefined || currentPriceInput !== undefined
          ? normalizeDate()
          : existing.valuation_date);

    const result = await client.query(
      `
        UPDATE investment_positions
        SET position_name = $1,
            asset_symbol = $2,
            asset_type = $3,
            currency = $4,
            units = $5,
            average_cost = $6,
            current_price = $7,
            valuation_date = $8,
            source = $9,
            notes = $10,
            original_cost_basis = $11,
            open_cost_basis = $12,
            current_value = $13,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $14
        RETURNING *
      `,
      [
        positionName,
        firstDefined(payload.asset_symbol, payload.symbol, existing.asset_symbol) || null,
        hasOwn(payload, 'asset_type') ? payload.asset_type || null : existing.asset_type,
        hasOwn(payload, 'currency') ? normalizeCurrency(payload.currency) : existing.currency,
        units,
        averageCost,
        currentPrice,
        valuationDate,
        hasOwn(payload, 'source') ? String(payload.source || 'manual') : existing.source,
        hasOwn(payload, 'notes') ? payload.notes || null : existing.notes,
        originalCostBasis,
        openCostBasis,
        currentValue,
        id,
      ],
    );

    await client.query('COMMIT');
    return { position: normalizePosition(result.rows?.[0]) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release?.();
  }
}

async function deactivatePosition(params = {}) {
  await ensureSchema();
  const id = params.id || params.position_id;
  if (!id) throw serviceError(400, 'Position id is required');

  const closedAt = normalizeDate(params.closed_at || params.effective_date);
  const result = await database.query(
    `
      UPDATE investment_positions
      SET status = 'closed', closed_at = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `,
    [closedAt, id],
  );
  if (!result.rows?.length) throw serviceError(404, 'Investment position not found');

  return {
    message: 'Position deactivated',
    position: normalizePosition(result.rows[0]),
  };
}

function normalizeEventInputs(position, payload) {
  const eventType = String(payload.event_type || '').toLowerCase();
  const amount = parseOptionalNumber(payload.amount, 'amount', { min: 0 });
  let principalAmount = parseOptionalNumber(payload.principal_amount, 'principal_amount', { min: 0 });
  let incomeAmount = parseOptionalNumber(payload.income_amount, 'income_amount', { min: 0 });
  let feeAmount = parseOptionalNumber(payload.fee_amount, 'fee_amount', { min: 0 });
  let taxAmount = parseOptionalNumber(payload.tax_amount, 'tax_amount', { min: 0 });
  let proceedsAmount = parseOptionalNumber(payload.proceeds_amount, 'proceeds_amount', { min: 0 });
  let disposedCostBasis = parseOptionalNumber(payload.disposed_cost_basis, 'disposed_cost_basis', { min: 0 });
  let realizedGainLoss = parseOptionalNumber(payload.realized_gain_loss, 'realized_gain_loss');
  const unitsInput = parseOptionalNumber(payload.units, 'units', { min: 0 });
  const currentValueInput = parseOptionalNumber(payload.current_value, 'current_value', { min: 0 });
  const currentPriceInput = parseOptionalNumber(payload.current_price, 'current_price', { min: 0 });
  const reinvested = parseBoolean(payload.reinvested, false);
  const deductedFromPosition = parseBoolean(payload.deducted_from_position, false);

  if (eventType === 'deposit' || eventType === 'buy') {
    principalAmount = principalAmount ?? amount ?? 0;
  } else if (eventType === 'dividend' || eventType === 'interest') {
    incomeAmount = incomeAmount ?? amount ?? 0;
  } else if (eventType === 'fee') {
    feeAmount = feeAmount ?? amount ?? 0;
  } else if (eventType === 'tax') {
    taxAmount = taxAmount ?? amount ?? 0;
  } else if (BASIS_REDUCTION_EVENT_TYPES.has(eventType)) {
    proceedsAmount = proceedsAmount ?? amount;
    disposedCostBasis = disposedCostBasis ?? principalAmount;
    if (proceedsAmount === undefined || proceedsAmount === null) {
      throw serviceError(400, `${eventType} requires proceeds_amount (or legacy amount)`);
    }
    if (disposedCostBasis === undefined || disposedCostBasis === null) {
      throw serviceError(400, `${eventType} requires disposed_cost_basis (or legacy principal_amount)`);
    }
    if (disposedCostBasis > toNumber(position.open_cost_basis) + 0.000001) {
      throw serviceError(400, 'disposed_cost_basis cannot exceed the open cost basis');
    }
    realizedGainLoss = realizedGainLoss
      ?? proceedsAmount - disposedCostBasis - (feeAmount ?? 0) - (taxAmount ?? 0);
  }

  return {
    eventType,
    amount: amount ?? null,
    principalAmount: principalAmount ?? 0,
    incomeAmount: incomeAmount ?? 0,
    feeAmount: feeAmount ?? 0,
    taxAmount: taxAmount ?? 0,
    proceedsAmount: proceedsAmount ?? null,
    disposedCostBasis: disposedCostBasis ?? 0,
    realizedGainLoss: realizedGainLoss ?? null,
    unitsInput,
    currentValueInput,
    currentPriceInput,
    reinvested,
    deductedFromPosition,
  };
}

function computePositionUpdate(position, payload) {
  const input = normalizeEventInputs(position, payload);
  const closeAction = payload.close_action || 'keep_open';
  let originalCostBasis = toNumber(position.original_cost_basis);
  let openCostBasis = toNumber(position.open_cost_basis);
  let currentValue = position.current_value === null || position.current_value === undefined
    ? null
    : toNumber(position.current_value);
  let units = toNumber(position.units);
  let currentPrice = position.current_price === null || position.current_price === undefined
    ? null
    : toNumber(position.current_price);
  let status = position.status || 'open';
  let closedAt = position.closed_at || null;

  if (input.currentPriceInput !== undefined && input.currentPriceInput !== null) {
    currentPrice = input.currentPriceInput;
  }

  if (input.eventType === 'deposit' || input.eventType === 'buy') {
    originalCostBasis += input.principalAmount;
    openCostBasis += input.principalAmount;
    units += input.unitsInput ?? 0;

    if (input.currentValueInput !== undefined && input.currentValueInput !== null) {
      currentValue = input.currentValueInput;
    } else if (currentPrice !== null && units > 0) {
      currentValue = currentPrice * units;
    } else {
      currentValue = (currentValue ?? 0) + input.principalAmount;
    }
    status = 'open';
    closedAt = null;
  } else if (BASIS_REDUCTION_EVENT_TYPES.has(input.eventType)) {
    openCostBasis = Math.max(openCostBasis - input.disposedCostBasis, 0);
    if (input.unitsInput !== undefined && input.unitsInput !== null) {
      if (input.unitsInput > units + 0.000001) {
        throw serviceError(400, 'Disposed units cannot exceed open units');
      }
      units = Math.max(units - input.unitsInput, 0);
    }

    if (input.currentValueInput !== undefined && input.currentValueInput !== null) {
      currentValue = input.currentValueInput;
    } else if (currentPrice !== null) {
      currentValue = currentPrice * units;
    }
  } else if (input.eventType === 'valuation') {
    if (input.currentValueInput === undefined || input.currentValueInput === null) {
      if (input.amount === null) {
        throw serviceError(400, 'valuation requires current_value (or legacy amount)');
      }
      currentValue = input.amount;
    } else {
      currentValue = input.currentValueInput;
    }
    if (input.unitsInput !== undefined && input.unitsInput !== null) {
      units = input.unitsInput;
    }
  } else if (input.eventType === 'dividend' || input.eventType === 'interest') {
    if (input.reinvested) {
      originalCostBasis += input.incomeAmount;
      openCostBasis += input.incomeAmount;
      units += input.unitsInput ?? 0;
      currentValue = input.currentValueInput !== undefined && input.currentValueInput !== null
        ? input.currentValueInput
        : (currentValue ?? 0) + input.incomeAmount;
    } else if (input.currentValueInput !== undefined && input.currentValueInput !== null) {
      currentValue = input.currentValueInput;
    }
  } else if (input.eventType === 'fee') {
    if (input.currentValueInput !== undefined && input.currentValueInput !== null) {
      currentValue = input.currentValueInput;
    } else if (input.deductedFromPosition && currentValue !== null) {
      currentValue = Math.max(currentValue - input.feeAmount, 0);
    }
  } else if (input.eventType === 'tax') {
    if (input.currentValueInput !== undefined && input.currentValueInput !== null) {
      currentValue = input.currentValueInput;
    } else if (input.deductedFromPosition && currentValue !== null) {
      currentValue = Math.max(currentValue - input.taxAmount, 0);
    }
  }

  const shouldAutoClose = closeAction === 'full_close'
    || (BASIS_REDUCTION_EVENT_TYPES.has(input.eventType)
      && openCostBasis <= 0
      && units <= 0);

  if (shouldAutoClose) {
    openCostBasis = 0;
    units = 0;
    currentValue = 0;
    status = 'closed';
    closedAt = normalizeDate(payload.effective_date);
  } else {
    status = 'open';
    closedAt = null;
  }

  return {
    ...input,
    originalCostBasis,
    openCostBasis,
    currentValue,
    units,
    averageCost: units > 0 ? openCostBasis / units : position.average_cost,
    currentPrice,
    valuationDate:
      input.currentValueInput !== undefined
      || input.currentPriceInput !== undefined
      || input.eventType === 'valuation'
        ? normalizeDate(payload.effective_date)
        : position.valuation_date || null,
    status,
    closedAt,
    closeAction,
  };
}

async function insertPositionEvent(client, position, payload, nextPosition) {
  const eventResult = await client.query(
    `
      INSERT INTO investment_position_events (
        position_id,
        event_type,
        effective_date,
        amount,
        principal_amount,
        income_amount,
        fee_amount,
        tax_amount,
        proceeds_amount,
        disposed_cost_basis,
        realized_gain_loss,
        reinvested,
        deducted_from_position,
        units,
        current_value,
        current_price,
        close_action,
        linked_transaction_identifier,
        linked_transaction_vendor,
        notes,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *
    `,
    [
      position.id,
      nextPosition.eventType,
      normalizeDate(payload.effective_date),
      nextPosition.amount,
      nextPosition.principalAmount,
      nextPosition.incomeAmount,
      nextPosition.feeAmount,
      nextPosition.taxAmount,
      nextPosition.proceedsAmount,
      nextPosition.disposedCostBasis,
      nextPosition.realizedGainLoss,
      nextPosition.reinvested,
      nextPosition.deductedFromPosition,
      nextPosition.unitsInput ?? null,
      nextPosition.currentValueInput ?? null,
      nextPosition.currentPriceInput ?? null,
      nextPosition.closeAction,
      payload.linked_transaction_identifier || null,
      payload.linked_transaction_vendor || null,
      payload.notes || null,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
    ],
  );

  return normalizeEvent(eventResult.rows?.[0]);
}

async function updatePositionSnapshot(client, positionId, nextPosition) {
  const updatedPositionResult = await client.query(
    `
      UPDATE investment_positions
      SET original_cost_basis = $1,
          open_cost_basis = $2,
          current_value = $3,
          units = $4,
          average_cost = $5,
          current_price = $6,
          valuation_date = $7,
          status = $8,
          closed_at = $9,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING *
    `,
    [
      nextPosition.originalCostBasis,
      nextPosition.openCostBasis,
      nextPosition.currentValue,
      nextPosition.units,
      nextPosition.averageCost,
      nextPosition.currentPrice,
      nextPosition.valuationDate,
      nextPosition.status,
      nextPosition.closedAt,
      positionId,
    ],
  );

  return normalizePosition(updatedPositionResult.rows?.[0]);
}

async function ensureEventIsNotRetroactive(client, positionId, effectiveDate) {
  const latestResult = await client.query(
    `
      SELECT effective_date
      FROM investment_position_events
      WHERE position_id = $1
      ORDER BY effective_date DESC, id DESC
      LIMIT 1
    `,
    [positionId],
  );
  const latestDate = latestResult.rows?.[0]?.effective_date;
  if (latestDate && normalizeDate(effectiveDate) < normalizeDate(latestDate)) {
    throw serviceError(409, 'Retroactive position events are not supported yet');
  }
}

async function ensureLinkedTransactionIsAvailable(client, payload) {
  if (!payload.linked_transaction_identifier || !payload.linked_transaction_vendor) return;

  const existingResult = await client.query(
    `
      SELECT id
      FROM investment_position_events
      WHERE linked_transaction_identifier = $1
        AND linked_transaction_vendor = $2
      ORDER BY id ASC
      LIMIT 1
    `,
    [payload.linked_transaction_identifier, payload.linked_transaction_vendor],
  );
  if (existingResult.rows?.length) {
    throw serviceError(409, 'Transaction is already linked to a position event');
  }
}

function isLinkedTransactionUniqueViolation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  const isUniqueViolation = code === 'SQLITE_CONSTRAINT_UNIQUE'
    || code === '23505'
    || /unique constraint/i.test(message)
    || /position event transaction link already exists/i.test(message);
  return isUniqueViolation && (
    /idx_investment_position_events_linked_transaction_unique/i.test(message)
    || /linked_transaction_identifier/i.test(message)
    || /position event transaction link already exists/i.test(message)
  );
}

async function listPositions(params = {}) {
  await ensureSchema();
  const accountId = params.account_id || params.accountId;
  const status = params.status;

  const filters = ['ia.is_active = true'];
  const values = [];

  if (accountId) {
    filters.push(`ip.account_id = $${values.length + 1}`);
    values.push(accountId);
  }

  if (status) {
    if (!['open', 'closed'].includes(status)) {
      throw serviceError(400, 'status must be open or closed');
    }
    filters.push(`ip.status = $${values.length + 1}`);
    values.push(status);
  }

  const result = await database.query(
    `
      SELECT
        ip.*,
        ia.account_name,
        ia.account_type,
        ia.investment_category,
        ${INSTITUTION_SELECT_FIELDS}
      FROM investment_positions ip
      JOIN investment_accounts ia ON ia.id = ip.account_id
      LEFT JOIN institution_nodes fi ON ia.institution_id = fi.id AND fi.node_type = 'institution'
      WHERE ${filters.join(' AND ')}
      ORDER BY ip.status ASC, ip.opened_at DESC, ip.position_name ASC
    `,
    values,
  );

  const positions = await Promise.all(
    (result.rows || []).map(async (row) => {
      let institution = buildInstitutionFromRow(row);
      if (!institution && row.account_type) {
        institution = await getInstitutionByVendorCode(database, row.account_type);
      }

      return normalizePosition({
        ...row,
        institution: institution || null,
      });
    }),
  );

  return { positions };
}

async function listPositionEvents(params = {}) {
  await ensureSchema();
  const positionId = params.position_id || params.positionId;
  const accountId = params.account_id || params.accountId;
  const eventType = params.event_type || params.eventType;
  const filters = [];
  const values = [];

  if (positionId) {
    filters.push(`ipe.position_id = $${values.length + 1}`);
    values.push(positionId);
  }
  if (accountId) {
    filters.push(`ip.account_id = $${values.length + 1}`);
    values.push(accountId);
  }
  if (eventType) {
    if (!VALID_EVENT_TYPES.has(String(eventType).toLowerCase())) {
      throw serviceError(400, 'Invalid event_type');
    }
    filters.push(`ipe.event_type = $${values.length + 1}`);
    values.push(String(eventType).toLowerCase());
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await database.query(
    `
      SELECT ipe.*, ip.account_id, ip.position_name, ip.currency
      FROM investment_position_events ipe
      JOIN investment_positions ip ON ip.id = ipe.position_id
      ${whereClause}
      ORDER BY ipe.effective_date DESC, ipe.id DESC
    `,
    values,
  );
  return { events: (result.rows || []).map(normalizeEvent) };
}

async function createPositionEvent(payload = {}) {
  await ensureSchema();

  const eventType = String(payload.event_type || '').toLowerCase();
  if (!VALID_EVENT_TYPES.has(eventType)) {
    throw serviceError(400, `Invalid event_type. Must be one of: ${Array.from(VALID_EVENT_TYPES).join(', ')}`);
  }

  const closeAction = payload.close_action || 'keep_open';
  if (!VALID_CLOSE_ACTIONS.has(closeAction)) {
    throw serviceError(400, `Invalid close_action. Must be one of: ${Array.from(VALID_CLOSE_ACTIONS).join(', ')}`);
  }
  if (Boolean(payload.linked_transaction_identifier) !== Boolean(payload.linked_transaction_vendor)) {
    throw serviceError(400, 'Both linked transaction identifier and vendor are required');
  }

  const effectiveDate = normalizeDate(payload.effective_date);
  const client = await getQueryClient();

  try {
    await client.query('BEGIN');
    await ensureLinkedTransactionIsAvailable(client, payload);

    let position;
    let created = false;
    if (payload.position_id) {
      position = await getPositionById(client, payload.position_id);
      if (!position) throw serviceError(404, 'Investment position not found');
      await ensureEventIsNotRetroactive(client, position.id, effectiveDate);
    } else {
      if (!payload.account_id) {
        throw serviceError(400, 'account_id is required to create a position');
      }
      const account = await verifyAccountExists(client, payload.account_id);
      const normalized = normalizePositionInput(
        {
          ...payload,
          effective_date: effectiveDate,
          units: 0,
          average_cost: null,
          original_cost_basis: 0,
          open_cost_basis: 0,
          current_value: null,
        },
        account.currency,
      );
      position = await insertPosition(client, normalized);
      created = true;
    }

    const nextPosition = computePositionUpdate(position, { ...payload, event_type: eventType, effective_date: effectiveDate });
    const event = await insertPositionEvent(client, position, payload, nextPosition);
    const updatedPosition = await updatePositionSnapshot(client, position.id, nextPosition);

    await client.query('COMMIT');
    return { position: updatedPosition, event, created };
  } catch (error) {
    await client.query('ROLLBACK');
    if (isLinkedTransactionUniqueViolation(error)) {
      throw serviceError(409, 'Transaction is already linked to a position event');
    }
    throw error;
  } finally {
    client.release?.();
  }
}

module.exports = {
  listPositions,
  listPositionEvents,
  createPosition,
  updatePosition,
  deactivatePosition,
  createPositionEvent,
  __test: {
    computePositionUpdate,
    normalizeDate,
    normalizeEvent,
    normalizePosition,
  },
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
