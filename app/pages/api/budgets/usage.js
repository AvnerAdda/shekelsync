import { getDB } from '../db.js';
import { startOfWeek, startOfMonth, startOfYear, endOfWeek, endOfMonth, endOfYear } from 'date-fns';

function getPeriodRange(periodType) {
  const now = new Date();

  switch (periodType) {
    case 'weekly':
      return {
        start: startOfWeek(now, { weekStartsOn: 0 }),
        end: endOfWeek(now, { weekStartsOn: 0 })
      };
    case 'monthly':
      return {
        start: startOfMonth(now),
        end: endOfMonth(now)
      };
    case 'yearly':
      return {
        start: startOfYear(now),
        end: endOfYear(now)
      };
    default:
      throw new Error('Invalid period type');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    // Get all active budgets
    const budgetsResult = await client.query(
      'SELECT * FROM category_budgets WHERE is_active = true'
    );

    const budgets = budgetsResult.rows;
    const usageData = [];

    for (const budget of budgets) {
      const { start, end } = getPeriodRange(budget.period_type);

      // Calculate spending for this category in the period
      const spendingResult = await client.query(
        `SELECT COALESCE(SUM(ABS(price)), 0) as spent
         FROM transactions
         WHERE category = $1
         AND price < 0
         AND date >= $2
         AND date <= $3`,
        [budget.category, start, end]
      );

      const spent = parseFloat(spendingResult.rows[0].spent) || 0;
      const percentage = (spent / budget.budget_limit) * 100;

      usageData.push({
        ...budget,
        spent,
        remaining: budget.budget_limit - spent,
        percentage: Math.min(percentage, 100),
        status: percentage >= 100 ? 'exceeded' : percentage >= 80 ? 'warning' : 'good'
      });
    }

    res.status(200).json(usageData);
  } catch (error) {
    console.error('Error calculating budget usage:', error);
    res.status(500).json({ error: 'Failed to calculate budget usage' });
  } finally {
    client.release();
  }
}
