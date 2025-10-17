const { dbManager } = require('../database');
const { ElectronScraper } = require('../scraper');

class ScrapingAPIRoutes {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.scraper = new ElectronScraper(mainWindow);
  }

  // Main scraping endpoint
  async scrape(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
      const { options, credentials } = req.body;

      console.log('Received scrape request:');
      console.log('  Company ID:', options.companyId);
      console.log('  Start Date:', options.startDate);
      console.log('  Credentials keys:', Object.keys(credentials));

      // Validate required fields
      if (!options.companyId || !options.startDate || !credentials) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: companyId, startDate, or credentials'
        });
      }

      // Start scraping operation
      const result = await this.scraper.scrape(options, credentials);

      if (result.success) {
        res.status(200).json({
          success: true,
          message: 'Scraping completed successfully',
          accounts: result.accounts,
          transactionCount: result.transactionCount,
          bankTransactions: result.bankTransactions
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Scraping failed',
          errorType: result.errorType,
          errorMessage: result.errorMessage,
          error: result.error
        });
      }
    } catch (error) {
      console.error('Scrape API error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  // Get scraping events/history
  async getScrapeEvents(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
      const result = await dbManager.query(
        `SELECT id, triggered_by, vendor, start_date, status, message, created_at
         FROM scrape_events
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );

      res.status(200).json({
        success: true,
        events: result.rows
      });
    } catch (error) {
      console.error('Get scrape events error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch scrape events',
        error: error.message
      });
    }
  }

  // Get scraping status for a specific event
  async getScrapeStatus(req, res) {
    try {
      const { id } = req.params;
      const result = await dbManager.query(
        `SELECT id, triggered_by, vendor, start_date, status, message, created_at
         FROM scrape_events
         WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Scrape event not found'
        });
      }

      res.status(200).json({
        success: true,
        event: result.rows[0]
      });
    } catch (error) {
      console.error('Get scrape status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch scrape status',
        error: error.message
      });
    }
  }

  // Cancel active scraping operation
  async cancelScrape(req, res) {
    try {
      // TODO: Implement scraping cancellation logic
      // This would require tracking active scraper instances
      res.status(501).json({
        success: false,
        message: 'Scrape cancellation not yet implemented'
      });
    } catch (error) {
      console.error('Cancel scrape error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to cancel scrape',
        error: error.message
      });
    }
  }

  // Test scraper configuration without running full scrape
  async testScraper(req, res) {
    try {
      const { companyId } = req.body;

      if (!companyId) {
        return res.status(400).json({
          success: false,
          message: 'Company ID is required'
        });
      }

      // Validate company ID exists
      const { CompanyTypes } = require('israeli-bank-scrapers');
      const companyType = CompanyTypes[companyId];

      if (!companyType) {
        return res.status(400).json({
          success: false,
          message: `Invalid company ID: ${companyId}`
        });
      }

      res.status(200).json({
        success: true,
        message: 'Scraper configuration is valid',
        companyId,
        companyType,
        isSupported: true
      });
    } catch (error) {
      console.error('Test scraper error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to test scraper configuration',
        error: error.message
      });
    }
  }
}

module.exports = ScrapingAPIRoutes;