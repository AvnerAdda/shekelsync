// Add app directory to module search paths since dependencies are installed there
const path = require('path');
require('module').globalPaths.push(path.join(__dirname, '..', 'app', 'node_modules'));

const express = require(path.join(__dirname, '..', 'app', 'node_modules', 'express'));
const cors = require(path.join(__dirname, '..', 'app', 'node_modules', 'cors'));

// Import existing API routes from the Next.js app
const isDev = process.env.NODE_ENV === 'development';

// Import our core API routes
const coreRoutes = require('./api-routes/core');
const transactionRoutes = require('./api-routes/transactions');
const analyticsRoutes = require('./api-routes/analytics');
const ScrapingAPIRoutes = require('./api-routes/scraping');

async function setupAPIServer(mainWindow) {
  const app = express();

  // Middleware
  app.use(cors({
    origin: ['http://localhost:3000', 'file://', 'capacitor://localhost'],
    credentials: true
  }));

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Environment variables setup for API routes
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';

  // Core API routes (migrated to native Electron)
  app.get('/api/ping', coreRoutes.ping.bind(coreRoutes));
  app.get('/api/credentials', coreRoutes.getCredentials.bind(coreRoutes));
  app.get('/api/transaction-stats', coreRoutes.getTransactionStats.bind(coreRoutes));
  app.get('/api/get_all_categories', coreRoutes.getCategories.bind(coreRoutes));
  app.get('/api/database-info', coreRoutes.getDatabaseInfo.bind(coreRoutes));

  // Transaction API routes (migrated)
  app.get('/api/available_months', transactionRoutes.getAvailableMonths.bind(transactionRoutes));
  app.get('/api/box_panel_data', transactionRoutes.getBoxPanelData.bind(transactionRoutes));
  app.get('/api/category_expenses', transactionRoutes.getCategoryExpenses.bind(transactionRoutes));
  app.get('/api/expenses_by_month', transactionRoutes.getExpensesByMonth.bind(transactionRoutes));
  app.get('/api/month_by_categories', transactionRoutes.getMonthByCategories.bind(transactionRoutes));
  app.get('/api/transactions/recent', transactionRoutes.getRecentTransactions.bind(transactionRoutes));
  app.get('/api/transactions/search', transactionRoutes.searchTransactions.bind(transactionRoutes));

  // Analytics API routes (migrated)
  app.get('/api/analytics/unified-category', analyticsRoutes.getUnifiedCategory.bind(analyticsRoutes));
  app.get('/api/analytics/dashboard', analyticsRoutes.getDashboardAnalytics.bind(analyticsRoutes));
  app.get('/api/analytics/breakdown', analyticsRoutes.getBreakdownAnalytics.bind(analyticsRoutes));
  app.get('/api/analytics/personal-intelligence', analyticsRoutes.getPersonalIntelligence.bind(analyticsRoutes));

  // Scraping API routes (native Electron)
  const scrapingRoutes = new ScrapingAPIRoutes(mainWindow);
  app.post('/api/scrape', scrapingRoutes.scrape.bind(scrapingRoutes));
  app.get('/api/scrape_events', scrapingRoutes.getScrapeEvents.bind(scrapingRoutes));
  app.get('/api/scrape/status/:id', scrapingRoutes.getScrapeStatus.bind(scrapingRoutes));
  app.post('/api/scrape/test', scrapingRoutes.testScraper.bind(scrapingRoutes));

  // Import and setup API routes dynamically
  const apiPath = path.join(__dirname, '..', 'app', 'pages', 'api');

  // Helper function to setup route from Next.js API handler
  const setupRoute = (routePath, handler) => {
    app.all(routePath, async (req, res) => {
      try {
        // Create Next.js compatible request/response objects
        const nextReq = {
          ...req,
          query: { ...req.query, ...req.params },
          body: req.body
        };

        const nextRes = {
          ...res,
          status: (code) => {
            res.status(code);
            return nextRes;
          },
          json: (data) => {
            res.json(data);
            return nextRes;
          },
          send: (data) => {
            res.send(data);
            return nextRes;
          },
          setHeader: (name, value) => {
            res.setHeader(name, value);
            return nextRes;
          },
          getHeader: (name) => res.getHeader(name),
          removeHeader: (name) => {
            res.removeHeader(name);
            return nextRes;
          },
          end: (data) => {
            if (data) res.send(data);
            else res.end();
            return nextRes;
          }
        };

        // Execute the Next.js API handler
        await handler(nextReq, nextRes);
      } catch (error) {
        console.error(`Error in route ${routePath}:`, error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal Server Error', message: error.message });
        }
      }
    });
  };

  // Core API routes setup
  try {
    // Database and utility routes
    const pingHandler = require(path.join(apiPath, 'ping.js'));
    setupRoute('/api/ping', pingHandler.default || pingHandler);

    const dbHandler = require(path.join(apiPath, 'db.js'));
    // Note: db.js is a utility, not a route handler

    // Transaction routes
    const availableMonthsHandler = require(path.join(apiPath, 'available_months.js'));
    setupRoute('/api/available_months', availableMonthsHandler.default || availableMonthsHandler);

    const boxPanelDataHandler = require(path.join(apiPath, 'box_panel_data.js'));
    setupRoute('/api/box_panel_data', boxPanelDataHandler.default || boxPanelDataHandler);

    const categoriesHandler = require(path.join(apiPath, 'get_all_categories.js'));
    setupRoute('/api/get_all_categories', categoriesHandler.default || categoriesHandler);

    const categoryByMonthHandler = require(path.join(apiPath, 'category_by_month.js'));
    setupRoute('/api/category_by_month', categoryByMonthHandler.default || categoryByMonthHandler);

    const categoryExpensesHandler = require(path.join(apiPath, 'category_expenses.js'));
    setupRoute('/api/category_expenses', categoryExpensesHandler.default || categoryExpensesHandler);

    const expensesByMonthHandler = require(path.join(apiPath, 'expenses_by_month.js'));
    setupRoute('/api/expenses_by_month', expensesByMonthHandler.default || expensesByMonthHandler);

    const monthByCategoriesHandler = require(path.join(apiPath, 'month_by_categories.js'));
    setupRoute('/api/month_by_categories', monthByCategoriesHandler.default || monthByCategoriesHandler);

    // Categorization routes
    const categorizeTransactionHandler = require(path.join(apiPath, 'categorize_transaction.js'));
    setupRoute('/api/categorize_transaction', categorizeTransactionHandler.default || categorizeTransactionHandler);

    const categorizationRulesHandler = require(path.join(apiPath, 'categorization_rules.js'));
    setupRoute('/api/categorization_rules', categorizationRulesHandler.default || categorizationRulesHandler);

    const applyCategorisationRulesHandler = require(path.join(apiPath, 'apply_categorization_rules.js'));
    setupRoute('/api/apply_categorization_rules', applyCategorisationRulesHandler.default || applyCategorisationRulesHandler);

    const mergeCategoriesHandler = require(path.join(apiPath, 'merge_categories.js'));
    setupRoute('/api/merge_categories', mergeCategoriesHandler.default || mergeCategoriesHandler);

    // Manual transaction route
    const manualTransactionHandler = require(path.join(apiPath, 'manual_transaction.js'));
    setupRoute('/api/manual_transaction', manualTransactionHandler.default || manualTransactionHandler);

    // Scraping routes
    const scrapeHandler = require(path.join(apiPath, 'scrape.js'));
    setupRoute('/api/scrape', scrapeHandler.default || scrapeHandler);

    const scrapeEventsHandler = require(path.join(apiPath, 'scrape_events.js'));
    setupRoute('/api/scrape_events', scrapeEventsHandler.default || scrapeEventsHandler);

    // Chat route
    const chatHandler = require(path.join(apiPath, 'chat.js'));
    setupRoute('/api/chat', chatHandler.default || chatHandler);

    // Migration route
    const migrateHandler = require(path.join(apiPath, 'migrate.js'));
    setupRoute('/api/migrate', migrateHandler.default || migrateHandler);

    console.log('Core API routes loaded successfully');
  } catch (error) {
    console.error('Error loading core API routes:', error);
  }

  // Setup nested route directories
  const setupNestedRoutes = (basePath, routeDir) => {
    try {
      const fs = require('fs');
      const fullPath = path.join(apiPath, routeDir);

      if (fs.existsSync(fullPath)) {
        const files = fs.readdirSync(fullPath);

        files.forEach(file => {
          if (file.endsWith('.js')) {
            const routeName = file.replace('.js', '');
            const routePath = `${basePath}/${routeName}`;

            try {
              const handler = require(path.join(fullPath, file));
              setupRoute(routePath, handler.default || handler);
              console.log(`Loaded route: ${routePath}`);
            } catch (error) {
              console.error(`Error loading route ${routePath}:`, error);
            }
          }
        });
      }
    } catch (error) {
      console.error(`Error setting up nested routes for ${basePath}:`, error);
    }
  };

  // Setup nested API routes
  setupNestedRoutes('/api/credentials', 'credentials');
  setupNestedRoutes('/api/categorization_rules', 'categorization_rules');
  setupNestedRoutes('/api/transactions', 'transactions');
  setupNestedRoutes('/api/duplicates', 'duplicates');
  setupNestedRoutes('/api/patterns', 'patterns');
  setupNestedRoutes('/api/budgets', 'budgets');
  setupNestedRoutes('/api/profile', 'profile');
  setupNestedRoutes('/api/analytics', 'analytics');
  setupNestedRoutes('/api/investments', 'investments');
  setupNestedRoutes('/api/notifications', 'notifications');
  setupNestedRoutes('/api/data', 'data');
  setupNestedRoutes('/api/categories', 'categories');

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      platform: process.platform
    });
  });

  // Error handling middleware
  app.use((error, req, res, next) => {
    console.error('Express error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: error.message,
        ...(isDev && { stack: error.stack })
      });
    }
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.originalUrl} not found`,
      availableRoutes: [
        '/health',
        '/api/ping',
        '/api/credentials',
        '/api/available_months',
        '/api/get_all_categories',
        '/api/database-info'
      ]
    });
  });

  // Start server on random available port
  return new Promise((resolve, reject) => {
    const server = app.listen(0, 'localhost', () => {
      const port = server.address().port;
      console.log(`Electron API server running on http://localhost:${port}`);

      resolve({
        server,
        port,
        app
      });
    });

    server.on('error', (error) => {
      console.error('Server start error:', error);
      reject(error);
    });
  });
}

module.exports = { setupAPIServer };