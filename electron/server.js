require('./setup-module-alias');

// Add app directory to module search paths since dependencies are installed there
const { resolveAppPath, requireFromApp } = require('./paths');
require('module').globalPaths.push(resolveAppPath('node_modules'));

const express = requireFromApp('express');
const cors = requireFromApp('cors');

// Import existing API routes from the Next.js app
const isDev = process.env.NODE_ENV === 'development';

// Import our core API routes
const coreRoutes = require('./api-routes/core');
const migrationsRoutes = require('./api-routes/migrations');
const { createAnalyticsRouter } = require(resolveAppPath('server', 'routes', 'analytics.js'));
const { createAccountsRouter } = require(resolveAppPath('server', 'routes', 'accounts.js'));
const { createBudgetsRouter } = require(resolveAppPath('server', 'routes', 'budgets.js'));
const transactionHandlers = require(resolveAppPath('server', 'routes', 'transactions.js'));
const { createOnboardingRouter } = require(resolveAppPath('server', 'routes', 'onboarding.js'));
const { createNotificationsRouter } = require(resolveAppPath('server', 'routes', 'notifications.js'));
const { createDataExportRouter } = require(resolveAppPath('server', 'routes', 'data-export.js'));
const { createScrapingRouter } = require(resolveAppPath('server', 'routes', 'scraping.js'));
const { createProfileRouter } = require(resolveAppPath('server', 'routes', 'profile.js'));
const { createChatRouter } = require(resolveAppPath('server', 'routes', 'chat.js'));
const { createInvestmentsRouter } = require(resolveAppPath('server', 'routes', 'investments.js'));
const { createPatternsRouter } = require(resolveAppPath('server', 'routes', 'patterns.js'));
const { createAnalyticsActionItemsRouter } = require(resolveAppPath(
  'server',
  'routes',
  'analytics-action-items.js',
));
const { createCredentialsRouter } = require(resolveAppPath('server', 'routes', 'credentials.js'));
const { createCategorizationRouter } = require(resolveAppPath('server', 'routes', 'categorization.js'));
const { createCategoriesRouter } = require(resolveAppPath('server', 'routes', 'categories.js'));
const institutionsService = require(resolveAppPath('server', 'services', 'institutions.js'));
const { createInstitutionsRouter } = require(resolveAppPath('server', 'routes', 'institutions.js'));
const createSpendingCategoriesRouter = require(resolveAppPath('server', 'routes', 'spending-categories.js'));
const createSmartActionsRouter = require(resolveAppPath('server', 'routes', 'smart-actions.js'));
const createBudgetIntelligenceRouter = require(resolveAppPath('server', 'routes', 'budget-intelligence.js'));
const createCategoryVariabilityRouter = require(resolveAppPath('server', 'routes', 'category-variability.js'));

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
  app.get('/health', coreRoutes.healthz.bind(coreRoutes));
  app.get('/healthz', coreRoutes.healthz.bind(coreRoutes));
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

  // Financial institutions
  app.use('/api/institutions', createInstitutionsRouter());

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

  // Spending categories (new intelligent system)
  app.use('/api/spending-categories', createSpendingCategoriesRouter());

  // Smart actions (AI-generated action items)
  app.use('/api/smart-actions', createSmartActionsRouter());

  // Budget intelligence (auto-suggestions & forecasting)
  app.use('/api/budget-intelligence', createBudgetIntelligenceRouter());

  // Category variability analysis
  app.use('/api/category-variability', createCategoryVariabilityRouter());

  // Data export (migrated)
  app.use('/api/data', createDataExportRouter());

  // Scraping API routes (shared router)
  app.use('/api', createScrapingRouter({ mainWindow }));
  // Fire-and-forget backfill to ensure legacy accounts gain institution IDs
  institutionsService.backfillMissingInstitutionIds()
    .catch((error) => console.error('Institution backfill failed:', error));

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
        '/healthz',
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
