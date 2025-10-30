import { getDB } from '../db.js';
import { subMonths } from 'date-fns';
import { dialect } from '../../../lib/sql-dialect.js';

/**
 * Get category spending summary with subcategory breakdown
 * Used for actionability settings modal
 * GET /api/analytics/category-spending-summary?months=3
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { months = 3 } = req.query;
    const startDate = subMonths(new Date(), parseInt(months));
    const endDate = new Date();

    // Get all expense subcategories with their spending amounts
    const result = await client.query(`
      WITH category_spending AS (
        SELECT
          cd.id as category_definition_id,
          cd.name as subcategory,
          cd.name_en as subcategory_en,
          parent.name as parent_category,
          parent.name_en as parent_category_en,
          parent.id as parent_id,
          COUNT(t.identifier) as transaction_count,
          SUM(ABS(t.price)) as total_amount,
          AVG(ABS(t.price)) as avg_transaction_size,
          MIN(t.date) as first_transaction,
          MAX(t.date) as last_transaction
        FROM transactions t
        INNER JOIN category_definitions cd ON t.category_definition_id = cd.id
        LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
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
        AND t.price < 0
        AND cd.category_type = 'expense'
        AND cd.is_active = true
        AND ap.id IS NULL
        GROUP BY cd.id, cd.name, cd.name_en, parent.name, parent.name_en, parent.id
      )
      SELECT
        cs.*,
        ROUND(${dialect.castNumeric('cs.total_amount / $3')}, 2) as monthly_average,
        cas.actionability_level,
        cas.user_notes,
        cas.is_default
      FROM category_spending cs
      LEFT JOIN category_actionability_settings cas ON cs.category_definition_id = cas.category_definition_id
      ORDER BY cs.total_amount DESC
    `, [startDate, endDate, parseInt(months)]);

    // Apply default actionability levels for categories without settings
    const categoriesWithDefaults = result.rows.map(row => {
      if (!row.actionability_level) {
        row.actionability_level = getDefaultActionabilityLevel(row.parent_category || row.subcategory);
        row.is_default = true;
      }
      return row;
    });

    return res.status(200).json({
      startDate,
      endDate,
      months: parseInt(months),
      categories: categoriesWithDefaults,
      summary: {
        totalCategories: categoriesWithDefaults.length,
        lowActionable: categoriesWithDefaults.filter(c => c.actionability_level === 'low').length,
        mediumActionable: categoriesWithDefaults.filter(c => c.actionability_level === 'medium').length,
        highActionable: categoriesWithDefaults.filter(c => c.actionability_level === 'high').length
      }
    });

  } catch (error) {
    console.error('Error fetching category spending summary:', error);
    return res.status(500).json({
      error: 'Failed to fetch category spending summary',
      details: error.message
    });
  } finally {
    client.release();
  }
}

/**
 * Get default actionability level based on category name
 * Supports both Hebrew and English category names
 */
function getDefaultActionabilityLevel(categoryName) {
  if (!categoryName) return 'medium';

  const name = categoryName.toLowerCase();

  // LOW ACTIONABLE (Fixed costs)
  const lowActionable = [
    'ביטוח', 'insurance',
    'משכנתא', 'mortgage',
    'שכר דירה', 'rent',
    'ארנונה', 'municipal', 'tax',
    'חשבון בנק', 'bank fee',
    'הוצאות חובה', 'mandatory',
    'חינוך', 'education', 'tuition'
  ];

  // MEDIUM ACTIONABLE (Can optimize)
  const mediumActionable = [
    'תקשורת', 'communication', 'phone', 'cellphone',
    'חשמל', 'electricity', 'electric',
    'מים', 'water',
    'גז', 'gas',
    'אינטרנט', 'internet',
    'מנויים', 'subscription',
    'רכב', 'car', 'vehicle'
  ];

  // HIGH ACTIONABLE (Flexible spending)
  const highActionable = [
    'אוכל', 'food', 'grocery', 'groceries',
    'בילויים', 'entertainment',
    'קניות', 'shopping',
    'תחבורה', 'transport', 'transportation',
    'ספורט', 'sport', 'gym', 'fitness',
    'יופי', 'beauty', 'cosmetic',
    'בריאות', 'health',
    'קפה', 'coffee', 'cafe',
    'מסעדות', 'restaurant', 'dining'
  ];

  // Check LOW
  for (const keyword of lowActionable) {
    if (name.includes(keyword)) return 'low';
  }

  // Check MEDIUM
  for (const keyword of mediumActionable) {
    if (name.includes(keyword)) return 'medium';
  }

  // Check HIGH
  for (const keyword of highActionable) {
    if (name.includes(keyword)) return 'high';
  }

  // Default to medium if no match
  return 'medium';
}
