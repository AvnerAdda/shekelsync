const math = require('./planning-math.js');
const { getCreditCardRepaymentCategoryCondition } = require('./accounts/repayment-category.js');

/** A deterministic estimate when the richer forecast has failed or lacks history. */
async function recentSpendingEstimate(database, today, horizon, forecastDays = []) {
  const start = math.shiftDays(today, -89);
  const result = await database.query(`SELECT SUBSTR(t.date, 1, 10) AS date, t.price,
      COALESCE(cd.category_type, t.category_type, CASE WHEN t.price < 0 THEN 'expense' END) AS kind,
      t.category_definition_id
    FROM transactions t LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
    WHERE t.date >= $1 AND t.date < $2 AND t.status = 'completed'
      AND COALESCE(cd.category_type, t.category_type, CASE WHEN t.price < 0 THEN 'expense' END) IN ('income', 'expense')
      AND NOT ${getCreditCardRepaymentCategoryCondition('cd')}
      AND NOT EXISTS (SELECT 1 FROM transaction_pairing_exclusions excluded
        WHERE excluded.transaction_identifier = t.identifier AND excluded.transaction_vendor = t.vendor)
    ORDER BY t.date`, [start, math.shiftDays(today, 1)]);
  const rows = result.rows.filter((row) => math.validDate(row.date) && Number.isFinite(Number(row.price)));
  if (!rows.length) return null;
  const historyDays = Math.min(90, Math.round((Date.parse(today) - Date.parse(rows[0].date)) / 86400000) + 1);
  const expenses = new Map();
  for (const row of rows) {
    if (row.kind !== 'expense') continue;
    const key = row.category_definition_id ?? 'unallocated';
    expenses.set(key, (expenses.get(key) || 0) - Math.round(Number(row.price) * 100));
  }
  // Refunds offset their own category; excess refunds are not future income.
  const total = [...expenses.values()].reduce((sum, amount) => sum + Math.max(0, amount), 0);
  const dailyCents = total / Math.max(30, historyDays);
  const byDate = new Map(forecastDays.map((day) => [day.date, day]));
  const validAmount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  return {
    historyDays,
    days: Array.from({ length: horizon }, (_, i) => {
      const date = math.shiftDays(today, i + 1);
      const existing = byDate.get(date);
      // Spread rounding across days so a month of estimates retains its cents.
      const historical = (Math.round(dailyCents * (i + 1)) - Math.round(dailyCents * i)) / 100;
      return { date,
        expectedOperatingIncome: validAmount(existing?.expectedOperatingIncome) ? existing.expectedOperatingIncome : 0,
        expectedOperatingExpenses: Math.max(historical, validAmount(existing?.expectedOperatingExpenses) ? existing.expectedOperatingExpenses : 0),
      };
    }),
  };
}

module.exports = { recentSpendingEstimate };
