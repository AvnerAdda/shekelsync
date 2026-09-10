#!/usr/bin/env node
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { configureUserDataScope } = require('../electron/user-data-scope');
const secureKeyManager = require('../electron/secure-key-manager');
const { configManager } = require('../electron/config');
const { dbManager } = require('../electron/database');

configureUserDataScope(app);

app.whenReady().then(async () => {
  process.env.SHEKELSYNC_ENCRYPTION_KEY = await secureKeyManager.getKey();
  const config = await configManager.initializeConfig();
  process.env.USE_SQLITE = 'true';
  process.env.SQLITE_DB_PATH = path.join(app.getPath('userData'), 'shekelsync.sqlite');
  dbManager.mode = 'sqlite';

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const loadPromise = win.loadURL('http://localhost:5173');
  const dbPromise = dbManager.initialize(config.database);

  const [loadResult, dbResult] = await Promise.allSettled([loadPromise, dbPromise]);
  console.log('load:', loadResult.status, loadResult.reason?.message || 'ok');
  console.log('db:', dbResult.status, dbResult.value || dbResult.reason);

  await dbManager.close();
  win.destroy();
  app.quit();
}).catch((error) => {
  console.error('failed:', error);
  process.exit(1);
});
