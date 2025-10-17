const { dbManager } = require('../database');

class TransactionAPIRoutes {
  // Get available months for filtering
  async getAvailableMonths(req, res) {
    try {
      const query = `
        SELECT DISTINCT
          TO_CHAR(date, 'YYYY-MM') as month,
          TO_CHAR(date, 'Mon YYYY') as month_name,
          COUNT(*) as transaction_count
        FROM transactions
        WHERE date IS NOT NULL
        GROUP BY TO_CHAR(date, 'YYYY-MM'), TO_CHAR(date, 'Mon YYYY')
        ORDER BY month DESC
      `;

      const result = await dbManager.query(query);
      res.json(result.rows);
    } catch (error) {
      console.error('Get available months error:', error);
      res.status(500).json({
        error: 'Failed to fetch available months',
        message: error.message
      });
    }
  }

  // Get box panel data (summary statistics)
  async getBoxPanelData(req, res) {
    try {
      const query = `
        SELECT
          COUNT(*) as total_transactions,
          SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as total_income,
          SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_expenses,
          COUNT(DISTINCT vendor) as unique_vendors,
          COUNT(DISTINCT category) as unique_categories,
          AVG(CASE WHEN price < 0 THEN ABS(price) ELSE NULL END) as avg_expense,
          MIN(date) as earliest_date,
          MAX(date) as latest_date
        FROM transactions
        WHERE date >= CURRENT_DATE - INTERVAL '30 days'
      `;

      const result = await dbManager.query(query);
      const data = result.rows[0];

      // Convert strings to numbers
      const boxData = {
        totalTransactions: parseInt(data.total_transactions) || 0,
        totalIncome: parseFloat(data.total_income) || 0,
        totalExpenses: parseFloat(data.total_expenses) || 0,
        netBalance: (parseFloat(data.total_income) || 0) - (parseFloat(data.total_expenses) || 0),
        uniqueVendors: parseInt(data.unique_vendors) || 0,
        uniqueCategories: parseInt(data.unique_categories) || 0,
        avgExpense: parseFloat(data.avg_expense) || 0,
        dateRange: {
          earliest: data.earliest_date,
          latest: data.latest_date
        }
      };

      res.json(boxData);
    } catch (error) {
      console.error('Get box panel data error:', error);
      res.status(500).json({
        error: 'Failed to fetch box panel data',
        message: error.message
      });
    }
  }

  // Get category expenses for a specific month
  async getCategoryExpenses(req, res) {
    try {
      const { month, all } = req.query;
      let whereClause = '';
      let params = [];

      if (month && month !== 'all') {
        whereClause = 'WHERE TO_CHAR(date, \'YYYY-MM\') = $1';
        params = [month];
      }

      if (all !== 'true') {
        whereClause += whereClause ? ' AND price < 0' : 'WHERE price < 0';
      }

      const query = `
        SELECT
          category,
          parent_category,
          COUNT(*) as transaction_count,
          SUM(ABS(price)) as total_amount,
          AVG(ABS(price)) as avg_amount,
          MIN(date) as earliest_date,
          MAX(date) as latest_date
        FROM transactions
        ${whereClause}
        GROUP BY category, parent_category
        ORDER BY total_amount DESC
      `;

      const result = await dbManager.query(query, params);

      const categoryExpenses = result.rows.map(row => ({
        ...row,
        total_amount: parseFloat(row.total_amount) || 0,
        avg_amount: parseFloat(row.avg_amount) || 0,
        transaction_count: parseInt(row.transaction_count) || 0
      }));

      res.json(categoryExpenses);
    } catch (error) {
      console.error('Get category expenses error:', error);
      res.status(500).json({
        error: 'Failed to fetch category expenses',
        message: error.message
      });
    }
  }

  // Get expenses by month
  async getExpensesByMonth(req, res) {
    try {
      const query = `
        SELECT
          TO_CHAR(date, 'YYYY-MM') as month,
          TO_CHAR(date, 'Mon YYYY') as month_name,
          COUNT(*) as transaction_count,
          SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_expenses,
          SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as total_income,
          COUNT(DISTINCT category) as unique_categories
        FROM transactions
        WHERE date IS NOT NULL
        GROUP BY TO_CHAR(date, 'YYYY-MM'), TO_CHAR(date, 'Mon YYYY')
        ORDER BY month DESC
        LIMIT 12
      `;

      const result = await dbManager.query(query);

      const monthlyData = result.rows.map(row => ({
        ...row,
        total_expenses: parseFloat(row.total_expenses) || 0,
        total_income: parseFloat(row.total_income) || 0,
        transaction_count: parseInt(row.transaction_count) || 0,
        unique_categories: parseInt(row.unique_categories) || 0,
        net_balance: (parseFloat(row.total_income) || 0) - (parseFloat(row.total_expenses) || 0)
      }));

      res.json(monthlyData);
    } catch (error) {
      console.error('Get expenses by month error:', error);
      res.status(500).json({
        error: 'Failed to fetch expenses by month',
        message: error.message
      });
    }
  }

  // Get month by categories
  async getMonthByCategories(req, res) {
    try {
      const query = `
        SELECT
          TO_CHAR(date, 'YYYY-MM') as month,
          category,
          parent_category,
          COUNT(*) as transaction_count,
          SUM(ABS(price)) as total_amount
        FROM transactions
        WHERE date IS NOT NULL
          AND price < 0
          AND category IS NOT NULL
          AND category != ''
        GROUP BY TO_CHAR(date, 'YYYY-MM'), category, parent_category
        ORDER BY month DESC, total_amount DESC
      `;

      const result = await dbManager.query(query);

      const monthlyCategories = result.rows.map(row => ({
        ...row,
        total_amount: parseFloat(row.total_amount) || 0,
        transaction_count: parseInt(row.transaction_count) || 0
      }));

      res.json(monthlyCategories);
    } catch (error) {
      console.error('Get month by categories error:', error);
      res.status(500).json({
        error: 'Failed to fetch month by categories',
        message: error.message
      });
    }
  }

  // Get recent transactions
  async getRecentTransactions(req, res) {
    try {
      const { limit = 50, offset = 0 } = req.query;

      const query = `
        SELECT
          identifier,
          vendor,
          category,
          parent_category,
          memo,
          price,
          date,
          processed_date,
          account_number,
          type,
          status
        FROM transactions
        ORDER BY date DESC, processed_date DESC
        LIMIT $1 OFFSET $2
      `;

      const result = await dbManager.query(query, [parseInt(limit), parseInt(offset)]);

      const transactions = result.rows.map(row => ({
        ...row,
        price: parseFloat(row.price) || 0
      }));

      res.json({
        transactions,
        count: transactions.length,
        hasMore: transactions.length === parseInt(limit)
      });
    } catch (error) {
      console.error('Get recent transactions error:', error);
      res.status(500).json({
        error: 'Failed to fetch recent transactions',
        message: error.message
      });
    }
  }

  // Search transactions
  async searchTransactions(req, res) {
    try {
      const { query: searchQuery, category, vendor, startDate, endDate, limit = 100 } = req.query;

      let conditions = [];
      let params = [];
      let paramCount = 0;

      if (searchQuery) {
        paramCount++;
        conditions.push(`memo ILIKE $${paramCount}`);
        params.push(`%${searchQuery}%`);
      }

      if (category) {
        paramCount++;
        conditions.push(`category = $${paramCount}`);
        params.push(category);
      }

      if (vendor) {
        paramCount++;
        conditions.push(`vendor = $${paramCount}`);
        params.push(vendor);
      }

      if (startDate) {
        paramCount++;
        conditions.push(`date >= $${paramCount}`);
        params.push(startDate);
      }

      if (endDate) {
        paramCount++;
        conditions.push(`date <= $${paramCount}`);
        params.push(endDate);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      paramCount++;
      params.push(parseInt(limit));

      const sqlQuery = `
        SELECT
          identifier,
          vendor,
          category,
          parent_category,
          memo,
          price,
          date,
          processed_date,
          account_number,
          type,
          status
        FROM transactions
        ${whereClause}
        ORDER BY date DESC, processed_date DESC
        LIMIT $${paramCount}
      `;

      const result = await dbManager.query(sqlQuery, params);

      const transactions = result.rows.map(row => ({
        ...row,
        price: parseFloat(row.price) || 0
      }));

      res.json({
        transactions,
        count: transactions.length,
        searchQuery,
        filters: { category, vendor, startDate, endDate }
      });
    } catch (error) {
      console.error('Search transactions error:', error);
      res.status(500).json({
        error: 'Failed to search transactions',
        message: error.message
      });
    }
  }
}

module.exports = new TransactionAPIRoutes();