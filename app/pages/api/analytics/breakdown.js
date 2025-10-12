import { getDB } from '../db.js';
import { buildDuplicateFilter, resolveDateRange } from './utils.js';

const VALID_TYPES = new Set(['expense', 'income', 'investment']);

const TYPE_CONFIG = {
  expense: {
    categoryType: 'expense',
    priceFilter: 't.price < 0',
    amountExpression: 'ABS(t.price)',
  },
  income: {
    categoryType: 'income',
    priceFilter: 't.price > 0',
    amountExpression: 't.price',
  },
  investment: {
    categoryType: 'investment',
    priceFilter: '',
    amountExpression: 'ABS(t.price)',
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

    const duplicateFilter = excludeDuplicates === 'true'
      ? await buildDuplicateFilter(client, 't')
      : '';

    const priceFilterClause = config.priceFilter ? `AND ${config.priceFilter}` : '';

    const summaryResult = await client.query(
      `SELECT
        COUNT(*) as count,
        SUM(${config.amountExpression}) as total,
        AVG(${config.amountExpression}) as average,
        MIN(${config.amountExpression}) as min,
        MAX(${config.amountExpression}) as max
      FROM transactions t
      JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
      JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
      WHERE t.date >= $1 AND t.date <= $2
      AND cd_parent.category_type = $3
      ${priceFilterClause}
      ${duplicateFilter}`,
      [start, end, config.categoryType]
    );

    const byCategoryResult = await client.query(
      `WITH parent_totals AS (
        SELECT
          cd_parent.id as parent_id,
          cd_parent.name as parent_name,
          COUNT(t.identifier) as count,
          SUM(${config.amountExpression}) as total
        FROM transactions t
        JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
        JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
        WHERE t.date >= $1 AND t.date <= $2
        AND cd_parent.category_type = $3
        ${priceFilterClause}
        ${duplicateFilter}
        GROUP BY cd_parent.id, cd_parent.name
      ),
      subcategory_breakdown AS (
        SELECT
          cd_parent.id as parent_id,
          cd_parent.name as parent_name,
          cd_child.id as subcategory_id,
          cd_child.name as subcategory_name,
          COUNT(t.identifier) as count,
          SUM(${config.amountExpression}) as total
        FROM transactions t
        JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
        JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
        WHERE t.date >= $1 AND t.date <= $2
        AND cd_parent.category_type = $3
        ${priceFilterClause}
        ${duplicateFilter}
        GROUP BY cd_parent.id, cd_parent.name, cd_child.id, cd_child.name
      )
      SELECT
        pt.parent_id,
        pt.parent_name,
        pt.count,
        pt.total,
        json_agg(
          json_build_object(
            'id', sb.subcategory_id,
            'name', sb.subcategory_name,
            'count', sb.count,
            'total', sb.total
          )
          ORDER BY sb.total DESC
        ) as subcategories
      FROM parent_totals pt
      LEFT JOIN subcategory_breakdown sb ON pt.parent_id = sb.parent_id
      GROUP BY pt.parent_id, pt.parent_name, pt.count, pt.total
      ORDER BY pt.total DESC`,
      [start, end, config.categoryType]
    );

    const byVendorResult = await client.query(
      `SELECT
        t.vendor,
        COUNT(*) as count,
        SUM(${config.amountExpression}) as total
      FROM transactions t
      JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
      JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
      WHERE t.date >= $1 AND t.date <= $2
      AND cd_parent.category_type = $3
      ${priceFilterClause}
      ${duplicateFilter}
      GROUP BY t.vendor
      ORDER BY total DESC`,
      [start, end, config.categoryType]
    );

    const byMonthResult = await client.query(
      `SELECT
        TO_CHAR(t.date, 'YYYY-MM') as month,
        SUM(${config.amountExpression}) as total
      FROM transactions t
      JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
      JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
      WHERE t.date >= $1 AND t.date <= $2
      AND cd_parent.category_type = $3
      ${priceFilterClause}
      ${duplicateFilter}
      GROUP BY month
      ORDER BY month ASC`,
      [start, end, config.categoryType]
    );

    const summaryRow = summaryResult.rows[0] || {};
    const response = {
      dateRange: { start, end },
      summary: {
        total: parseFloat(summaryRow.total || 0),
        count: parseInt(summaryRow.count || 0, 10),
        average: parseFloat(summaryRow.average || 0),
        min: parseFloat(summaryRow.min || 0),
        max: parseFloat(summaryRow.max || 0),
      },
      breakdowns: {
        byCategory: byCategoryResult.rows.map(row => ({
          parentId: row.parent_id,
          category: row.parent_name,
          count: parseInt(row.count || 0, 10),
          total: parseFloat(row.total || 0),
          subcategories: Array.isArray(row.subcategories)
            ? row.subcategories
                .filter(Boolean)
                .map(sub => ({
                  id: sub.id,
                  name: sub.name,
                  count: parseInt(sub.count || 0, 10),
                  total: parseFloat(sub.total || 0),
                }))
            : [],
        })),
        byVendor: byVendorResult.rows.map(row => ({
          vendor: row.vendor,
          count: parseInt(row.count || 0, 10),
          total: parseFloat(row.total || 0),
        })),
        byMonth: byMonthResult.rows.map(row => ({
          month: row.month,
          total: parseFloat(row.total || 0),
        })),
      },
    };

    // Enrich monthly data with derived inflow/outflow depending on type
    response.breakdowns.byMonth = response.breakdowns.byMonth.map(entry => ({
      ...entry,
      inflow: type === 'expense' ? 0 : entry.total,
      outflow: type === 'expense' ? entry.total : 0,
    }));

    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching breakdown analytics:', error);
    res.status(500).json({ error: 'Failed to fetch breakdown analytics', details: error.message });
  } finally {
    client.release();
  }
}
