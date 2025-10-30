/**
 * Pairing Exclusion Utility
 *
 * Provides SQL fragments for excluding paired bank transactions from analytics queries.
 * Uses LEFT JOIN with account_pairings table to dynamically filter out transactions
 * that match active pairing patterns.
 *
 * Usage:
 *   const { leftJoin, whereCondition } = getPairingExclusionSQL();
 *   const query = `
 *     SELECT t.* FROM transactions t
 *     ${leftJoin}
 *     WHERE ${whereCondition}
 *       AND other_conditions...
 *   `;
 */

/**
 * Returns SQL fragments for excluding paired transactions
 * @returns {Object} Object with leftJoin and whereCondition SQL strings
 */
export function getPairingExclusionSQL() {
  return {
    leftJoin: `
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
    `,
    whereCondition: `ap.id IS NULL`
  };
}

/**
 * Applies pairing exclusion to a query builder pattern
 * @param {string} baseQuery - Base SQL query without pairing exclusion
 * @param {string} tableAlias - Alias for transactions table (default: 't')
 * @returns {string} Modified query with pairing exclusion
 */
export function applyPairingExclusion(baseQuery, tableAlias = 't') {
  const { leftJoin, whereCondition } = getPairingExclusionSQL();

  // If query already has WHERE clause, add AND condition
  if (baseQuery.toLowerCase().includes('where')) {
    return baseQuery.replace(/WHERE/i, `${leftJoin}\nWHERE ${whereCondition} AND`);
  }

  // Otherwise, add WHERE clause
  return `${baseQuery}\n${leftJoin}\nWHERE ${whereCondition}`;
}
