const { dbManager } = require('../database');
const { resolveAppPath } = require('../paths');
const healthService = require(resolveAppPath('server', 'services', 'health.js'));
const transactionsMetrics = require(resolveAppPath(
  'server',
  'services',
  'transactions',
  'metrics.js',
));

// Core API route handlers
class CoreAPIRoutes {
  // Ping endpoint for health checks
  async ping(req, res) {
    try {
      const startTime = Date.now();

      const health = await healthService.ping();
      const responseTime = Date.now() - startTime;

      if (!health.ok) {
        return res.status(500).json({
          status: health.status,
          message: 'Database connectivity check failed',
          error: health.error,
        });
      }

      const dbTest = await dbManager.testConnection();

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
      const categories = await transactionsMetrics.listCategories();
      res.json(categories);
    } catch (error) {
      console.error('Get categories error:', error);
      res.status(error.status || 500).json({
        error: error.message || 'Failed to fetch categories',
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
