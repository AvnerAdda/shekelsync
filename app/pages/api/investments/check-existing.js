import { getDB } from '../db';
import { getAllPatterns } from '../../../config/investment-patterns';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = await getDB();

    // Get all vendors/merchants that have investment transactions
    // Support both legacy `type` and `category_type` columns
    const result = await db.query(`
      SELECT DISTINCT 
        t.vendor,
        t.name,
        t.category,
        t.subcategory,
        COUNT(*) as transaction_count,
        SUM(ABS(t.price)) as total_amount
      FROM transactions t
      WHERE (t.type = 'investment' OR t.category_type = 'investment')
        AND (t.status IS NULL OR t.status != 'canceled')
      GROUP BY t.vendor, t.name, t.category, t.subcategory
      ORDER BY total_amount DESC
    `);

    // Get categorization rules related to investments
    const rulesResult = await db.query(`
      SELECT 
        name_pattern,
        target_category,
        parent_category,
        subcategory
      FROM categorization_rules
      WHERE is_active = true
        AND (
          parent_category = 'investment'
          OR target_category LIKE '%השתלמות%'
          OR target_category LIKE '%פנסיה%'
          OR target_category LIKE '%קופת גמל%'
          OR target_category LIKE '%מניות%'
          OR target_category LIKE '%ברוקר%'
          OR target_category LIKE '%קריפטו%'
          OR LOWER(name_pattern) LIKE '%interactive%'
          OR LOWER(name_pattern) LIKE '%bits of gold%'
          OR LOWER(name_pattern) LIKE '%פיקדון%'
          OR LOWER(name_pattern) LIKE '%קופת גמל%'
        )
    `);

    const investmentVendors = result.rows.map(row => ({
      vendor: row.vendor,
      name: row.name,
      category: row.category,
      subcategory: row.subcategory,
      transactionCount: parseInt(row.transaction_count),
      totalAmount: parseFloat(row.total_amount)
    }));

    const investmentRules = rulesResult.rows.map(row => ({
      pattern: row.name_pattern,
      category: row.target_category,
      parentCategory: row.parent_category,
      subcategory: row.subcategory
    }));

    // Get all patterns from centralized config
    const allPatterns = getAllPatterns();
    const patternsByType = {};
    
    for (const { pattern, type } of allPatterns) {
      if (!patternsByType[type]) {
        patternsByType[type] = [];
      }
      patternsByType[type].push(pattern);
    }

    // Get accounts with actual linked transactions
    const linkedAccountsResult = await db.query(`
      SELECT 
        ia.id,
        ia.account_name,
        ia.account_type,
        COUNT(tal.id) as link_count
      FROM investment_accounts ia
      LEFT JOIN transaction_account_links tal ON ia.id = tal.account_id
      WHERE tal.id IS NOT NULL
      GROUP BY ia.id, ia.account_name, ia.account_type
      HAVING COUNT(tal.id) > 0
    `);

    const linkedAccounts = linkedAccountsResult.rows.map(row => ({
      id: row.id,
      accountName: row.account_name,
      accountType: row.account_type,
      linkCount: parseInt(row.link_count)
    }));

    res.status(200).json({
      vendors: investmentVendors,
      rules: investmentRules,
      patterns: patternsByType,
      linkedAccounts: linkedAccounts
    });

  } catch (error) {
    console.error('Error checking existing investments:', error);
    res.status(500).json({ 
      error: 'Failed to check existing investments',
      details: error.message 
    });
  }
}
