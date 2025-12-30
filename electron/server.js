require('./setup-module-alias');

// Add app directory to module search paths since dependencies are installed there
const { resolveAppPath, requireFromApp } = require('./paths');
require('module').globalPaths.push(resolveAppPath('node_modules'));

const express = requireFromApp('express');
const cors = requireFromApp('cors');

// Import existing API routes from the Next.js app
const isDev = process.env.NODE_ENV === 'development';
const { dbManager } = require('./database');

// Import our core API routes
const coreRoutes = require('./api-routes/core');
const migrationsRoutes = require('./api-routes/migrations');
const transactionHandlers = require(resolveAppPath('server', 'routes', 'transactions.js'));
const { createScrapingRouter } = require(resolveAppPath('server', 'routes', 'scraping.js'));
const { resolveLocaleFromRequest } = require(resolveAppPath('lib', 'server', 'locale-utils.js'));
const { createAccountsRouter } = require(resolveAppPath('server', 'routes', 'accounts.js'));
const { createOnboardingRouter } = require(resolveAppPath('server', 'routes', 'onboarding.js'));
const { createCredentialsRouter } = require(resolveAppPath('server', 'routes', 'credentials.js'));
const { createCategoriesRouter } = require(resolveAppPath('server', 'routes', 'categories.js'));
const { createNotificationsRouter } = require(resolveAppPath('server', 'routes', 'notifications.js'));
const institutionsService = require(resolveAppPath('server', 'services', 'institutions.js'));

function lazyRouter(factory) {
  let router = null;
  return (req, res, next) => {
    try {
      if (!router) {
        router = factory();
      }
      return router(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

async function setupAPIServer(mainWindow, options = {}) {
  const app = express();
  const preferredPort = Number(process.env.ELECTRON_API_PORT || options.port || 0) || 0;

  // Middleware
  app.use(cors({
    origin: ['http://localhost:3000', 'file://', 'capacitor://localhost'],
    credentials: true
  }));

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use((req, _res, next) => {
    req.locale = resolveLocaleFromRequest(req);
    next();
  });

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

  // Onboarding routes (migrated)
  app.use('/api/onboarding', createOnboardingRouter());

  // Credentials (migrated)
  app.use('/api/credentials', createCredentialsRouter());

  // Category hierarchy routes (migrated)
  app.use('/api/categories', createCategoriesRouter());

  // Profile routes (migrated, heavy-ish) – lazy load
  app.use(
    '/api/profile',
    lazyRouter(() => require(resolveAppPath('server', 'routes', 'profile.js')).createProfileRouter()),
  );

  // Analytics API routes (migrated) – lazy load
  app.use(
    '/api/analytics',
    lazyRouter(() => require(resolveAppPath('server', 'routes', 'analytics.js')).createAnalyticsRouter()),
  );

  // Investment routes (migrated) – lazy load
  app.use(
    '/api/investments',
    lazyRouter(() => require(resolveAppPath('server', 'routes', 'investments.js')).createInvestmentsRouter()),
  );

  // Financial institutions
  app.use(
    '/api/institutions',
    lazyRouter(() => require(resolveAppPath('server', 'routes', 'institutions.js')).createInstitutionsRouter()),
  );

  // Pattern routes (migrated) – lazy load
  app.use(
    '/api/patterns',
    lazyRouter(() => require(resolveAppPath('server', 'routes', 'patterns.js')).createPatternsRouter()),
  );

  // Forecast routes (Monte Carlo simulation) – lazy load
  app.use(
    '/api/forecast',
    lazyRouter(() =>
      require(resolveAppPath('server', 'routes', 'forecast.js')).createForecastRouter({
        sqliteDb: dbManager.getSqliteDatabase?.(),
      }),
    ),
  );

  // Budget routes (migrated) – lazy load
  app.use(
    '/api/budgets',
    lazyRouter(() => require(resolveAppPath('server', 'routes', 'budgets.js')).createBudgetsRouter()),
  );

  // Categorization rules (migrated) – lazy load
  app.use(
    '/api',
    lazyRouter(() => require(resolveAppPath('server', 'routes', 'categorization.js')).createCategorizationRouter()),
  );

  // Database migrations (migrated)
  app.post('/api/migrate', migrationsRoutes.runInvestmentsMigration.bind(migrationsRoutes));

  // Manual transactions & transaction maintenance (migrated)
  app.post('/api/manual_transaction', (req, res) =>
    transactionHandlers.createManualTransaction(req, res),
  );

  // Chat assistant (migrated) – lazy load
  app.use(
    '/api/chat',
    lazyRouter(() => require(resolveAppPath('server', 'routes', 'chat.js')).createChatRouter()),
  );

  app.put('/api/transactions/:id', (req, res) => transactionHandlers.updateTransaction(req, res));
  app.put('/api/transactions', (req, res) => transactionHandlers.updateTransaction(req, res));
  app.delete('/api/transactions/:id', (req, res) => transactionHandlers.deleteTransaction(req, res));
  app.delete('/api/transactions', (req, res) => transactionHandlers.deleteTransaction(req, res));

  // Notifications (migrated)
  app.use('/api/notifications', createNotificationsRouter());

  // Spending categories (new intelligent system) – lazy load
  app.use(
    '/api/spending-categories',
    lazyRouter(() => require(resolveAppPath('server', 'routes', 'spending-categories.js'))()),
  );

  // Smart actions (AI-generated action items) – lazy load
  app.use(
    '/api/smart-actions',
    lazyRouter(() => require(resolveAppPath('server', 'routes', 'smart-actions.js'))()),
  );

  // Category variability analysis – lazy load
  app.use(
    '/api/category-variability',
    lazyRouter(() => require(resolveAppPath('server', 'routes', 'category-variability.js'))()),
  );

  // Data export (migrated) – lazy load
  app.use(
    '/api/data',
    lazyRouter(() => require(resolveAppPath('server', 'routes', 'data-export.js')).createDataExportRouter()),
  );

  // Scraping API routes (shared router)
  app.use('/api', createScrapingRouter({ mainWindow }));

  // Fire-and-forget backfill to ensure legacy accounts gain institution IDs (deferred to avoid slowing boot)
  setTimeout(() => {
    institutionsService.backfillMissingInstitutionIds()
      .catch((error) => console.error('Institution backfill failed:', error));
  }, 10000);

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

  // Start server on specified or random available port
  return new Promise((resolve, reject) => {
    const server = app.listen(preferredPort, 'localhost', () => {
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
