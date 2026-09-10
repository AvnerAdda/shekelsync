#!/usr/bin/env node
const { app } = require('electron');

app.whenReady().then(async () => {
  process.env.USE_SQLITE = 'true';
  process.env.SQLITE_DB_PATH =
    process.env.SQLITE_DB_PATH ||
    '/Users/aadda/Library/Application Support/ShekelSync Development/shekelsync.sqlite';

  const { dbManager } = require('../electron/database');
  console.log('calling initialize...');
  const result = await dbManager.initialize();
  console.log('result:', result);
  await dbManager.close();
  console.log('closed ok');
  app.quit();
}).catch((error) => {
  console.error('failed:', error);
  process.exit(1);
});
