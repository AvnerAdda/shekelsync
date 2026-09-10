#!/usr/bin/env node
const path = require('path');
const { app } = require('electron');
const { configureUserDataScope } = require('../electron/user-data-scope');
const { requireFromApp } = require('../electron/paths');

configureUserDataScope(app);

app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath('userData'), 'shekelsync.sqlite');
  process.env.USE_SQLITE = 'true';
  process.env.SQLITE_DB_PATH = dbPath;

  const Database = requireFromApp('better-sqlite3');
  const SqliteDatabase = typeof Database.default === 'function' ? Database.default : Database;

  // Simulate credential-key-validator probe
  for (let i = 0; i < 20; i++) {
    const probe = new SqliteDatabase(dbPath, { readonly: true, fileMustExist: true });
    probe.prepare('SELECT 1').get();
    probe.close();
  }

  const { dbManager } = require('../electron/database');
  const result = await dbManager.initialize();
  console.log('result:', result);
  await dbManager.close();
  app.quit();
}).catch((error) => {
  console.error('failed:', error);
  process.exit(1);
});
