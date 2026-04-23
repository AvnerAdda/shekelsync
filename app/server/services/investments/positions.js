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

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString().split('T')[0];
  if (typeof value === 'string') return value.split('T')[0];
  return new Date(value).toISOString().split('T')[0];
}

function normalizePosition(row) {
  if (!row) return null;
  return {
    ...row,
    original_cost_basis: toNumber(row.original_cost_basis),
    open_cost_basis: toNumber(row.open_cost_basis),
    current_value: row.current_value === null || row.current_value === undefined
      ? null
      : toNumber(row.current_value),
  };
}

async function ensureSchema() {
  if (schemaEnsured) return;

  await database.query(`
    CREATE TABLE IF NOT EXISTS investment_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      position_name TEXT NOT NULL,
      asset_type TEXT,
      currency TEXT NOT NULL DEFAULT 'ILS',
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT NOT NULL,
      closed_at TEXT,
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
      units REAL,
      current_value REAL,
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
  await database.query('CREATE INDEX IF NOT EXISTS idx_position_events_position ON investment_position_events(position_id, effective_date DESC)');

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
    'SELECT id FROM investment_accounts WHERE id = $1 LIMIT 1',
    [accountId],
  );
  if (!result.rows?.length) {
    throw serviceError(404, 'Investment account not found');
  }
}

async function createPosition(client, payload = {}) {
  const {
    account_id,
    position_name,
    asset_type,
    currency = 'ILS',
    effective_date,
    original_cost_basis = 0,
    open_cost_basis = original_cost_basis,
    current_value = null,
    notes,
  } = payload;

  if (!account_id || !position_name) {
    throw serviceError(400, 'account_id and position_name are required to create a position');
  }

  await verifyAccountExists(client, account_id);

  const result = await client.query(
    `
      INSERT INTO investment_positions (
        account_id,
        position_name,
        asset_type,
        currency,
        status,
        opened_at,
        original_cost_basis,
        open_cost_basis,
        current_value,
        notes
      ) VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      account_id,
      position_name,
      asset_type || null,
      currency || 'ILS',
      normalizeDate(effective_date),
      toNumber(original_cost_basis),
      toNumber(open_cost_basis),
      current_value === null || current_value === undefined ? null : toNumber(current_value),
      notes || null,
    ],
  );

  return normalizePosition(result.rows?.[0]);
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
        units,
        current_value,
        close_action,
        linked_transaction_identifier,
        linked_transaction_vendor,
        notes,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `,
    [
      position.id,
      String(payload.event_type || '').toLowerCase(),
      normalizeDate(payload.effective_date),
      payload.amount === undefined || payload.amount === null ? null : toNumber(payload.amount),
      nextPosition.principalAmount,
      nextPosition.incomeAmount,
      nextPosition.feeAmount,
      payload.units === undefined || payload.units === null ? null : toNumber(payload.units),
      payload.current_value === undefined || payload.current_value === null
        ? null
        : toNumber(payload.current_value),
      nextPosition.closeAction,
      payload.linked_transaction_identifier || null,
      payload.linked_transaction_vendor || null,
      payload.notes || null,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
    ],
  );

  return eventResult.rows?.[0] || null;
}

async function updatePositionSnapshot(client, positionId, nextPosition) {
  const updatedPositionResult = await client.query(
    `
      UPDATE investment_positions
      SET
        original_cost_basis = $1,
        open_cost_basis = $2,
        current_value = $3,
        status = $4,
        closed_at = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
    `,
    [
      nextPosition.originalCostBasis,
      nextPosition.openCostBasis,
      nextPosition.currentValue,
      nextPosition.status,
      nextPosition.closedAt,
      positionId,
    ],
  );

  return normalizePosition(updatedPositionResult.rows?.[0]);
}

function computePositionUpdate(position, payload) {
  const eventType = String(payload.event_type || '').toLowerCase();
  const closeAction = payload.close_action || 'keep_open';
  const amount = toNumber(payload.amount);
  const principalAmount = toNumber(
    payload.principal_amount,
    eventType === 'deposit' || eventType === 'buy' ? amount : 0,
  );
  const incomeAmount = toNumber(
    payload.income_amount,
    eventType === 'dividend' || eventType === 'interest' ? amount : 0,
  );
  const feeAmount = toNumber(payload.fee_amount);
  const currentValueInput = payload.current_value;

  let originalCostBasis = toNumber(position.original_cost_basis);
  let openCostBasis = toNumber(position.open_cost_basis);
  let currentValue = position.current_value === null ? null : toNumber(position.current_value);
  let status = position.status || 'open';
  let closedAt = position.closed_at || null;

  if (eventType === 'deposit' || eventType === 'buy') {
    originalCostBasis += principalAmount;
    openCostBasis += principalAmount;
    if (currentValueInput !== undefined) {
      currentValue = toNumber(currentValueInput);
    } else if (currentValue === null) {
      currentValue = openCostBasis;
    }
    status = 'open';
    closedAt = null;
  } else if (eventType === 'sell') {
    openCostBasis = Math.max(openCostBasis - Math.max(principalAmount, amount), 0);
    if (currentValueInput !== undefined) {
      currentValue = toNumber(currentValueInput);
    }
  } else if (eventType === 'capital_return') {
    openCostBasis = Math.max(openCostBasis - principalAmount, 0);
    if (currentValueInput !== undefined) {
      currentValue = toNumber(currentValueInput);
    }
  } else if (eventType === 'valuation') {
    currentValue = toNumber(currentValueInput, amount);
  } else if (eventType === 'dividend' || eventType === 'interest') {
    if (currentValueInput !== undefined) {
      currentValue = toNumber(currentValueInput);
    } else if (currentValue === null) {
      currentValue = incomeAmount;
    } else {
      currentValue += incomeAmount;
    }
  } else if (eventType === 'fee') {
    currentValue = currentValue === null ? null : Math.max(currentValue - Math.max(feeAmount, amount), 0);
  } else if (eventType === 'rollover') {
    openCostBasis = Math.max(openCostBasis - Math.max(principalAmount, amount), 0);
    if (currentValueInput !== undefined) {
      currentValue = toNumber(currentValueInput);
    }
  }

  const shouldAutoClose =
    closeAction === 'full_close'
    || (BASIS_REDUCTION_EVENT_TYPES.has(eventType) && openCostBasis <= 0);

  if (shouldAutoClose) {
    openCostBasis = 0;
    status = 'closed';
    closedAt = normalizeDate(payload.effective_date);
  } else {
    status = 'open';
    closedAt = null;
  }

  return {
    originalCostBasis,
    openCostBasis,
    currentValue,
    status,
    closedAt,
    principalAmount,
    incomeAmount,
    feeAmount,
    closeAction,
  };
}

async function listPositions(params = {}) {
  await ensureSchema();
  const accountId = params.account_id || params.accountId;
  const status = params.status;

  const filters = [];
  const values = [];

  if (accountId) {
    filters.push(`ip.account_id = $${values.length + 1}`);
    values.push(accountId);
  }

  if (status) {
    filters.push(`ip.status = $${values.length + 1}`);
    values.push(status);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
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
      ${whereClause}
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

  return {
    positions,
  };
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

  const client = await getQueryClient();

  try {
    await client.query('BEGIN');

    let position = null;
    if (payload.position_id) {
      position = await getPositionById(client, payload.position_id);
      if (!position) {
        throw serviceError(404, 'Investment position not found');
      }
    } else {
      position = await createPosition(client, {
        account_id: payload.account_id,
        position_name: payload.position_name,
        asset_type: payload.asset_type,
        currency: payload.currency,
        effective_date: payload.effective_date,
        original_cost_basis:
          eventType === 'deposit' || eventType === 'buy'
            ? toNumber(payload.principal_amount, toNumber(payload.amount))
            : 0,
        open_cost_basis:
          eventType === 'deposit' || eventType === 'buy'
            ? toNumber(payload.principal_amount, toNumber(payload.amount))
            : 0,
        current_value: payload.current_value,
        notes: payload.notes,
      });
    }

    const nextPosition = computePositionUpdate(position, payload);

    const event = await insertPositionEvent(client, position, payload, nextPosition);
    const updatedPosition = await updatePositionSnapshot(client, position.id, nextPosition);

    await client.query('COMMIT');

    return {
      position: updatedPosition,
      event,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release?.();
  }
}

module.exports = {
  listPositions,
  createPositionEvent,
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
