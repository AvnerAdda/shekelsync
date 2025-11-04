const database = require('../database.js');
const { dialect } = require('../../../lib/sql-dialect.js');

let dateFnsPromise = null;

async function loadDateFns() {
  if (!dateFnsPromise) {
    dateFnsPromise = import('date-fns');
  }
  return dateFnsPromise;
}

function getDefaultActionabilityLevel(categoryName) {
  if (!categoryName) return 'medium';

  const name = categoryName.toLowerCase();

  const lowActionable = [
    'ביטוח', 'insurance',
    'משכנתא', 'mortgage',
    'שכר דירה', 'rent',
    'ארנונה', 'municipal', 'tax',
    'חשבון בנק', 'bank fee',
    'הוצאות חובה', 'mandatory',
    'חינוך', 'education', 'tuition',
  ];

  const mediumActionable = [
    'תקשורת', 'communication', 'phone', 'cellphone',
    'חשמל', 'electricity', 'electric',
    'מים', 'water',
    'גז', 'gas',
    'אינטרנט', 'internet',
    'מנויים', 'subscription',
    'רכב', 'car', 'vehicle',
  ];

  const highActionable = [
    'אוכל', 'food', 'grocery', 'groceries',
    'בילויים', 'entertainment',
    'קניות', 'shopping',
    'תחבורה', 'transport', 'transportation',
    'ספורט', 'sport', 'gym', 'fitness',
    'יופי', 'beauty', 'cosmetic',
    'בריאות', 'health',
    'קפה', 'coffee', 'cafe',
    'מסעדות', 'restaurant', 'dining',
  ];

  if (lowActionable.some((keyword) => name.includes(keyword))) return 'low';
  if (mediumActionable.some((keyword) => name.includes(keyword))) return 'medium';
  if (highActionable.some((keyword) => name.includes(keyword))) return 'high';

  return 'medium';
}

async function getCategorySpendingSummary(params = {}) {
  const { months = 3 } = params;
  const monthsInt = Number.parseInt(months, 10) || 3;

  const { subMonths } = await loadDateFns();
  const startDate = subMonths(new Date(), monthsInt);
  const endDate = new Date();

  const result = await database.query(
    `
      WITH category_spending AS (
        SELECT
          cd.id AS category_definition_id,
          cd.name AS subcategory,
          cd.name_en AS subcategory_en,
          parent.name AS parent_category,
          parent.name_en AS parent_category_en,
          parent.id AS parent_id,
          COUNT(t.identifier) AS transaction_count,
          SUM(ABS(t.price)) AS total_amount,
          AVG(ABS(t.price)) AS avg_transaction_size,
          MIN(t.date) AS first_transaction,
          MAX(t.date) AS last_transaction
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
        WHERE t.date >= $1
          AND t.date <= $2
          AND t.price < 0
          AND cd.category_type = 'expense'
          AND cd.is_active = true
          AND ap.id IS NULL
        GROUP BY cd.id, cd.name, cd.name_en, parent.name, parent.name_en, parent.id
      )
      SELECT
        cs.*,
        ROUND(${dialect.castNumeric('cs.total_amount / $3')}, 2) AS monthly_average,
        cas.actionability_level,
        cas.user_notes,
        cas.is_default
      FROM category_spending cs
      LEFT JOIN category_actionability_settings cas ON cs.category_definition_id = cas.category_definition_id
      ORDER BY cs.total_amount DESC
    `,
    [startDate, endDate, monthsInt],
  );

  const categories = result.rows.map((row) => {
    if (!row.actionability_level) {
      return {
        ...row,
        actionability_level: getDefaultActionabilityLevel(row.parent_category || row.subcategory),
        is_default: true,
      };
    }
    return row;
  });

  return {
    startDate,
    endDate,
    months: monthsInt,
    categories,
    summary: {
      totalCategories: categories.length,
      lowActionable: categories.filter((c) => c.actionability_level === 'low').length,
      mediumActionable: categories.filter((c) => c.actionability_level === 'medium').length,
      highActionable: categories.filter((c) => c.actionability_level === 'high').length,
    },
  };
}

module.exports = {
  getCategorySpendingSummary,
};

module.exports.default = module.exports;
