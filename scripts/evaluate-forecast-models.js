#!/usr/bin/env node
/** Read-only realized accuracy for the supported forecast version. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
if (!process.env.SQLITE_DB_PATH) {
  const candidates = ['dist/shekelsync.sqlite', 'app/dist/shekelsync.sqlite'];
  const found = candidates.map(p => path.join(root, p)).find(p => fs.existsSync(p));
  if (found) process.env.SQLITE_DB_PATH = found;
}
const forecast = require('../app/server/services/forecast.js');
function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log('Usage: npm run evaluate:forecast -- [--days 90]\nSet SQLITE_DB_PATH to the database to evaluate. Outputs JSON.');
    return;
  }
  const index = argv.indexOf('--days');
  const days = index < 0 ? 90 : Number(argv[index + 1]);
  if (!Number.isInteger(days) || days < 7 || days > 365) throw new Error('--days must be an integer between 7 and 365');
  console.log(JSON.stringify(forecast.getForecastAccuracy({ days }), null, 2));
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { main };
