/**
 * Spending Categories Service
 *
 * Manages spending category classification system (Growth, Stability, Essential, Reward, Other)
 * with auto-detection, manual override, and allocation analytics.
 */

const actualDatabase = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { CATEGORY_TYPES } = require('../../../lib/category-constants.js');

let database = actualDatabase;

/**
 * Auto-detect spending category based on category name and characteristics
 * Uses keyword matching with confidence scoring
 */
function autoDetectSpendingCategory(categoryName, categoryNameEn, parentName, categoryType) {
  if (categoryType !== CATEGORY_TYPES.EXPENSE) {
    return { spendingCategory: 'other', confidence: 1.0, variabilityType: 'variable' };
  }

  const name = (categoryName || '').toLowerCase();
  const nameEn = (categoryNameEn || '').toLowerCase();
  const parent = (parentName || '').toLowerCase();
  const combined = `${name} ${nameEn} ${parent}`;

  // Growth keywords (investments, savings, education)
  const growthKeywords = ['השקעות', 'חיסכון', 'השכלה', 'קורסים', 'פיקדון', 'קרן', 'השתלמות',
    'investment', 'savings', 'education', 'course', 'deposit', 'fund', 'training', 'learning'];

  // Stability keywords (insurance, emergency, debt)
  const stabilityKeywords = ['ביטוח', 'חירום', 'חוב', 'הלוואה', 'משכנתא', 'קופת גמל',
    'insurance', 'emergency', 'debt', 'loan', 'mortgage', 'pension', 'healthcare'];

  // Essential keywords (rent, utilities, groceries, transport)
  const essentialKeywords = ['שכירות', 'דירה', 'חשמל', 'מים', 'ארנונה', 'גז', 'מזון', 'סופרמרקט',
    'תחבורה', 'דלק', 'חניה', 'אוכל', 'תשלומי בנק', 'טלפון', 'אינטרנט',
    'rent', 'electric', 'water', 'gas', 'food', 'grocery', 'supermarket', 'transport',
    'fuel', 'parking', 'phone', 'internet', 'utilities', 'housing'];

  // Reward keywords (entertainment, dining, travel, hobbies)
  const rewardKeywords = ['בידור', 'מסעדה', 'קפה', 'נופש', 'טיול', 'קולנוע', 'תחביב', 'ספורט',
    'מתנות', 'קניות', 'אופנה', 'יופי', 'entertainment', 'restaurant', 'cafe', 'vacation',
    'travel', 'cinema', 'hobby', 'sport', 'gifts', 'shopping', 'fashion', 'beauty', 'leisure'];

  // Fixed cost keywords (for variability detection)
  const fixedKeywords = ['שכירות', 'ביטוח', 'משכנתא', 'דמי ניהול', 'מנוי', 'subscription',
    'rent', 'insurance', 'mortgage', 'management', 'fee', 'membership'];

  // Variable cost keywords
  const variableKeywords = ['מזון', 'בידור', 'קניות', 'food', 'entertainment', 'shopping',
    'dining', 'leisure', 'fuel'];

  // Seasonal keywords
  const seasonalKeywords = ['חופשה', 'חג', 'טיול', 'vacation', 'holiday', 'travel', 'gift'];

  // Check for matches
  const isGrowth = growthKeywords.some(kw => combined.includes(kw));
  const isStability = stabilityKeywords.some(kw => combined.includes(kw));
  const isEssential = essentialKeywords.some(kw => combined.includes(kw));
  const isReward = rewardKeywords.some(kw => combined.includes(kw));

  const isFixed = fixedKeywords.some(kw => combined.includes(kw));
  const isVariable = variableKeywords.some(kw => combined.includes(kw));
  const isSeasonal = seasonalKeywords.some(kw => combined.includes(kw));

  // Determine spending category
  let spendingCategory = 'other';
  let confidence = 0.5;

  if (isGrowth) {
    spendingCategory = 'growth';
    confidence = 0.9;
  } else if (isStability) {
    spendingCategory = 'stability';
    confidence = 0.85;
  } else if (isEssential) {
    spendingCategory = 'essential';
    confidence = 0.9;
  } else if (isReward) {
    spendingCategory = 'reward';
    confidence = 0.85;
  }

  // Determine variability type
  let variabilityType = 'variable';
  if (isFixed) {
    variabilityType = 'fixed';
  } else if (isSeasonal) {
    variabilityType = 'seasonal';
  }

  return { spendingCategory, confidence, variabilityType };
}

/**
 * Initialize spending category mappings for all expense categories
 * Auto-detects and creates mappings where they don't exist
 */
async function initializeSpendingCategories() {
  const client = await database.getClient();

  try {
    // Get all expense categories
    const categoriesResult = await client.query(`
      SELECT
        cd.id,
        cd.name,
        cd.name_en,
        cd.category_type,
        parent.name as parent_name
      FROM category_definitions cd
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      WHERE cd.is_active = 1
    `);

    const categories = categoriesResult.rows;
    let created = 0;
    let skipped = 0;

    for (const category of categories) {
      // Check if mapping exists
      const existingResult = await client.query(
        `SELECT id FROM spending_category_mappings WHERE category_definition_id = $1`,
        [category.id]
      );

      if (existingResult.rows.length > 0) {
        skipped++;
        continue;
      }

      // Auto-detect spending category
      const { spendingCategory, confidence, variabilityType } = autoDetectSpendingCategory(
        category.name,
        category.name_en,
        category.parent_name,
        category.category_type
      );

      // Create mapping
      await client.query(`
        INSERT INTO spending_category_mappings (
          category_definition_id,
          spending_category,
          variability_type,
          is_auto_detected,
          detection_confidence
        ) VALUES ($1, $2, $3, 1, $4)
      `, [category.id, spendingCategory, variabilityType, confidence]);

      created++;
    }

    return {
      success: true,
      created,
      skipped,
      total: categories.length,
    };
  } finally {
    client.release();
  }
}

/**
 * Get all spending category mappings
 */
async function getSpendingCategoryMappings(params = {}) {
  const { spendingCategory, categoryDefinitionId } = params;

  const client = await database.getClient();

  try {
    let query = `
      SELECT
        scm.*,
        cd.name as category_name,
        cd.name_en as category_name_en,
        cd.category_type,
        parent.name as parent_category_name,
        parent.name_en as parent_category_name_en
      FROM spending_category_mappings scm
      JOIN category_definitions cd ON scm.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 0;

    if (spendingCategory) {
      paramCount++;
      query += ` AND scm.spending_category = $${paramCount}`;
      values.push(spendingCategory);
    }

    if (categoryDefinitionId) {
      paramCount++;
      query += ` AND scm.category_definition_id = $${paramCount}`;
      values.push(categoryDefinitionId);
    }

    query += ` ORDER BY scm.spending_category, cd.name`;

    const result = await client.query(query, values);
    return { mappings: result.rows };
  } finally {
    client.release();
  }
}

/**
 * Update spending category mapping
 */
async function updateSpendingCategoryMapping(categoryDefinitionId, updates) {
  const client = await database.getClient();

  try {
    const { spendingCategory, variabilityType, targetPercentage, notes } = updates;

    const setStatements = [];
    const values = [];
    let paramCount = 0;

    if (spendingCategory) {
      paramCount++;
      setStatements.push(`spending_category = $${paramCount}`);
      values.push(spendingCategory);

      // Mark as user overridden
      paramCount++;
      setStatements.push(`user_overridden = 1`);
      setStatements.push(`is_auto_detected = 0`);
    }

    if (variabilityType) {
      paramCount++;
      setStatements.push(`variability_type = $${paramCount}`);
      values.push(variabilityType);
    }

    if (targetPercentage !== undefined) {
      paramCount++;
      setStatements.push(`target_percentage = $${paramCount}`);
      values.push(targetPercentage);
    }

    if (notes !== undefined) {
      paramCount++;
      setStatements.push(`notes = $${paramCount}`);
      values.push(notes);
    }

    if (setStatements.length === 0) {
      throw new Error('No fields to update');
    }

    paramCount++;
    values.push(categoryDefinitionId);

    const result = await client.query(`
      UPDATE spending_category_mappings
      SET ${setStatements.join(', ')}
      WHERE category_definition_id = $${paramCount}
      RETURNING *
    `, values);

    if (result.rows.length === 0) {
      throw new Error('Spending category mapping not found');
    }

    return { mapping: result.rows[0] };
  } finally {
    client.release();
  }
}

/**
 * Get spending category breakdown with actual spending data
 */
async function getSpendingCategoryBreakdown(params = {}) {
  const { startDate, endDate, months = 3 } = params;
  const { start, end } = resolveDateRange({ startDate, endDate, months });

  const client = await database.getClient();

  try {
    // Get spending totals by spending category
    const result = await client.query(`
      SELECT
        scm.spending_category,
        COUNT(t.identifier) as transaction_count,
        SUM(ABS(t.price)) as total_amount,
        AVG(ABS(t.price)) as avg_transaction,
        MIN(t.date) as first_transaction_date,
        MAX(t.date) as last_transaction_date
      FROM transactions t
      JOIN category_definitions cd ON t.category_definition_id = cd.id
      JOIN spending_category_mappings scm ON cd.id = scm.category_definition_id
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
        AND ap.id IS NULL
      GROUP BY scm.spending_category
      ORDER BY total_amount DESC
    `, [start, end]);

    const breakdown = result.rows;
    const totalSpending = breakdown.reduce((sum, item) => sum + parseFloat(item.total_amount || 0), 0);

    // Get targets
    const targetsResult = await client.query(`
      SELECT spending_category, target_percentage
      FROM spending_category_targets
      WHERE is_active = 1
    `);

    const targets = {};
    targetsResult.rows.forEach(row => {
      targets[row.spending_category] = parseFloat(row.target_percentage || 0);
    });

    // Calculate percentages and compare to targets
    const enrichedBreakdown = breakdown.map(item => {
      const actualPercentage = totalSpending > 0
        ? (parseFloat(item.total_amount) / totalSpending) * 100
        : 0;
      const targetPercentage = targets[item.spending_category] || 0;
      const variance = actualPercentage - targetPercentage;

      return {
        ...item,
        total_amount: parseFloat(item.total_amount || 0),
        avg_transaction: parseFloat(item.avg_transaction || 0),
        transaction_count: parseInt(item.transaction_count || 0, 10),
        actual_percentage: actualPercentage,
        target_percentage: targetPercentage,
        variance,
        status: variance > 5 ? 'over' : variance < -5 ? 'under' : 'on_track',
      };
    });

    return {
      period: { start, end },
      breakdown: enrichedBreakdown,
      total_spending: totalSpending,
      targets,
    };
  } finally {
    client.release();
  }
}

/**
 * Update spending category targets
 */
async function updateSpendingCategoryTargets(targets) {
  const client = await database.getClient();

  try {
    // Validate that targets sum to 100%
    const sum = Object.values(targets).reduce((acc, val) => acc + val, 0);
    if (Math.abs(sum - 100) > 0.01) {
      throw new Error(`Target percentages must sum to 100% (current: ${sum}%)`);
    }

    // Update each target
    for (const [spendingCategory, percentage] of Object.entries(targets)) {
      await client.query(`
        INSERT INTO spending_category_targets (spending_category, target_percentage, is_active)
        VALUES ($1, $2, 1)
        ON CONFLICT (spending_category)
        DO UPDATE SET target_percentage = $2, updated_at = datetime('now')
      `, [spendingCategory, percentage]);
    }

    return { success: true, targets };
  } finally {
    client.release();
  }
}

module.exports = {
  initializeSpendingCategories,
  getSpendingCategoryMappings,
  updateSpendingCategoryMapping,
  getSpendingCategoryBreakdown,
  updateSpendingCategoryTargets,
  autoDetectSpendingCategory, // Export for testing
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
