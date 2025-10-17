const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Handle module resolution for development vs production
let autoUpdater;
try {
  if (isDev) {
    autoUpdater = require(path.join(__dirname, '..', 'app', 'node_modules', 'electron-updater')).autoUpdater;
  } else {
    autoUpdater = require('electron-updater').autoUpdater;
  }
} catch (error) {
  console.log('electron-updater not available:', error.message);
  autoUpdater = null;
}

// Import configuration and database managers
const { configManager } = require('./config');
const { dbManager } = require('./database');

// Import API server setup
let setupAPIServer;
try {
  const serverModule = require('./server');
  setupAPIServer = serverModule.setupAPIServer;
} catch (error) {
  console.log('API server module not available, running in basic mode:', error.message);
  setupAPIServer = null;
}

// Keep a global reference of the window object
let mainWindow;
let apiServer;
let apiPort;

// Development mode logging
if (isDev) {
  console.log('Running in development mode');
}

async function createWindow() {
  // Initialize configuration and database
  try {
    console.log('Initializing application configuration...');
    const config = await configManager.initializeConfig();

    console.log('Initializing database connection...');
    const dbResult = await dbManager.initialize(config.database);

    if (!dbResult.success) {
      console.error('Database initialization failed:', dbResult.message);
      // Show error dialog but continue with app (may work in proxy mode)
      dialog.showErrorBox(
        'Database Connection Error',
        `Failed to connect to database: ${dbResult.message}\n\nThe app will run in limited mode.`
      );
    }
  } catch (error) {
    console.error('Initialization error:', error);
    dialog.showErrorBox(
      'Initialization Error',
      `Failed to initialize application: ${error.message}`
    );
  }

  // Set up Content Security Policy
  session.defaultSession.webSecurity = !isDev; // Disable in dev for hot reload

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false, // Security: disable node integration
      contextIsolation: true, // Security: enable context isolation
      enableRemoteModule: false, // Security: disable remote module
      preload: path.join(__dirname, 'preload.js'), // Load preload script
      webSecurity: !isDev, // Disable web security in development
      // Performance optimizations
      experimentalFeatures: false,
      spellcheck: false,
      backgroundThrottling: false,
      allowRunningInsecureContent: false
    },
    icon: isDev
      ? path.join(__dirname, '..', 'app', 'public', 'favicon.ico')
      : path.join(process.resourcesPath, 'app', 'public', 'favicon.ico'),
    show: false, // Don't show until ready
    titleBarStyle: 'default'
  });

  // Set up API server (optional)
  if (setupAPIServer) {
    try {
      const serverResult = await setupAPIServer(mainWindow);
      apiServer = serverResult.server;
      apiPort = serverResult.port;
      console.log(`API server started on port ${apiPort}`);
    } catch (error) {
      console.error('Failed to start API server:', error);
      console.log('Running without internal API server - using external Next.js dev server');
    }
  } else {
    console.log('Running without internal API server - using external Next.js dev server');
  }

  // Load the app
  if (isDev) {
    await mainWindow.loadURL('http://localhost:3000');
  } else {
    // In production, check for static export vs server build
    const outPath = path.join(__dirname, '..', 'app', 'out', 'index.html');
    const buildPath = path.join(__dirname, '..', 'app', 'build', 'index.html');

    if (require('fs').existsSync(outPath)) {
      console.log('Loading from Next.js static export');
      await mainWindow.loadFile(outPath);
    } else if (require('fs').existsSync(buildPath)) {
      console.log('Loading from Next.js build directory');
      await mainWindow.loadFile(buildPath);
    } else {
      console.error('No built app found! Please run npm run build first.');
      app.quit();
      return;
    }
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Focus on window
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

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

    if (parsedUrl.origin !== 'http://localhost:3000' && parsedUrl.origin !== 'file://') {
      event.preventDefault();
    }
  });
}

// App event handlers
app.whenReady().then(() => {
  createWindow();

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

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});

// IPC Handlers

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
    const dbTest = await dbManager.testConnection();
    const responseTime = Date.now() - startTime;

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
let electronScraper = null;

ipcMain.handle('scrape:start', async (event, options, credentials) => {
  try {
    if (!electronScraper) {
      const { ElectronScraper } = require('./scraper');
      electronScraper = new ElectronScraper(mainWindow);
    }

    const result = await electronScraper.scrape(options, credentials);
    return { success: true, data: result };
  } catch (error) {
    console.error('Scrape operation failed:', error);
    return { success: false, error: error.message };
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
      const scraperModule = require(path.join(__dirname, '..', 'app', 'node_modules', 'israeli-bank-scrapers'));
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
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

// API proxy handler
ipcMain.handle('api:request', async (event, { method, endpoint, data, headers = {} }) => {
  try {
    // Use internal API server if available, otherwise proxy to Next.js dev server
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
  dialog.showErrorBox('Unexpected Error', `An unexpected error occurred: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  dialog.showErrorBox('Unexpected Error', `An unexpected error occurred: ${reason}`);
});

module.exports = { mainWindow };