const database = require('../database.js');
const {
  INSTITUTION_SELECT_FIELDS,
  buildInstitutionFromRow,
  getInstitutionByVendorCode,
} = require('../institutions.js');

async function listPatterns({ account_id } = {}) {
  let query = `
    SELECT 
      atp.id,
      atp.account_id,
      atp.pattern,
      atp.pattern_type,
      atp.is_active,
      atp.match_count,
      atp.created_at,
      atp.last_matched,
      ia.account_name,
      ia.account_type,
      ${INSTITUTION_SELECT_FIELDS}
    FROM account_transaction_patterns atp
    JOIN investment_accounts ia ON atp.account_id = ia.id
    LEFT JOIN financial_institutions fi ON ia.institution_id = fi.id
  `;

  const params = [];
  if (account_id) {
    query += ' WHERE atp.account_id = $1';
    params.push(account_id);
  }

  query += ' ORDER BY ia.account_name, atp.pattern';

  const result = await database.query(query, params);
  const patterns = await Promise.all(
    result.rows.map(async (row) => {
      let institution = buildInstitutionFromRow(row);
      if (!institution && row.account_type) {
        institution = await getInstitutionByVendorCode(database, row.account_type);
      }
      return {
        ...row,
        institution: institution || null,
      };
    }),
  );

  return {
    success: true,
    patterns,
    total: patterns.length,
  };
}

async function createPattern({ account_id, pattern, pattern_type = 'substring' }) {
  if (!account_id || !pattern) {
    throw Object.assign(new Error('Missing required fields: account_id, pattern'), {
      statusCode: 400,
    });
  }

  if (!['substring', 'exact', 'regex'].includes(pattern_type)) {
    throw Object.assign(new Error('Invalid pattern_type. Use: substring, exact, or regex'), {
      statusCode: 400,
    });
  }

  const existing = await database.query(
    `SELECT id FROM account_transaction_patterns WHERE account_id = $1 AND pattern = $2`,
    [account_id, pattern],
  );

  if (existing.rows.length > 0) {
    throw Object.assign(new Error('Pattern already exists for this account'), {
      statusCode: 400,
    });
  }

  const result = await database.query(
    `INSERT INTO account_transaction_patterns (
        account_id,
        pattern,
        pattern_type,
        is_active
      ) VALUES ($1, $2, $3, true)
      RETURNING *`,
    [account_id, pattern, pattern_type],
  );

  return {
    success: true,
    pattern: result.rows[0],
    message: 'Pattern added successfully',
  };
}

async function removePattern({ id }) {
  if (!id) {
    throw Object.assign(new Error('Missing pattern ID'), {
      statusCode: 400,
    });
  }

  const result = await database.query(
    'DELETE FROM account_transaction_patterns WHERE id = $1 RETURNING *',
    [id],
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('Pattern not found'), {
      statusCode: 404,
    });
  }

  return {
    success: true,
    message: 'Pattern deleted successfully',
    deleted: result.rows[0],
  };
}

module.exports = {
  listPatterns,
  createPattern,
  removePattern,
};
module.exports.default = module.exports;
