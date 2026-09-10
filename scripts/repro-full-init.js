#!/usr/bin/env node
const { app } = require('electron');

app.whenReady().then(async () => {
  const secureKeyManager = require('../electron/secure-key-manager');
  const { configManager } = require('../electron/config');
  const { dbManager } = require('../electron/database');

  console.log('loading encryption key...');
  const key = await secureKeyManager.getKey();
  process.env.SHEKELSYNC_ENCRYPTION_KEY = key;
  console.log('encryption key loaded');

  console.log('loading config...');
  const config = await configManager.initializeConfig();
  console.log('config loaded', { mode: config?.database?.mode });

  process.env.USE_SQLITE = 'true';
  const defaultSqlitePath = require('path').join(
    app.getPath('userData'),
    'shekelsync.sqlite',
  );
  process.env.SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || config.database?.path || defaultSqlitePath;
  dbManager.mode = 'sqlite';

  console.log('initializing database...');
  const result = await dbManager.initialize(config.database);
  console.log('db result:', result);

  await dbManager.close();
  console.log('done');
  app.quit();
}).catch((error) => {
  console.error('failed:', error);
  process.exit(1);
});
