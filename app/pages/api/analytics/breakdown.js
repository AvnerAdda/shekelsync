import { getDB } from '../db.js';
import { buildDuplicateFilter, resolveDateRange } from './utils.js';

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const {
      type = 'expense',
      startDate,
      endDate,
      months = 3,
      excludeDuplicates = 'true',
    } = req.query;

    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ error: `Invalid type. Expected one of ${Array.from(VALID_TYPES).join(', ')}` });
    }

    const config = TYPE_CONFIG[type];
    const { start, end } = resolveDateRange({ startDate, endDate, months });
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    const duplicateFilter = excludeDuplicates === 'true'
      ? await buildDuplicateFilter(client, 't')
      : '';
    const duplicateClause = duplicateFilter ? duplicateFilter.replace(/transactions\./g, 't.') : '';

    const priceFilterClause = config.priceFilter ? `AND ${config.priceFilter}` : '';
    const transactionsResult = await client.query(
      `SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.price,
        cd_child.id as subcategory_id,
        cd_child.name as subcategory_name,
        cd_parent.id as parent_id,
        cd_parent.name as parent_name
      FROM transactions t
      JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
      JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
      WHERE t.date >= $1 AND t.date <= $2
        AND cd_parent.category_type = $3
        ${priceFilterClause}
        ${duplicateClause}
      ORDER BY t.date ASC`,
      [startStr, endStr, config.categoryType]
    );

    const transactions = transactionsResult.rows.map(row => ({
      ...row,
      price: parseFloat(row.price),
      date: new Date(row.date),
    }));
    const amounts = transactions.map(tx => config.amountFn(tx.price));

    const totalAmount = amounts.reduce((sum, value) => sum + value, 0);
    const count = transactions.length;
    const average = count > 0 ? totalAmount / count : 0;
    const minAmount = count > 0 ? Math.min(...amounts) : 0;
    const maxAmount = count > 0 ? Math.max(...amounts) : 0;

    const categoryMap = new Map();
    const vendorMap = new Map();
    const monthMap = new Map();

    transactions.forEach(tx => {
      const amount = config.amountFn(tx.price);

      // Categories
      const parentKey = tx.parent_id ?? tx.parent_name ?? 'Uncategorized';
      if (!categoryMap.has(parentKey)) {
        categoryMap.set(parentKey, {
          parentId: tx.parent_id,
          category: tx.parent_name || 'Uncategorized',
          count: 0,
          total: 0,
          subcategories: new Map(),
        });
      }
      const parentEntry = categoryMap.get(parentKey);
      parentEntry.count += 1;
      parentEntry.total += amount;

      const subKey = tx.subcategory_id ?? `${parentKey}::${tx.subcategory_name || 'Other'}`;
      if (!parentEntry.subcategories.has(subKey)) {
        parentEntry.subcategories.set(subKey, {
          id: tx.subcategory_id,
          name: tx.subcategory_name || 'Other',
          count: 0,
          total: 0,
        });
      }
      const subEntry = parentEntry.subcategories.get(subKey);
      subEntry.count += 1;
      subEntry.total += amount;

      // Vendors
      if (!vendorMap.has(tx.vendor)) {
        vendorMap.set(tx.vendor, { vendor: tx.vendor, count: 0, total: 0 });
      }
      const vendorEntry = vendorMap.get(tx.vendor);
      vendorEntry.count += 1;
      vendorEntry.total += amount;

      // Months
      const monthKey = tx.date.toISOString().slice(0, 7);
      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, { month: monthKey, total: 0 });
      }
      monthMap.get(monthKey).total += amount;
    });

    const byCategory = Array.from(categoryMap.values()).map(entry => ({
      parentId: entry.parentId,
      category: entry.category,
      count: entry.count,
      total: entry.total,
      subcategories: Array.from(entry.subcategories.values())
        .sort((a, b) => b.total - a.total)
        .map(sub => ({
          id: sub.id,
          name: sub.name,
          count: sub.count,
          total: sub.total,
        })),
    })).sort((a, b) => b.total - a.total);

    const byVendor = Array.from(vendorMap.values())
      .sort((a, b) => b.total - a.total)
      .map(row => ({
        vendor: row.vendor,
        count: row.count,
        total: row.total,
      }));

    const byMonth = Array.from(monthMap.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(row => ({ month: row.month, total: row.total }));
    const response = {
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
        byMonth: byMonth.map(entry => ({
          ...entry,
          inflow: type === 'expense' ? 0 : entry.total,
          outflow: type === 'expense' ? entry.total : 0,
        })),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching breakdown analytics:', error);
    res.status(500).json({ error: 'Failed to fetch breakdown analytics', details: error.message });
  } finally {
    client.release();
  }
}
