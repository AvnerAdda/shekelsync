const { dbManager } = require('../database');

class AnalyticsAPIRoutes {
  // Unified category analytics endpoint
  async getUnifiedCategory(req, res) {
    try {
      const {
        type = 'expense',
        groupBy = 'category',
        months = 3,
        includeTransactions = false,
        category,
        startDate,
        endDate
      } = req.query;

      // Calculate date range
      let start, end;
      if (startDate && endDate) {
        start = startDate;
        end = endDate;
      } else {
        const monthsBack = parseInt(months);
        end = new Date().toISOString().split('T')[0];
        start = new Date(Date.now() - monthsBack * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      }

      // Build filters
      let priceFilter = '';
      let categoryFilter = '';
      let params = [start, end];
      let paramCount = 2;

      switch (type) {
        case 'expense':
          priceFilter = 'AND price < 0';
          break;
        case 'income':
          priceFilter = 'AND price > 0';
          break;
        case 'investment':
          categoryFilter = "AND (category ILIKE '%investment%' OR category ILIKE '%stock%' OR category ILIKE '%crypto%')";
          break;
      }

      if (category) {
        paramCount++;
        categoryFilter += ` AND category = $${paramCount}`;
        params.push(category);
      }

      // Build SELECT and GROUP BY clauses based on groupBy parameter
      let selectClause, groupByClause;
      switch (groupBy) {
        case 'category':
          selectClause = `
            COALESCE(parent_category, category) as category,
            category as subcategory
          `;
          groupByClause = 'COALESCE(parent_category, category), category';
          break;
        case 'month':
          selectClause = `
            TO_CHAR(date, 'YYYY-MM') as month,
            TO_CHAR(date, 'Mon YYYY') as month_name
          `;
          groupByClause = "TO_CHAR(date, 'YYYY-MM'), TO_CHAR(date, 'Mon YYYY')";
          break;
        case 'vendor':
          selectClause = 'vendor';
          groupByClause = 'vendor';
          break;
        default:
          selectClause = `
            COALESCE(parent_category, category) as category,
            category as subcategory
          `;
          groupByClause = 'COALESCE(parent_category, category), category';
      }

      // Main aggregation query
      const summaryQuery = `
        SELECT
          COUNT(*) as count,
          SUM(ABS(price)) as total,
          AVG(ABS(price)) as average,
          MIN(ABS(price)) as min_amount,
          MAX(ABS(price)) as max_amount
        FROM transactions
        WHERE date >= $1 AND date <= $2
        ${priceFilter}
        ${categoryFilter}
      `;

      const breakdownQuery = `
        SELECT
          ${selectClause},
          COUNT(*) as transaction_count,
          SUM(ABS(price)) as total_amount,
          AVG(ABS(price)) as avg_amount,
          MIN(date) as earliest_date,
          MAX(date) as latest_date
        FROM transactions
        WHERE date >= $1 AND date <= $2
        ${priceFilter}
        ${categoryFilter}
        GROUP BY ${groupByClause}
        ORDER BY total_amount DESC
        LIMIT 50
      `;

      // Execute queries
      const [summaryResult, breakdownResult] = await Promise.all([
        dbManager.query(summaryQuery, params),
        dbManager.query(breakdownQuery, params)
      ]);

      const summary = summaryResult.rows[0] || {};
      const breakdown = breakdownResult.rows.map(row => ({
        ...row,
        total_amount: parseFloat(row.total_amount) || 0,
        avg_amount: parseFloat(row.avg_amount) || 0,
        transaction_count: parseInt(row.transaction_count) || 0
      }));

      // Include transactions if requested
      let transactions = [];
      if (includeTransactions === 'true') {
        const transactionsQuery = `
          SELECT
            identifier,
            vendor,
            category,
            parent_category,
            memo,
            price,
            date,
            account_number
          FROM transactions
          WHERE date >= $1 AND date <= $2
          ${priceFilter}
          ${categoryFilter}
          ORDER BY date DESC
          LIMIT 200
        `;

        const transactionsResult = await dbManager.query(transactionsQuery, params);
        transactions = transactionsResult.rows.map(row => ({
          ...row,
          price: parseFloat(row.price) || 0
        }));
      }

      res.json({
        success: true,
        summary: {
          count: parseInt(summary.count) || 0,
          total: parseFloat(summary.total) || 0,
          average: parseFloat(summary.average) || 0,
          min_amount: parseFloat(summary.min_amount) || 0,
          max_amount: parseFloat(summary.max_amount) || 0
        },
        breakdown,
        transactions,
        filters: {
          type,
          groupBy,
          startDate: start,
          endDate: end,
          category
        }
      });
    } catch (error) {
      console.error('Unified category analytics error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch analytics data',
        message: error.message
      });
    }
  }

  // Dashboard analytics
  async getDashboardAnalytics(req, res) {
    try {
      const { startDate, endDate, aggregation = 'daily' } = req.query;

      // Default to last 30 days if no dates provided
      const end = endDate || new Date().toISOString().split('T')[0];
      const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      let dateFormat, groupByClause;
      switch (aggregation) {
        case 'daily':
          dateFormat = 'YYYY-MM-DD';
          groupByClause = "TO_CHAR(date, 'YYYY-MM-DD')";
          break;
        case 'weekly':
          dateFormat = 'YYYY-WW';
          groupByClause = "TO_CHAR(date, 'YYYY-WW')";
          break;
        case 'monthly':
          dateFormat = 'YYYY-MM';
          groupByClause = "TO_CHAR(date, 'YYYY-MM')";
          break;
        default:
          dateFormat = 'YYYY-MM-DD';
          groupByClause = "TO_CHAR(date, 'YYYY-MM-DD')";
      }

      const query = `
        SELECT
          TO_CHAR(date, '${dateFormat}') as period,
          COUNT(*) as transaction_count,
          SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as total_income,
          SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_expenses,
          COUNT(DISTINCT vendor) as unique_vendors,
          COUNT(DISTINCT category) as unique_categories
        FROM transactions
        WHERE date >= $1 AND date <= $2
        GROUP BY ${groupByClause}
        ORDER BY period ASC
      `;

      const result = await dbManager.query(query, [start, end]);

      const analytics = result.rows.map(row => ({
        ...row,
        total_income: parseFloat(row.total_income) || 0,
        total_expenses: parseFloat(row.total_expenses) || 0,
        net_balance: (parseFloat(row.total_income) || 0) - (parseFloat(row.total_expenses) || 0),
        transaction_count: parseInt(row.transaction_count) || 0,
        unique_vendors: parseInt(row.unique_vendors) || 0,
        unique_categories: parseInt(row.unique_categories) || 0
      }));

      res.json({
        success: true,
        data: analytics,
        period: { start, end },
        aggregation
      });
    } catch (error) {
      console.error('Dashboard analytics error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dashboard analytics',
        message: error.message
      });
    }
  }

  // Breakdown analytics (expense/income/investment)
  async getBreakdownAnalytics(req, res) {
    try {
      const { type = 'expense', startDate, endDate } = req.query;

      // Default to last 30 days
      const end = endDate || new Date().toISOString().split('T')[0];
      const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      let priceFilter = '';
      switch (type) {
        case 'expense':
          priceFilter = 'AND price < 0';
          break;
        case 'income':
          priceFilter = 'AND price > 0';
          break;
        case 'investment':
          priceFilter = "AND (category ILIKE '%investment%' OR category ILIKE '%stock%' OR category ILIKE '%crypto%')";
          break;
      }

      const query = `
        SELECT
          category,
          parent_category,
          vendor,
          COUNT(*) as transaction_count,
          SUM(ABS(price)) as total_amount,
          AVG(ABS(price)) as avg_amount,
          MIN(ABS(price)) as min_amount,
          MAX(ABS(price)) as max_amount,
          MIN(date) as earliest_date,
          MAX(date) as latest_date
        FROM transactions
        WHERE date >= $1 AND date <= $2
        ${priceFilter}
        GROUP BY category, parent_category, vendor
        ORDER BY total_amount DESC
        LIMIT 100
      `;

      const result = await dbManager.query(query, [start, end]);

      const breakdown = result.rows.map(row => ({
        ...row,
        total_amount: parseFloat(row.total_amount) || 0,
        avg_amount: parseFloat(row.avg_amount) || 0,
        min_amount: parseFloat(row.min_amount) || 0,
        max_amount: parseFloat(row.max_amount) || 0,
        transaction_count: parseInt(row.transaction_count) || 0
      }));

      // Calculate totals
      const totals = breakdown.reduce((acc, item) => ({
        total_amount: acc.total_amount + item.total_amount,
        transaction_count: acc.transaction_count + item.transaction_count
      }), { total_amount: 0, transaction_count: 0 });

      res.json({
        success: true,
        data: breakdown,
        totals,
        type,
        period: { start, end }
      });
    } catch (error) {
      console.error('Breakdown analytics error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch breakdown analytics',
        message: error.message
      });
    }
  }

  // Personal intelligence (spending patterns, insights)
  async getPersonalIntelligence(req, res) {
    try {
      const { months = 3 } = req.query;
      const monthsBack = parseInt(months);
      const startDate = new Date(Date.now() - monthsBack * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Top spending categories
      const categoriesQuery = `
        SELECT
          category,
          COUNT(*) as frequency,
          SUM(ABS(price)) as total_spent,
          AVG(ABS(price)) as avg_amount
        FROM transactions
        WHERE date >= $1 AND price < 0 AND category IS NOT NULL
        GROUP BY category
        ORDER BY total_spent DESC
        LIMIT 10
      `;

      // Monthly spending trend
      const trendQuery = `
        SELECT
          TO_CHAR(date, 'YYYY-MM') as month,
          SUM(ABS(price)) as total_spent,
          COUNT(*) as transaction_count
        FROM transactions
        WHERE date >= $1 AND price < 0
        GROUP BY TO_CHAR(date, 'YYYY-MM')
        ORDER BY month DESC
      `;

      // Spending habits (day of week, time patterns)
      const habitsQuery = `
        SELECT
          EXTRACT(DOW FROM date) as day_of_week,
          CASE
            WHEN EXTRACT(DOW FROM date) = 0 THEN 'Sunday'
            WHEN EXTRACT(DOW FROM date) = 1 THEN 'Monday'
            WHEN EXTRACT(DOW FROM date) = 2 THEN 'Tuesday'
            WHEN EXTRACT(DOW FROM date) = 3 THEN 'Wednesday'
            WHEN EXTRACT(DOW FROM date) = 4 THEN 'Thursday'
            WHEN EXTRACT(DOW FROM date) = 5 THEN 'Friday'
            WHEN EXTRACT(DOW FROM date) = 6 THEN 'Saturday'
          END as day_name,
          COUNT(*) as transaction_count,
          SUM(ABS(price)) as total_spent,
          AVG(ABS(price)) as avg_spent
        FROM transactions
        WHERE date >= $1 AND price < 0
        GROUP BY EXTRACT(DOW FROM date)
        ORDER BY day_of_week
      `;

      const [categoriesResult, trendResult, habitsResult] = await Promise.all([
        dbManager.query(categoriesQuery, [startDate]),
        dbManager.query(trendQuery, [startDate]),
        dbManager.query(habitsQuery, [startDate])
      ]);

      const intelligence = {
        topCategories: categoriesResult.rows.map(row => ({
          ...row,
          total_spent: parseFloat(row.total_spent) || 0,
          avg_amount: parseFloat(row.avg_amount) || 0,
          frequency: parseInt(row.frequency) || 0
        })),
        monthlyTrend: trendResult.rows.map(row => ({
          ...row,
          total_spent: parseFloat(row.total_spent) || 0,
          transaction_count: parseInt(row.transaction_count) || 0
        })),
        spendingHabits: habitsResult.rows.map(row => ({
          ...row,
          total_spent: parseFloat(row.total_spent) || 0,
          avg_spent: parseFloat(row.avg_spent) || 0,
          transaction_count: parseInt(row.transaction_count) || 0
        }))
      };

      res.json({
        success: true,
        data: intelligence,
        period: `Last ${months} months`,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Personal intelligence error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate personal intelligence',
        message: error.message
      });
    }
  }
}

module.exports = new AnalyticsAPIRoutes();