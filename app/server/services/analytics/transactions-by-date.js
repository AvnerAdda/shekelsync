const database = require('../database.js');

const PAIRING_EXCLUSION = `
  LEFT JOIN account_pairings ap ON (
    t.vendor = ap.bank_vendor
    AND ap.is_active = 1
    AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
    AND ap.match_patterns IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM json_each(ap.match_patterns)
      WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
    )
  )
`;

async function listTransactionsByDate(params = {}) {
  const { date } = params;

  if (!date) {
    const error = new Error('Date parameter is required');
    error.status = 400;
    throw error;
  }

  const result = await database.query(
    `
      SELECT
        t.identifier,
        t.vendor,
        t.price,
        t.name AS description,
        t.date,
        cd_child.name AS category,
        cd_parent.name AS parent_category,
        cd_parent.category_type
      FROM transactions t
      LEFT JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
      LEFT JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
      ${PAIRING_EXCLUSION}
      WHERE DATE(t.date) = DATE($1)
        AND ap.id IS NULL
      ORDER BY t.price DESC
    `,
    [date],
  );

  const transactions = result.rows.map((row) => ({
    identifier: row.identifier,
    vendor: row.vendor,
    price: Number.parseFloat(row.price),
    description: row.description,
    date: row.date,
    category: row.category,
    parentCategory: row.parent_category,
    categoryType: row.category_type,
    category_name: row.category,
    parent_name: row.parent_category,
  }));

  return { transactions };
}

module.exports = {
  listTransactionsByDate,
};

module.exports.default = module.exports;
