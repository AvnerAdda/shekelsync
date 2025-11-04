require('./setup-module-alias');

// Add app directory to module search paths since dependencies are installed there
const path = require('path');
require('module').globalPaths.push(path.join(__dirname, '..', 'app', 'node_modules'));

const express = require(path.join(__dirname, '..', 'app', 'node_modules', 'express'));
const cors = require(path.join(__dirname, '..', 'app', 'node_modules', 'cors'));

// Import existing API routes from the Next.js app
const isDev = process.env.NODE_ENV === 'development';

// Import our core API routes
const coreRoutes = require('./api-routes/core');
const migrationsRoutes = require('./api-routes/migrations');
const { createAnalyticsRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'analytics.js'));
const { createAccountsRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'accounts.js'));
const { createBudgetsRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'budgets.js'));
const transactionHandlers = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'transactions.js'));
const { createOnboardingRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'onboarding.js'));
const { createNotificationsRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'notifications.js'));
const { createDataExportRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'data-export.js'));
const { createScrapingRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'scraping.js'));
const { createProfileRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'profile.js'));
const { createChatRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'chat.js'));
const { createInvestmentsRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'investments.js'));
const { createPatternsRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'patterns.js'));
const { createAnalyticsActionItemsRouter } = require(path.join(
  __dirname,
  '..',
  'app',
  'server',
  'routes',
  'analytics-action-items.js',
));
const { createCredentialsRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'credentials.js'));
const { createCategorizationRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'categorization.js'));
const { createCategoriesRouter } = require(path.join(__dirname, '..', 'app', 'server', 'routes', 'categories.js'));

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
  app.get('/api/transaction-stats', coreRoutes.getTransactionStats.bind(coreRoutes));
  app.get('/api/get_all_categories', coreRoutes.getCategories.bind(coreRoutes));
  app.get('/api/database-info', coreRoutes.getDatabaseInfo.bind(coreRoutes));

  // Transaction API routes (migrated)
  app.get('/api/available_months', transactionHandlers.getAvailableMonths);
  app.get('/api/box_panel_data', transactionHandlers.getBoxPanelData);
  app.get('/api/category_by_month', transactionHandlers.getCategoryByMonth);
  app.get('/api/category_expenses', transactionHandlers.getCategoryExpenses);
  app.get('/api/expenses_by_month', transactionHandlers.getExpensesByMonth);
  app.get('/api/month_by_categories', transactionHandlers.getMonthByCategories);
  app.get('/api/transactions/recent', transactionHandlers.getRecentTransactions);
  app.get('/api/transactions/search', transactionHandlers.searchTransactions);

  // Account management routes (shared router)
  app.use('/api/accounts', createAccountsRouter());

  // Profile routes (migrated)
  app.use('/api/profile', createProfileRouter());

  // Onboarding routes (migrated)
  app.use('/api/onboarding', createOnboardingRouter());

  // Analytics API routes (migrated)
  app.use('/api/analytics', createAnalyticsRouter());

  // Investment routes (migrated)
  app.use('/api/investments', createInvestmentsRouter());

  // Pattern routes (migrated)
  app.use('/api/patterns', createPatternsRouter());

  // Category hierarchy routes (migrated)
  app.use('/api/categories', createCategoriesRouter());

  // Budget routes (migrated)
  app.use('/api/budgets', createBudgetsRouter());

  // Credentials (migrated)
  app.use('/api/credentials', createCredentialsRouter());

  // Categorization rules (migrated)
  app.use('/api', createCategorizationRouter());

  // Database migrations (migrated)
  app.post('/api/migrate', migrationsRoutes.runInvestmentsMigration.bind(migrationsRoutes));

  // Manual transactions & transaction maintenance (migrated)
  app.post('/api/manual_transaction', (req, res) =>
    transactionHandlers.createManualTransaction(req, res),
  );

  // Chat assistant (migrated)
  app.use('/api/chat', createChatRouter());

  app.put('/api/transactions/:id', (req, res) => transactionHandlers.updateTransaction(req, res));
  app.put('/api/transactions', (req, res) => transactionHandlers.updateTransaction(req, res));
  app.delete('/api/transactions/:id', (req, res) => transactionHandlers.deleteTransaction(req, res));
  app.delete('/api/transactions', (req, res) => transactionHandlers.deleteTransaction(req, res));

  // Notifications (migrated)
  app.use('/api/notifications', createNotificationsRouter());

  // Action items (migrated)
  app.use('/api/analytics/action-items', createAnalyticsActionItemsRouter());

  // Data export (migrated)
  app.use('/api/data', createDataExportRouter());

  // Scraping API routes (shared router)
  app.use('/api', createScrapingRouter({ mainWindow }));

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
