const { dateKey, validDate, shiftDays, invalid } = require('../planning-math.js');
const { getCreditCardRepaymentCategoryCondition } = require('../accounts/repayment-category.js');

const ALLOCATIONS = ['essential', 'growth', 'stability', 'reward', 'unallocated'];
const blank = () => Object.fromEntries(ALLOCATIONS.map((key) => [key, 0]));
const units = (cents) => cents / 100;

function timelinePeriod(params = {}, today = dateKey()) {
  const rollingDays = Number(params.rollingDays ?? 30);
  const historyDays = Number(params.historyDays ?? 90);
  if (!Number.isInteger(rollingDays) || rollingDays < 1 || rollingDays > 365
    || !Number.isInteger(historyDays) || historyDays < 1 || historyDays > 366) throw invalid('Choose between 1 and 365 rolling days and up to 366 timeline days');
  const end = params.endDate || today;
  if (!validDate(end) || end > today) throw invalid('Enter a valid timeline end date, today or earlier');
  const start = params.startDate || shiftDays(end, 1 - historyDays);
  if (!validDate(start) || !validDate(end) || start > end || end > today
    || start < shiftDays(end, -365)) throw invalid('Enter a valid timeline period of up to 366 days, ending today or earlier');
  return { start, end, rolling_days: rollingDays, history_start: shiftDays(start, 1 - rollingDays) };
}

/** Exact N-day windows, including each plotted day. Never sum overlapping windows. */
function buildTimeline(rows, period) {
  const byDate = new Map();
  for (const row of rows) {
    const date = String(row.date).slice(0, 10);
    if (date < period.history_start || date > period.end) continue;
    const entry = byDate.get(date) || { income: 0, expenses: blank(), counts: blank() };
    const amount = Math.round(Number(row.amount) * 100);
    if (!Number.isFinite(amount)) continue;
    if (row.kind === 'income') entry.income += amount;
    else {
      const category = ALLOCATIONS.includes(row.spending_category) ? row.spending_category : 'unallocated';
      entry.expenses[category] -= amount;
      entry.counts[category] += Number(row.transaction_count) || 0;
    }
    byDate.set(date, entry);
  }
  let income = 0;
  const expenses = blank();
  const counts = blank();
  const apply = (entry, sign) => {
    if (!entry) return;
    income += sign * entry.income;
    for (const key of ALLOCATIONS) {
      expenses[key] += sign * entry.expenses[key];
      counts[key] += sign * entry.counts[key];
    }
  };
  const points = [];
  for (let date = period.history_start; date <= period.end; date = shiftDays(date, 1)) {
    apply(byDate.get(date), 1);
    apply(byDate.get(shiftDays(date, -period.rolling_days)), -1);
    if (date < period.start) continue;
    const totalExpenses = Object.values(expenses).reduce((sum, value) => sum + value, 0);
    const net = income - totalExpenses;
    const surplus = Math.max(0, net);
    const amounts = { ...expenses, growth: expenses.growth + surplus };
    const percentages = Object.fromEntries(ALLOCATIONS.map((key) => [key, income > 0 ? amounts[key] / income * 100 : null]));
    points.push({ date, window_start: shiftDays(date, 1 - period.rolling_days), income: units(income),
      expenses: units(totalExpenses), net: units(net), surplus: units(surplus), deficit: units(Math.max(0, -net)),
      expense_amounts: Object.fromEntries(ALLOCATIONS.map((key) => [key, units(expenses[key])])),
      allocation_amounts: Object.fromEntries(ALLOCATIONS.map((key) => [key, units(amounts[key])])),
      percentages, transaction_counts: { ...counts }, has_income: income > 0 });
  }
  return points;
}

// Shared selection for chart totals and transaction details. Signed refunds reduce
// spending. Transfers, investment movements and duplicate card repayments do not
// consume income; income left after expenses is allocated to Growth.
const selection = `
  FROM transactions t
  LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
  LEFT JOIN spending_category_mappings scm ON scm.category_definition_id = cd.id
  WHERE t.date >= $1 AND t.date < $2 AND t.status = 'completed'
    AND COALESCE(cd.category_type, t.category_type, CASE WHEN t.price < 0 THEN 'expense' END) IN ('income', 'expense')
    AND (COALESCE(cd.category_type, t.category_type, 'expense') <> 'income' OR COALESCE(cd.is_counted_as_income, 1) = 1)
    AND COALESCE(cd.name, '') <> 'החזר קרן' AND COALESCE(cd.name_en, '') <> 'Capital Returns'
    AND NOT ${getCreditCardRepaymentCategoryCondition('cd')}
    AND NOT EXISTS (SELECT 1 FROM transaction_pairing_exclusions tpe
      WHERE tpe.transaction_identifier = t.identifier AND tpe.transaction_vendor = t.vendor)
`;
const kindSql = "COALESCE(cd.category_type, t.category_type, CASE WHEN t.price < 0 THEN 'expense' END)";
const allocationSql = "COALESCE(NULLIF(scm.spending_category, 'other'), 'unallocated')";

async function getTimeline(client, params) {
  const period = timelinePeriod(params);
  const rows = await client.query(`SELECT SUBSTR(t.date, 1, 10) AS date, ${kindSql} AS kind,
    ${allocationSql} AS spending_category, SUM(t.price) AS amount, COUNT(*) AS transaction_count
    ${selection} GROUP BY SUBSTR(t.date, 1, 10), ${kindSql}, ${allocationSql}
    ORDER BY date`, [period.history_start, shiftDays(period.end, 1)]);
  const targets = await client.query("SELECT spending_category, target_percentage FROM spending_category_targets WHERE is_active = 1");
  const categories = await client.query(`SELECT cd.id AS category_definition_id, cd.name AS category_name,
    cd.name_en AS category_name_en, cd.name_fr AS category_name_fr, cd.icon, scm.spending_category
    FROM category_definitions cd LEFT JOIN spending_category_mappings scm ON scm.category_definition_id = cd.id
    WHERE cd.category_type = 'expense' AND cd.is_active = 1 ORDER BY cd.name`);
  const categoriesByAllocation = Object.fromEntries(ALLOCATIONS.map((key) => [key, []]));
  for (const row of categories.rows) {
    const key = ALLOCATIONS.includes(row.spending_category) ? row.spending_category : 'unallocated';
    categoriesByAllocation[key].push({ ...row, spending_category: key === 'unallocated' ? null : key,
      total_amount: 0, percentage_of_income: 0, transaction_count: 0 });
  }
  return { period, points: buildTimeline(rows.rows, period),
    targets: Object.fromEntries(targets.rows.map((row) => [row.spending_category, Number(row.target_percentage)])),
    categories_by_allocation: categoriesByAllocation };
}

async function getTimelineTransactions(client, params) {
  if (!ALLOCATIONS.includes(params.spendingCategory)) throw invalid('Invalid spending category');
  const { startDate: start, endDate: end } = params;
  if (!validDate(start) || !validDate(end) || start > end || start < shiftDays(end, -364)) throw invalid('Invalid rolling window');
  const limit = Math.min(2000, Math.max(1, Number(params.limit) || 500));
  const offset = Math.max(0, Number(params.offset) || 0);
  if (!Number.isInteger(limit) || !Number.isInteger(offset)) throw invalid('Invalid pagination');
  const filter = `${selection} AND ${kindSql} = 'expense' AND ${allocationSql} = $3`;
  const args = [start, shiftDays(end, 1), params.spendingCategory];
  const transactions = await client.query(`SELECT t.identifier, t.vendor, t.name, t.date, t.price,
    t.account_number, t.category_definition_id, ${kindSql} AS category_type, t.status,
    cd.name AS category_name, cd.name_en AS category_name_en, cd.name_fr AS category_name_fr
    ${filter} ORDER BY t.date DESC, t.identifier LIMIT $4 OFFSET $5`, [...args, limit, offset]);
  const summary = await client.query(`SELECT COUNT(*) AS total_count, COALESCE(-SUM(t.price), 0) AS total_amount ${filter}`, args);
  return { period: { start, end }, spending_category: params.spendingCategory, transactions: transactions.rows,
    total_count: Number(summary.rows[0].total_count), total_amount: units(Math.round(Number(summary.rows[0].total_amount) * 100)), limit, offset };
}

module.exports = { timelinePeriod, buildTimeline, getTimeline, getTimelineTransactions };
