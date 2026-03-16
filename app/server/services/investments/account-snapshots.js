const {
  toNumber,
} = require('./account-holdings-rollup.js');

function normalizeAccountIds(accountIds = []) {
  return Array.isArray(accountIds)
    ? accountIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : [];
}

function addNullableNumbers(left, right) {
  const leftValue = toNumber(left);
  const rightValue = toNumber(right);
  if (leftValue === null && rightValue === null) {
    return null;
  }
  return (leftValue || 0) + (rightValue || 0);
}

function maxDate(left, right) {
  if (!left) return right || null;
  if (!right) return left || null;
  return String(left) >= String(right) ? left : right;
}

async function fetchAccountHoldingSnapshots(client, accountIds = []) {
  const ids = normalizeAccountIds(accountIds);
  if (ids.length === 0) {
    return new Map();
  }

  const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');

  const [standardResult, pikadonResult] = await Promise.all([
    client.query(
      `
        WITH ranked_standard AS (
          SELECT
            ih.account_id,
            ih.current_value,
            ih.cost_basis,
            ih.as_of_date,
            ROW_NUMBER() OVER (
              PARTITION BY ih.account_id
              ORDER BY ih.as_of_date DESC, ih.id DESC
            ) AS rn
          FROM investment_holdings ih
          WHERE ih.account_id IN (${placeholders})
            AND COALESCE(ih.holding_type, 'standard') <> 'pikadon'
        )
        SELECT
          account_id,
          current_value,
          cost_basis,
          as_of_date
        FROM ranked_standard
        WHERE rn = 1
      `,
      ids,
    ),
    client.query(
      `
        SELECT
          ih.account_id,
          SUM(COALESCE(ih.current_value, ih.cost_basis, 0)) AS current_value,
          SUM(COALESCE(ih.cost_basis, ih.current_value, 0)) AS cost_basis,
          MAX(ih.as_of_date) AS as_of_date
        FROM investment_holdings ih
        WHERE ih.account_id IN (${placeholders})
          AND ih.holding_type = 'pikadon'
          AND COALESCE(ih.status, 'active') = 'active'
        GROUP BY ih.account_id
      `,
      ids,
    ),
  ]);

  const snapshots = new Map();

  (standardResult.rows || []).forEach((row) => {
    const accountId = Number(row.account_id);
    if (!Number.isFinite(accountId)) {
      return;
    }

    snapshots.set(accountId, {
      current_value: toNumber(row.current_value),
      cost_basis: toNumber(row.cost_basis),
      as_of_date: row.as_of_date || null,
      uses_pikadon_rollup: false,
    });
  });

  (pikadonResult.rows || []).forEach((row) => {
    const accountId = Number(row.account_id);
    if (!Number.isFinite(accountId)) {
      return;
    }

    const existing = snapshots.get(accountId);

    // Pikadon holdings replace (not add to) standard holdings for the same account.
    // The standard holding is a summary-level placeholder that becomes redundant
    // once granular pikadon holdings exist for the account.
    snapshots.set(accountId, {
      current_value: toNumber(row.current_value),
      cost_basis: toNumber(row.cost_basis),
      as_of_date: maxDate(existing?.as_of_date, row.as_of_date || null),
      uses_pikadon_rollup: true,
    });
  });

  return snapshots;
}

module.exports = {
  fetchAccountHoldingSnapshots,
};

module.exports.default = module.exports;
