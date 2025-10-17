const path = require('path');
const { dbManager } = require('../database');

// Import original Next.js API handlers for reference
const apiPath = path.join(__dirname, '..', '..', 'app', 'pages', 'api');

// Core API route handlers
class CoreAPIRoutes {
  // Ping endpoint for health checks
  async ping(req, res) {
    try {
      const startTime = Date.now();

      // Test database connection
      const dbTest = await dbManager.testConnection();
      const responseTime = Date.now() - startTime;

      res.json({
        status: 'ok',
        message: 'ShekelSync Electron API is running',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        database: dbTest.success ? 'connected' : 'disconnected',
        environment: process.env.NODE_ENV || 'development',
        version: '0.1.0'
      });
    } catch (error) {
      console.error('Ping error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  // Get all credentials (encrypted)
  async getCredentials(req, res) {
    try {
      const query = `
        SELECT
          id,
          vendor,
          nickname,
          credential_type,
          created_at,
          updated_at,
          is_active
        FROM vendor_credentials
        WHERE is_active = true
        ORDER BY created_at DESC
      `;

      const result = await dbManager.query(query);

      res.json({
        success: true,
        credentials: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Get credentials error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch credentials',
        message: error.message
      });
    }
  }

  // Get basic transaction statistics
  async getTransactionStats(req, res) {
    try {
      const query = `
        SELECT
          COUNT(*) as total_transactions,
          COUNT(DISTINCT vendor) as unique_vendors,
          COUNT(DISTINCT category) as unique_categories,
          MIN(date) as earliest_transaction,
          MAX(date) as latest_transaction,
          SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as total_income,
          SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_expenses
        FROM transactions
      `;

      const result = await dbManager.query(query);
      const stats = result.rows[0];

      // Convert string numbers to actual numbers
      Object.keys(stats).forEach(key => {
        if (stats[key] && !isNaN(stats[key]) && key !== 'total_transactions') {
          stats[key] = parseFloat(stats[key]);
        }
      });

      res.json({
        success: true,
        stats: stats
      });
    } catch (error) {
      console.error('Get transaction stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch transaction statistics',
        message: error.message
      });
    }
  }

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

      res.json({
        success: true,
        months: result.rows
      });
    } catch (error) {
      console.error('Get available months error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch available months',
        message: error.message
      });
    }
  }

  // Get all categories
  async getCategories(req, res) {
    try {
      const query = `
        SELECT DISTINCT
          category,
          parent_category,
          COUNT(*) as transaction_count,
          SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_spent
        FROM transactions
        WHERE category IS NOT NULL
          AND category != ''
        GROUP BY category, parent_category
        ORDER BY total_spent DESC
      `;

      const result = await dbManager.query(query);

      // Process categories into hierarchical structure
      const categories = result.rows.map(row => ({
        ...row,
        total_spent: parseFloat(row.total_spent) || 0,
        transaction_count: parseInt(row.transaction_count) || 0
      }));

      res.json({
        success: true,
        categories: categories,
        count: categories.length
      });
    } catch (error) {
      console.error('Get categories error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch categories',
        message: error.message
      });
    }
  }

  // Get database connection info
  async getDatabaseInfo(req, res) {
    try {
      const stats = await dbManager.getStats();
      const testResult = await dbManager.testConnection();

      res.json({
        success: true,
        connection: {
          isConnected: dbManager.isConnected,
          stats: stats,
          testResult: testResult
        }
      });
    } catch (error) {
      console.error('Get database info error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get database information',
        message: error.message
      });
    }
  }
}

module.exports = new CoreAPIRoutes();