const database = require('../database.js');
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

async function listPendingSuggestions(params = {}) {
  const status = params.status || 'pending';

  const result = await database.query(
    `
      SELECT
        pts.*,
        ia.account_name,
        ia.account_type,
        ${INSTITUTION_SELECT_FIELDS},
        pts.suggested_institution as raw_suggested_institution,
        pts.suggested_institution_vendor
      FROM pending_transaction_suggestions pts
      LEFT JOIN investment_accounts ia ON pts.suggested_account_id = ia.id
      LEFT JOIN financial_institutions fi ON ia.institution_id = fi.id
      WHERE pts.status = $1
      ORDER BY pts.confidence DESC, pts.created_at DESC
    `,
    [status],
  );

  const pendingSuggestions = await Promise.all(
    result.rows.map(async (row) => {
      let institution = buildInstitutionFromRow(row);

      if (!institution && row.suggested_institution_vendor) {
        institution = await getInstitutionByVendorCode(database, row.suggested_institution_vendor);
      }

      if (!institution && row.raw_suggested_institution) {
        institution = {
          id: null,
          vendor_code: row.raw_suggested_institution,
          display_name_he: row.raw_suggested_institution,
          display_name_en: row.raw_suggested_institution,
          institution_type: null,
        };
      }

      return {
        ...row,
        institution: institution || null,
      };
    }),
  );

  return {
    pendingSuggestions,
    total: pendingSuggestions.length,
  };
}

async function applySuggestionAction(payload = {}) {
  const { id, action } = payload;

  if (!id || !action) {
    throw serviceError(400, 'Missing required fields: id, action');
  }

  const normalizedAction = String(action).toLowerCase();
  const allowed = new Set(['approve', 'reject', 'ignore']);
  if (!allowed.has(normalizedAction)) {
    throw serviceError(400, 'Invalid action. Use: approve, reject, or ignore');
  }

  const suggestionResult = await database.query(
    `SELECT * FROM pending_transaction_suggestions WHERE id = $1`,
    [id],
  );

  if (suggestionResult.rows.length === 0) {
    throw serviceError(404, 'Suggestion not found');
  }

  const suggestion = suggestionResult.rows[0];
  const status = normalizedAction === 'approve' ? 'approved' : normalizedAction === 'reject' ? 'rejected' : 'ignored';

  await database.query(
    `
      UPDATE pending_transaction_suggestions 
         SET status = $1,
             reviewed_at = CURRENT_TIMESTAMP
       WHERE id = $2
    `,
    [status, id],
  );

  if (normalizedAction !== 'approve') {
    return {
      success: true,
      action: normalizedAction,
      message: `Suggestion ${status}`,
    };
  }

  const linkResult = await database.query(
    `
      INSERT INTO transaction_account_links (
        transaction_identifier,
        transaction_vendor,
        transaction_date,
        account_id,
        link_method,
        confidence
      ) VALUES ($1, $2, $3, $4, 'user_confirmed', $5)
      ON CONFLICT (transaction_identifier, transaction_vendor) 
      DO UPDATE SET 
        account_id = EXCLUDED.account_id,
        link_method = 'user_confirmed',
        confidence = EXCLUDED.confidence
      RETURNING *
    `,
    [
      suggestion.transaction_identifier,
      suggestion.transaction_vendor,
      suggestion.transaction_date,
      suggestion.suggested_account_id,
      suggestion.confidence,
    ],
  );

  await database.query(
    `
      UPDATE account_transaction_patterns 
         SET match_count = match_count + 1,
             last_matched = CURRENT_TIMESTAMP
       WHERE account_id = $1 
         AND LOWER($2) LIKE LOWER(pattern)
    `,
    [suggestion.suggested_account_id, suggestion.transaction_name],
  );

  return {
    success: true,
    action: 'approved',
    linkCreated: linkResult.rows[0] || null,
    message: 'Transaction linked successfully',
  };
}

module.exports = {
  listPendingSuggestions,
  applySuggestionAction,
};

module.exports.default = module.exports;
