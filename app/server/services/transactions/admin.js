const actualDatabase = require('../database.js');
const { INCOME_ROOT_NAME } = require('../../../lib/category-constants.js');

let database = actualDatabase;
function __setDatabase(mock) {
  database = mock || actualDatabase;
}
function __resetDatabase() {
  database = actualDatabase;
}

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseTransactionId(id) {
  if (typeof id !== 'string' || !id.includes('|')) {
    throw serviceError(400, 'Invalid transaction identifier');
  }

  const [identifier, vendor] = id.split('|');
  if (!identifier || !vendor) {
    throw serviceError(400, 'Invalid transaction identifier');
  }

  return { identifier, vendor };
}

async function createManualTransaction(payload = {}) {
  const {
    name,
    amount,
    date,
    type,
    categoryDefinitionId,
  } = payload;

  const client = await database.getClient();

  try {
    const identifier = `manual_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const vendor = type === 'income' ? 'manual_income' : 'manual_expense';
    const numericAmount = Number(amount);
    const price = type === 'income' ? Math.abs(numericAmount) : -Math.abs(numericAmount);
    const effectiveDate = new Date(date);
    const timestamp = new Date();

    let resolvedCategoryId = categoryDefinitionId || null;

    if (type === 'income' && !resolvedCategoryId) {
      const incomeCategory = await client.query(
        `
          SELECT id
          FROM category_definitions
          WHERE name = $1
          LIMIT 1
        `,
        [INCOME_ROOT_NAME],
      );
      resolvedCategoryId = incomeCategory.rows[0]?.id || null;
    }

    if (!resolvedCategoryId) {
      throw serviceError(400, 'Unable to resolve category definition for manual transaction');
    }

    const categoryInfo = await client.query(
      `
        SELECT
          cd.id,
          cd.name,
          cd.category_type,
          cd.parent_id,
          parent.name AS parent_name
        FROM category_definitions cd
        LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
        WHERE cd.id = $1
      `,
      [resolvedCategoryId],
    );

    if (categoryInfo.rows.length === 0) {
      throw serviceError(400, `Category definition ${resolvedCategoryId} not found`);
    }

    const categoryRecord = categoryInfo.rows[0];

    await client.query(
      `
        INSERT INTO transactions (
          identifier,
          vendor,
          date,
          name,
          price,
          category_definition_id,
          category_type,
          type,
          status,
          auto_categorized,
          confidence_score,
          processed_date,
          transaction_datetime,
          processed_datetime
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          'completed',
          false,
          1.0,
          $9,
          $10,
          $11
        )
      `,
      [
        identifier,
        vendor,
        effectiveDate,
        name,
        price,
        resolvedCategoryId,
        categoryRecord.category_type,
        type,
        effectiveDate,
        effectiveDate,
        timestamp,
      ],
    );

    return { success: true };
  } finally {
    client.release();
  }
}

async function updateTransaction(id, updates = {}) {
  const { identifier, vendor } = parseTransactionId(id);

  const fields = [
    'price',
    'category_definition_id',
    'category_type',
    'auto_categorized',
    'confidence_score',
    'memo',
    'tags',
  ];

  const setClauses = [];
  const params = [identifier, vendor];
  let paramIndex = 3;

  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      setClauses.push(`${field} = $${paramIndex}`);
      let value = updates[field];
      // Serialize tags array to JSON string
      if (field === 'tags' && Array.isArray(value)) {
        value = JSON.stringify(value);
      }
      params.push(value);
      paramIndex += 1;
    }
  });

  if (setClauses.length === 0) {
    throw serviceError(400, 'At least one updatable field is required');
  }

  await database.query(
    `
      UPDATE transactions
      SET ${setClauses.join(', ')}
      WHERE identifier = $1 AND vendor = $2
    `,
    params,
  );

  return { success: true };
}

async function deleteTransaction(id) {
  const { identifier, vendor } = parseTransactionId(id);

  await database.query(
    `
      DELETE FROM transactions
      WHERE identifier = $1 AND vendor = $2
    `,
    [identifier, vendor],
  );

  return { success: true };
}

module.exports = {
  createManualTransaction,
  updateTransaction,
  deleteTransaction,
  __setDatabase,
  __resetDatabase,
};

module.exports.default = module.exports;
