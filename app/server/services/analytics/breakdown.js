const database = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');

const VALID_TYPES = new Set(['expense', 'income', 'investment']);

const TYPE_CONFIG = {
  expense: {
    categoryType: 'expense',
    priceFilter: 't.price < 0',
    amountExpression: 'ABS(t.price)',
    amountFn: (price) => Math.abs(price),
  },
  income: {
    categoryType: 'income',
    priceFilter: 't.price > 0',
    amountExpression: 't.price',
    amountFn: (price) => price,
  },
  investment: {
    categoryType: 'investment',
    priceFilter: '',
    amountExpression: 'ABS(t.price)',
    amountFn: (price) => Math.abs(price),
  },
};

function validateType(type) {
  if (!VALID_TYPES.has(type)) {
    throw Object.assign(new Error(`Invalid type. Expected one of ${Array.from(VALID_TYPES).join(', ')}`), {
      status: 400,
    });
  }
}

async function getBreakdownAnalytics(query = {}) {
  const {
    type = 'expense',
    startDate,
    endDate,
    months = 3,
  } = query;

  validateType(type);

  const config = TYPE_CONFIG[type];
  const { start, end } = resolveDateRange({ startDate, endDate, months });
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];

  const priceFilterClause = config.priceFilter ? `AND ${config.priceFilter}` : '';

  const transactionsResult = await database.query(
    `WITH RECURSIVE category_tree AS (
        SELECT
          id as category_id,
          id as level1_id,
          name as level1_name,
          color as level1_color,
          icon as level1_icon,
          description as level1_description,
          parent_id,
          depth_level
        FROM category_definitions
        WHERE depth_level = 1 AND category_type = $3

        UNION ALL

        SELECT
          cd.id as category_id,
          ct.level1_id,
          ct.level1_name,
          ct.level1_color,
          ct.level1_icon,
          ct.level1_description,
          cd.parent_id,
          cd.depth_level
        FROM category_definitions cd
        JOIN category_tree ct ON cd.parent_id = ct.category_id
        WHERE cd.category_type = $3
      )
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.price,
        t.name as transaction_name,
        t.account_number,
        cd.id as subcategory_id,
        cd.name as subcategory_name,
        cd.color as subcategory_color,
        cd.icon as subcategory_icon,
        cd.description as subcategory_description,
        cd.parent_id,
        cd.depth_level,
        ct.level1_id as parent_id,
        ct.level1_name as parent_name,
        ct.level1_color as parent_color,
        ct.level1_icon as parent_icon,
        ct.level1_description as parent_description,
        fi.id as institution_id,
        fi.display_name_he as institution_name_he,
        fi.display_name_en as institution_name_en,
        fi.logo_url as institution_logo,
        fi.institution_type as institution_type
      FROM transactions t
      JOIN category_definitions cd ON t.category_definition_id = cd.id
      JOIN category_tree ct ON cd.id = ct.category_id
      LEFT JOIN vendor_credentials vc ON t.vendor = vc.vendor
      LEFT JOIN financial_institutions fi ON vc.institution_id = fi.id
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
      WHERE t.date >= $1 AND t.date <= $2
        AND cd.category_type = $3
        AND cd.depth_level >= 1
        ${priceFilterClause}
        AND ap.id IS NULL
      ORDER BY t.date ASC`,
    [startStr, endStr, config.categoryType],
  );

  const transactions = transactionsResult.rows.map((row) => ({
    ...row,
    price: Number.parseFloat(row.price),
    date: new Date(row.date),
  }));

  const amounts = transactions.map((tx) => config.amountFn(tx.price));
  const totalAmount = amounts.reduce((sum, value) => sum + value, 0);
  const count = transactions.length;
  const average = count > 0 ? totalAmount / count : 0;
  const minAmount = count > 0 ? Math.min(...amounts) : 0;
  const maxAmount = count > 0 ? Math.max(...amounts) : 0;

  const categoryMap = new Map();
  const vendorMap = new Map();
  const monthMap = new Map();

  transactions.forEach((tx) => {
    const amount = config.amountFn(tx.price);

    const parentKey = tx.parent_id ?? tx.parent_name ?? 'Uncategorized';
    if (!categoryMap.has(parentKey)) {
      categoryMap.set(parentKey, {
        parentId: tx.parent_id,
        category: tx.parent_name || 'Uncategorized',
        color: tx.parent_color,
        icon: tx.parent_icon,
        description: tx.parent_description,
        count: 0,
        total: 0,
        subcategories: new Map(),
      });
    }
    const parentEntry = categoryMap.get(parentKey);
    parentEntry.count += 1;
    parentEntry.total += amount;

    const isDirectlyAtLevel1 = tx.depth_level === 1 || tx.subcategory_id === tx.parent_id;
    const subKey = isDirectlyAtLevel1
      ? `${parentKey}::direct`
      : (tx.subcategory_id ?? `${parentKey}::${tx.subcategory_name || 'Other'}`);

    const subName = isDirectlyAtLevel1
      ? `${tx.parent_name || 'Uncategorized'} (Direct)`
      : (tx.subcategory_name || 'Other');

    const subColor = isDirectlyAtLevel1 ? tx.parent_color : tx.subcategory_color;
    const subIcon = isDirectlyAtLevel1 ? tx.parent_icon : tx.subcategory_icon;
    const subDescription = isDirectlyAtLevel1 ? tx.parent_description : tx.subcategory_description;

    if (!parentEntry.subcategories.has(subKey)) {
      parentEntry.subcategories.set(subKey, {
        id: isDirectlyAtLevel1 ? tx.parent_id : tx.subcategory_id,
        name: subName,
        color: subColor,
        icon: subIcon,
        description: subDescription,
        count: 0,
        total: 0,
      });
    }
    const subEntry = parentEntry.subcategories.get(subKey);
    subEntry.count += 1;
    subEntry.total += amount;

    const vendorKey = tx.vendor || 'Unknown';
    if (!vendorMap.has(vendorKey)) {
      vendorMap.set(vendorKey, {
        vendor: vendorKey,
        count: 0,
        total: 0,
        institution: tx.institution_id ? {
          id: tx.institution_id,
          display_name_he: tx.institution_name_he,
          display_name_en: tx.institution_name_en,
          logo_url: tx.institution_logo,
          institution_type: tx.institution_type,
        } : null,
      });
    }
    const vendorEntry = vendorMap.get(vendorKey);
    vendorEntry.count += 1;
    vendorEntry.total += amount;

    const monthKey = tx.date.toISOString().slice(0, 7);
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, { month: monthKey, total: 0 });
    }
    monthMap.get(monthKey).total += amount;
  });

  const byCategory = Array.from(categoryMap.values()).map((entry) => ({
    parentId: entry.parentId,
    category: entry.category,
    color: entry.color,
    icon: entry.icon,
    description: entry.description,
    count: entry.count,
    total: entry.total,
    subcategories: Array.from(entry.subcategories.values())
      .sort((a, b) => b.total - a.total)
      .map((sub) => ({
        id: sub.id,
        name: sub.name,
        color: sub.color,
        icon: sub.icon,
        description: sub.description,
        count: sub.count,
        total: sub.total,
      })),
  })).sort((a, b) => b.total - a.total);

  const byVendor = Array.from(vendorMap.values())
    .sort((a, b) => b.total - a.total)
    .map((row) => ({
      vendor: row.vendor,
      count: row.count,
      total: row.total,
      institution: row.institution,
    }));

  const byMonth = Array.from(monthMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({
      ...row,
      inflow: type === 'expense' ? 0 : row.total,
      outflow: type === 'expense' ? row.total : 0,
    }));

  return {
    dateRange: { start, end },
    summary: {
      total: totalAmount,
      count,
      average,
      min: minAmount,
      max: maxAmount,
    },
    breakdowns: {
      byCategory,
      byVendor,
      byMonth,
    },
    transactions: transactions.map((tx) => ({
      ...tx,
      price: tx.price,
    })),
  };
}

module.exports = {
  getBreakdownAnalytics,
};
module.exports.default = module.exports;
