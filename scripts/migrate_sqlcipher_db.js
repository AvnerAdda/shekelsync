#!/usr/bin/env node
/**
 * Migrate a plaintext SQLite database to SQLCipher.
 *
 * Usage:
 *   node scripts/migrate_sqlcipher_db.js --input path/to/clarify.sqlite --output path/to/clarify.sqlcipher
 */

const path = require('path');
const { migrateSqliteToSqlcipher } = require('../app/lib/sqlcipher-migrate.js');
const { resolveSqlCipherKey, isHexKey } = require('../app/lib/sqlcipher-utils.js');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { input: null, output: null, force: false, key: null };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--input':
      case '-i':
        options.input = args[i + 1];
        i += 1;
        break;
      case '--output':
      case '-o':
        options.output = args[i + 1];
        i += 1;
        break;
      case '--force':
      case '-f':
        options.force = true;
        break;
      case '--key':
        options.key = args[i + 1];
        i += 1;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/migrate_sqlcipher_db.js [options]

Options:
  -i, --input <path>    Source SQLite database file
  -o, --output <path>   Target SQLCipher database file
  -f, --force           Overwrite target if it exists
      --key <value>     SQLCipher key (hex or passphrase)
  -h, --help            Show this help message
`);
}

function resolveDefaults({ input, output }) {
  const defaultInput =
    input ||
    process.env.SQLITE_DB_PATH ||
    path.join(process.cwd(), 'dist', 'clarify.sqlite');

  let defaultOutput = output || process.env.SQLCIPHER_DB_PATH || null;
  if (!defaultOutput) {
    if (defaultInput.toLowerCase().endsWith('.sqlite')) {
      defaultOutput = defaultInput.replace(/\.sqlite$/i, '.sqlcipher');
    } else {
      defaultOutput = `${defaultInput}.sqlcipher`;
    }
  }

  return { input: defaultInput, output: defaultOutput };
}

function resolveKey(keyArg) {
  if (keyArg) {
    return { value: keyArg, isHex: isHexKey(keyArg) };
  }
  return resolveSqlCipherKey({ requireKey: true });
}

function main() {
  const options = parseArgs();
  const { input, output } = resolveDefaults(options);
  const keyInfo = resolveKey(options.key);

  console.log('Migrating SQLite database to SQLCipher...');
  console.log(`Source: ${input}`);
  console.log(`Target: ${output}`);

  try {
    migrateSqliteToSqlcipher({
      sourcePath: input,
      targetPath: output,
      keyInfo,
      force: options.force,
    });
    console.log('✅ Migration complete.');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
