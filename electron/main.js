require('./setup-module-alias');

const { app, BrowserWindow, ipcMain, dialog, shell, session, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  appRoot,
  rendererRoot,
  resolveAppPath,
  resolveRendererPath,
  requireFromApp,
} = require('./paths');
const {
  logger,
  recordRendererLog,
} = require('./logger');
const {
  getDiagnosticsInfo,
  openDiagnosticsLogDirectory,
  exportDiagnosticsToFile,
} = require('./diagnostics');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Load environment variables from the Next.js app if present (e.g., USE_SQLITE)
try {
  const dotenv = requireFromApp('dotenv');
  const envFile = path.join(appRoot, '.env.local');
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
  }
} catch (error) {
  console.warn('Unable to load dotenv configuration:', error.message);
}

// Reduce GPU-related crashes in certain Linux setups
try {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
} catch (error) {
  console.warn('Failed to disable hardware acceleration:', error.message);
}

// Handle module resolution for development vs production
let autoUpdater;
try {
  if (isDev) {
    autoUpdater = requireFromApp('electron-updater').autoUpdater;
  } else {
    autoUpdater = require('electron-updater').autoUpdater;
  }
} catch (error) {
  console.log('electron-updater not available:', error.message);
  autoUpdater = null;
}

const MIGRATION_ENV_FLAG = 'ALLOW_DB_MIGRATE';
if (typeof process.env[MIGRATION_ENV_FLAG] === 'undefined') {
  process.env[MIGRATION_ENV_FLAG] = 'false';
}
if (process.env[MIGRATION_ENV_FLAG] === 'true') {
  console.warn(`${MIGRATION_ENV_FLAG} flag is enabled. Proceed only if this build is intended for database maintenance.`);
}

// Import configuration and database managers
const { configManager } = require('./config');
const { dbManager } = require('./database');
const sessionStore = require('./session-store');

// Lazy-loaded services (to avoid loading better-sqlite3 in dev mode)
let healthService = null;
let scrapingService = null;
let setupAPIServer = null;

// Helper to lazy-load services only when needed (and not in SQLite dev mode)
function getHealthService() {
  if (!healthService) {
    healthService = require(resolveAppPath('server', 'services', 'health.js'));
  }
  return healthService;
}

function getScrapingService() {
  if (!scrapingService) {
    scrapingService = require(resolveAppPath('server', 'services', 'scraping', 'run.js'));
  }
  return scrapingService;
}

// Keep a global reference of the window object
let mainWindow;
let apiServer;
let apiPort;
let appTray;

// Development mode logging
if (isDev) {
  console.log('Running in development mode');
}
logger.info('Booting ShekelSync Electron shell', {
  environment: process.env.NODE_ENV || 'development',
  isDev,
});

function sanitizeSession(session) {
  if (!session) {
    return null;
  }

  const { refreshToken, ...rest } = session;
  return {
    ...rest,
  };
}

function sendScrapeProgress(payload) {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('scrape:progress', payload);
  }
}

function emitSessionChanged(session) {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('auth:session-changed', sanitizeSession(session));
  }
}

function createScrapeLogger(vendor) {
  const prefix = vendor ? `[Scrape:${vendor}]` : '[Scrape]';
  return {
    log: (...args) => console.log(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

function formatDiagnosticsFilename() {
  return `shekelsync-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
}

async function handleOpenLogFolderRequest() {
  const result = await openDiagnosticsLogDirectory();
  if (!result.success) {
    dialog.showErrorBox('Open Log Folder Failed', result.error || 'Unable to open log folder.');
  }
}

async function handleDiagnosticsExportRequest() {
  const browserWindow = mainWindow || BrowserWindow.getFocusedWindow() || undefined;
  const saveResult = await dialog.showSaveDialog(browserWindow, {
    defaultPath: formatDiagnosticsFilename(),
    filters: [{ name: 'Diagnostics Bundle', extensions: ['json'] }],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { success: false, canceled: true };
  }

  const exportResult = await exportDiagnosticsToFile(saveResult.filePath, {
    appVersion: app.getVersion(),
  });

  if (!exportResult.success) {
    dialog.showErrorBox('Diagnostics Export Failed', exportResult.error || 'Unable to export diagnostics bundle.');
  }

  return exportResult;
}

function getTrayIconPath() {
  const iconDir = path.join(__dirname, '..', 'build-resources');
  if (process.platform === 'win32') {
    const winIcon = path.join(iconDir, 'logo.ico');
    if (fs.existsSync(winIcon)) {
      return winIcon;
    }
  }
  if (process.platform === 'darwin') {
    const templateIcon = path.join(iconDir, 'trayTemplate.png');
    if (fs.existsSync(templateIcon)) {
      return templateIcon;
    }
  }
  const pngIcon = path.join(iconDir, 'logo.png');
  if (fs.existsSync(pngIcon)) {
    return pngIcon;
  }
  return path.join(iconDir, 'logo.png');
}

function setupTray() {
  if (appTray) {
    return;
  }
  const trayIconPath = getTrayIconPath();
  const icon = nativeImage.createFromPath(trayIconPath);
  appTray = new Tray(icon);
  appTray.setToolTip('ShekelSync');
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show ShekelSync',
      click: () => {
        if (mainWindow) {
          if (!mainWindow.isVisible()) {
            mainWindow.show();
          }
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Open Log Folder',
      click: () => {
        handleOpenLogFolderRequest();
      },
    },
    {
      label: 'Export Diagnostics…',
      click: () => {
        handleDiagnosticsExportRequest();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);
  appTray.setContextMenu(contextMenu);
  appTray.on('click', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    }
  });
}

async function createWindow() {
  const skipEmbeddedApi = process.env.SKIP_EMBEDDED_API === 'true';
  const devRendererUrl = process.env.RENDERER_DEV_URL || 'http://localhost:5173';

  // Initialize configuration and database
  try {
    console.log('Initializing application configuration...');
    logger.info('Initializing configuration');
    const config = await configManager.initializeConfig();
    logger.info('Configuration initialised', {
      databaseMode: config?.database?.mode,
    });

    const usingSqliteEnv =
      process.env.USE_SQLITE === 'true' ||
      Boolean(process.env.SQLITE_DB_PATH) ||
      config.database.mode === 'sqlite';
    if (!config.database) {
      config.database = {};
    }
    if (!config.database.mode) {
      config.database.mode = usingSqliteEnv ? 'sqlite' : 'postgres';
    }

    if (config.database.mode === 'postgres') {
      process.env.USE_SQLITE = 'false';
      delete process.env.SQLITE_DB_PATH;
      delete process.env.USE_SQLCIPHER;
      delete process.env.SQLCIPHER_DB_PATH;

      process.env.CLARIFY_DB_USER = config.database.user;
      process.env.CLARIFY_DB_HOST = config.database.host;
      process.env.CLARIFY_DB_NAME = config.database.database;
      process.env.CLARIFY_DB_PASSWORD = config.database.password;
      process.env.CLARIFY_DB_PORT = String(config.database.port ?? 5432);
    } else {
      process.env.USE_SQLITE = 'true';
      const sqlitePath =
        config.database.path ||
        process.env.SQLITE_DB_PATH ||
        path.join(app.getPath('userData'), 'clarify.sqlite');
      process.env.SQLITE_DB_PATH = sqlitePath;
      config.database.path = sqlitePath;
    }

    if (skipEmbeddedApi) {
      console.log('SKIP_EMBEDDED_API=true, embedded API server startup disabled.');
    }

    if (!skipEmbeddedApi && !setupAPIServer) {
      try {
        setupAPIServer = require('./server').setupAPIServer;
      } catch (error) {
        console.log('API server module not available, running in basic mode:', error.message);
        setupAPIServer = null;
      }
    }

    let dbResult = { success: false };
    if (skipEmbeddedApi) {
      console.log('Skipping main-process database initialization (SKIP_EMBEDDED_API=true).');
    } else {
      console.log('Initializing database connection...');
      logger.info('Connecting to database', { mode: config.database.mode });
      dbResult = await dbManager.initialize(config.database);

      if (!dbResult.success) {
        console.error('Database initialization failed:', dbResult.message);
        logger.error('Database initialization failed', {
          error: dbResult.message,
          mode: config.database.mode,
        });
        dialog.showErrorBox(
          'Database Connection Error',
          `Failed to connect to database: ${dbResult.message}\n\nThe app will run in limited mode.`
        );
      }
    }
  } catch (error) {
    console.error('Initialization error:', error);
    logger.error('Fatal initialization error', { error: error.message });
    dialog.showErrorBox(
      'Initialization Error',
      `Failed to initialize application: ${error.message}`
    );
  }

  if (isDev) {
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
  }

  // Apply a conservative Content Security Policy in production.
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
      ].join('; ');

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
    });
  }

  // Determine icon path based on platform and environment
  const getIconPath = () => {
    const iconDir = path.join(__dirname, '..', 'build-resources');

    if (process.platform === 'win32') {
      return path.join(iconDir, 'logo.ico');
    } else if (process.platform === 'darwin') {
      // For macOS, use .icns if available, fallback to .png
      const icnsPath = path.join(iconDir, 'logo.icns');
      return fs.existsSync(icnsPath) ? icnsPath : path.join(iconDir, 'logo.png');
    } else {
      // Linux and others use PNG
      return path.join(iconDir, 'logo.png');
    }
  };

  // Detect system theme preference
  const isDarkMode = require('electron').nativeTheme.shouldUseDarkColors;

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'ShekelSync - Personal Finance Tracker',
    backgroundColor: isDarkMode ? '#0a0a0a' : '#f8fef9', // Adapts to system theme
    frame: false, // Frameless window for custom title bar
    transparent: false,
    roundedCorners: process.platform === 'darwin',
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false, // Security: disable node integration
      contextIsolation: true, // Security: enable context isolation
      enableRemoteModule: false, // Security: disable remote module
      preload: path.join(__dirname, 'preload.js'), // Load preload script
      webSecurity: true,
      // Performance optimizations
      experimentalFeatures: false,
      spellcheck: false,
      backgroundThrottling: false,
      allowRunningInsecureContent: false
    },
    icon: getIconPath(),
    show: false, // Don't show until ready
  });

  let windowShown = false;
  const ensureWindowVisible = () => {
    if (!mainWindow || windowShown || mainWindow.isDestroyed()) {
      return;
    }
    windowShown = true;
    console.log('Electron main window ready, displaying now...');
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    if (!mainWindow.isFocused()) {
      mainWindow.focus();
    }
    if (isDev && !mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.openDevTools();
    }
  };

  mainWindow.once('ready-to-show', () => {
    console.log('BrowserWindow emitted ready-to-show');
    ensureWindowVisible();
  });
  mainWindow.webContents.once('did-finish-load', () => {
    console.log('WebContents finished load');
    ensureWindowVisible();
  });
  setTimeout(() => {
    console.log('Fallback timer triggering ensureWindowVisible');
    ensureWindowVisible();
  }, 1500);

  // Send window state changes to renderer
  const emitWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:state-changed', { maximized: mainWindow.isMaximized() });
  };

  mainWindow.on('maximize', emitWindowState);
  mainWindow.on('unmaximize', emitWindowState);

  // Set up API server (optional)
  if (!skipEmbeddedApi && setupAPIServer) {
    try {
      const serverResult = await setupAPIServer(mainWindow);
      apiServer = serverResult.server;
      apiPort = serverResult.port;
      console.log(`API server started on port ${apiPort}`);
      logger.info('Embedded API server started', { port: apiPort });
    } catch (error) {
      console.error('Failed to start API server:', error);
      logger.error('Failed to start embedded API server', { error: error.message });
      console.log('Running without internal API server - using external Next.js dev server');
    }
  } else if (skipEmbeddedApi) {
    console.log('Embedded API server disabled via SKIP_EMBEDDED_API flag.');
  } else {
    console.log('Running without internal API server - relying on external dev renderer');
  }

  // Start renderer server in development
  // Load the app
  if (isDev) {
    console.log(`Loading renderer from ${devRendererUrl}`);
    await mainWindow.loadURL(devRendererUrl);
  } else {
    const viteDist = resolveRendererPath('dist', 'index.html');
    if (fs.existsSync(viteDist)) {
      console.log('Loading Vite renderer bundle');
      await mainWindow.loadFile(viteDist);
    } else {
      console.error('Vite renderer build not found. Expected at', viteDist);
      logger.error('Missing Vite renderer bundle', { path: viteDist });
      app.quit();
      return;
    }
  }

  ensureWindowVisible();
  emitWindowState();

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Prevent navigation to external websites
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    const allowedOrigins = new Set([
      'file://',
      'http://localhost:3000',
      'http://localhost:5173',
    ]);
    if (!allowedOrigins.has(parsedUrl.origin)) {
      event.preventDefault();
    }
  });
}

// App event handlers
app.whenReady().then(() => {
  createWindow();
  setupTray();

  // Auto-updater setup (production only)
  if (!isDev && autoUpdater) {
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('update-available', () => {
      console.log('Update available');
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: 'A new version is available. It will be downloaded in the background.',
        buttons: ['OK']
      });
    });

    autoUpdater.on('update-downloaded', () => {
      console.log('Update downloaded');
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: 'Update downloaded. The application will restart to apply the update.',
        buttons: ['Restart', 'Later']
      }).then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    });
  }
});

app.on('window-all-closed', async () => {
  // Close API server
  if (apiServer) {
    apiServer.close();
  }

  // Close database connection
  try {
    await dbManager.close();
  } catch (error) {
    console.error('Error closing database:', error);
  }

  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (appTray) {
    appTray.destroy();
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});


// IPC Handlers

ipcMain.on('log:report', (event, payload) => {
  try {
    recordRendererLog({
      ...payload,
      webContentsId: event.sender.id,
    });
  } catch (error) {
    logger.warn('Failed to record renderer log', { error: error.message });
  }
});

ipcMain.handle('diagnostics:getInfo', async () => {
  return getDiagnosticsInfo({ appVersion: app.getVersion() });
});

ipcMain.handle('diagnostics:openLogDirectory', async () => {
  return openDiagnosticsLogDirectory();
});

ipcMain.handle('diagnostics:export', async (_event, outputPath) => {
  if (!outputPath) {
    return { success: false, error: 'No destination selected' };
  }
  return exportDiagnosticsToFile(outputPath, { appVersion: app.getVersion() });
});

// Database operations
ipcMain.handle('db:query', async (event, sql, params = []) => {
  try {
    const result = await dbManager.query(sql, params);
    return { success: true, data: result.rows, rowCount: result.rowCount };
  } catch (error) {
    console.error('IPC Database query error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:test', async () => {
  try {
    const result = await dbManager.testConnection();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:stats', async () => {
  try {
    const stats = await dbManager.getStats();
    return { success: true, stats };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Core API operations
ipcMain.handle('api:ping', async () => {
  try {
    const startTime = Date.now();
    const health = await getHealthService().ping();
    const dbTest = await dbManager.testConnection();
    const responseTime = Date.now() - startTime;

    if (!health.ok) {
      return {
        success: false,
        error: health.error,
        data: {
          status: health.status,
          database: 'disconnected',
          environment: process.env.NODE_ENV || 'development',
          version: '0.1.0'
        }
      };
    }

    return {
      success: true,
      data: {
        status: 'ok',
        message: 'ShekelSync Electron API is running',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        database: dbTest.success ? 'connected' : 'disconnected',
        environment: process.env.NODE_ENV || 'development',
        version: '0.1.0'
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('api:credentials', async () => {
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
    return {
      success: true,
      data: {
        credentials: result.rows,
        count: result.rows.length
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('api:categories', async () => {
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
    const categories = result.rows.map(row => ({
      ...row,
      total_spent: parseFloat(row.total_spent) || 0,
      transaction_count: parseInt(row.transaction_count) || 0
    }));

    return {
      success: true,
      data: {
        categories: categories,
        count: categories.length
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Scraping handlers
ipcMain.handle('scrape:start', async (event, options, credentials) => {
  const vendor = options?.companyId;

  try {
    if (!vendor || !options?.startDate || !credentials) {
      throw new Error('Missing required fields: companyId, startDate, or credentials');
    }

    sendScrapeProgress({
      vendor,
      status: 'starting',
      progress: 5,
      message: 'Preparing scraper...',
    });

    const logger = createScrapeLogger(vendor);
    const result = await getScrapingService().runScrape({
      options,
      credentials,
      logger,
    });

    const transactionCount = Array.isArray(result.accounts)
      ? result.accounts.reduce(
          (sum, account) => sum + (Array.isArray(account.txns) ? account.txns.length : 0),
          0,
        )
      : 0;

    sendScrapeProgress({
      vendor,
      status: 'completed',
      progress: 100,
      message: `Scraping completed (${transactionCount} transactions)`,
      transactions: transactionCount,
    });

    return { success: true, data: { ...result, transactionCount } };
  } catch (error) {
    console.error('Scrape operation failed:', error);

    if (vendor) {
      sendScrapeProgress({
        vendor,
        status: 'failed',
        progress: 100,
        message: error?.message || 'Scraping failed',
        error: error?.message,
      });
    }

    return { success: false, error: error?.message || 'Scraping failed' };
  }
});

ipcMain.handle('scrape:events', async (event, limit = 100) => {
  try {
    const result = await dbManager.query(
      `SELECT id, triggered_by, vendor, start_date, status, message, created_at
       FROM scrape_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [Math.min(parseInt(limit), 500)]
    );

    return { success: true, data: result.rows };
  } catch (error) {
    console.error('Failed to fetch scrape events:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('scrape:test', async (event, companyId) => {
  try {
    const path = require('path');
    let CompanyTypes;
    try {
      const scraperModule = requireFromApp('israeli-bank-scrapers');
      CompanyTypes = scraperModule.CompanyTypes;
    } catch (error) {
      const scraperModule = require('israeli-bank-scrapers');
      CompanyTypes = scraperModule.CompanyTypes;
    }
    const companyType = CompanyTypes[companyId];

    if (!companyType) {
      return { success: false, error: `Invalid company ID: ${companyId}` };
    }

    return {
      success: true,
      data: {
        companyId,
        companyType,
        isSupported: true
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Window controls
ipcMain.handle('window:minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false;

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }

  return mainWindow.isMaximized();
});

ipcMain.handle('window:close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// API proxy handler
ipcMain.handle('api:request', async (event, { method, endpoint, data, headers = {} }) => {
  try {
    // Use internal API server if available, otherwise hit the embedded Next renderer (dev only)
    const baseUrl = apiPort ? `http://localhost:${apiPort}` : 'http://localhost:3000';
    const url = `${baseUrl}${endpoint}`;

    const fetchOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      fetchOptions.body = JSON.stringify(data);
    }

    const response = await fetch(url, fetchOptions);
    const responseData = await response.text();

    let parsedData;
    try {
      parsedData = JSON.parse(responseData);
    } catch {
      parsedData = responseData;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      data: parsedData,
      ok: response.ok
    };
  } catch (error) {
    console.error('API request failed:', error);
    return {
      status: 500,
      statusText: 'Internal Server Error',
      data: { error: error.message },
      ok: false
    };
  }
});

ipcMain.handle('auth:getSession', async () => {
  try {
    const session = await sessionStore.load();
    return { success: true, session: sanitizeSession(session) };
  } catch (error) {
    console.error('Failed to load auth session:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:setSession', async (event, session) => {
  try {
    if (session && typeof session !== 'object') {
      throw new Error('Session payload must be an object or null');
    }
    const saved = await sessionStore.save(session || null);
    emitSessionChanged(saved);
    return { success: true, session: sanitizeSession(saved) };
  } catch (error) {
    console.error('Failed to persist auth session:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:clearSession', async () => {
  try {
    await sessionStore.clear();
    emitSessionChanged(null);
    return { success: true };
  } catch (error) {
    console.error('Failed to clear auth session:', error);
    return { success: false, error: error.message };
  }
});

// File system operations
ipcMain.handle('file:showSaveDialog', async (event, options) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result;
  } catch (error) {
    console.error('Save dialog error:', error);
    return { canceled: true };
  }
});

ipcMain.handle('file:showOpenDialog', async (event, options) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  } catch (error) {
    console.error('Open dialog error:', error);
    return { canceled: true };
  }
});

ipcMain.handle('file:write', async (event, filePath, data, options = {}) => {
  try {
    if (!filePath) {
      throw new Error('No file path provided');
    }
    const encoding = options.encoding ?? 'utf8';
    await fs.promises.writeFile(filePath, data, encoding);
    return { success: true };
  } catch (error) {
    console.error('File write error:', error);
    return { success: false, error: error.message };
  }
});

// App info
ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

ipcMain.handle('app:getName', () => {
  return app.getName();
});

ipcMain.handle('app:isPackaged', () => {
  return app.isPackaged;
});

// Development helpers
if (isDev) {
  ipcMain.handle('dev:reload', () => {
    if (mainWindow) {
      mainWindow.reload();
    }
  });

  ipcMain.handle('dev:toggleDevTools', () => {
    if (mainWindow) {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  dialog.showErrorBox('Unexpected Error', `An unexpected error occurred: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  logger.error('Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  dialog.showErrorBox('Unexpected Error', `An unexpected error occurred: ${reason}`);
});

module.exports = { mainWindow };
