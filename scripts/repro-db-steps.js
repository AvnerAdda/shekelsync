#!/usr/bin/env node
require('../electron/setup-module-alias');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { configureUserDataScope } = require('../electron/user-data-scope');

configureUserDataScope(app);

app.whenReady().then(async () => {
  console.log('ready');

  const secureKeyManager = require('../electron/secure-key-manager');
  console.log('loaded secure key manager');
  process.env.SHEKELSYNC_ENCRYPTION_KEY = await secureKeyManager.getKey();
  console.log('got key');

  const { configManager } = require('../electron/config');
  console.log('loaded config manager');
  const config = await configManager.initializeConfig();
  console.log('initialized config');

  process.env.USE_SQLITE = 'true';
  const dbPath = path.join(app.getPath('userData'), 'shekelsync.sqlite');
  process.env.SQLITE_DB_PATH = dbPath;
  console.log('db path', dbPath);

  const win = new BrowserWindow({ width: 800, height: 600, show: false });
  console.log('created window');
  void win.loadURL('http://localhost:5173');
  console.log('started loadURL');

  const databaseModule = require('../electron/database');
  console.log('loaded database module');

  const initModule = require(path.join(__dirname, 'init_sqlite_db.js'));
  console.log('loaded init module');

  const { requireFromApp } = require('../electron/paths');
  const betterSqlite = requireFromApp('better-sqlite3');
  const SqliteDatabase = typeof betterSqlite.default === 'function' ? betterSqlite.default : betterSqlite;
  console.log('loaded better-sqlite3');

  console.log('opening probe db');
  const probe = new SqliteDatabase(dbPath, { fileMustExist: true, readonly: true });
  probe.prepare('SELECT 1').get();
  probe.close();
  console.log('probe done');

  win.destroy();
  app.quit();
}).catch((error) => {
  console.error('failed:', error);
  process.exit(1);
});
