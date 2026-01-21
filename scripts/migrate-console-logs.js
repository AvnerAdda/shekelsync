#!/usr/bin/env node

/**
 * Script to help migrate console.log statements to proper logging
 * Usage: node scripts/migrate-console-logs.js <file-path>
 */

const fs = require('fs');
const path = require('path');

function migrateConsoleLogsInFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const isTypeScript = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
  const isRenderer = filePath.includes('/renderer/');

  // Determine the correct import statement
  let loggerImport;
  if (isRenderer) {
    loggerImport = isTypeScript
      ? "import { logger } from '@renderer/utils/logger';"
      : "import { logger } from '@renderer/utils/logger';";
  } else {
    loggerImport = "const logger = require('../lib/logger');";
  }

  // Check if logger is already imported
  const hasLoggerImport = content.includes('logger');

  // Replace console.log with logger.info
  // Replace console.error with logger.error
  // Replace console.warn with logger.warn
  // Replace console.debug with logger.debug

  let newContent = content
    .replace(/console\.log\(/g, 'logger.info(')
    .replace(/console\.error\(/g, 'logger.error(')
    .replace(/console\.warn\(/g, 'logger.warn(')
    .replace(/console\.debug\(/g, 'logger.debug(');

  // Add import if needed and not already present
  if (!hasLoggerImport && newContent !== content) {
    if (isRenderer && isTypeScript) {
      // Add import after other imports
      const lines = newContent.split('\n');
      let importInserted = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('import ') && !importInserted) {
          // Find the last import
          let lastImportIndex = i;
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].startsWith('import ')) {
              lastImportIndex = j;
            } else if (lines[j].trim() !== '') {
              break;
            }
          }
          lines.splice(lastImportIndex + 1, 0, loggerImport);
          importInserted = true;
          break;
        }
      }
      if (importInserted) {
        newContent = lines.join('\n');
      }
    } else if (!isRenderer) {
      // Add require at the top for backend files
      newContent = loggerImport + '\n\n' + newContent;
    }
  }

  fs.writeFileSync(filePath, newContent, 'utf-8');
  console.log(`✅ Migrated: ${filePath}`);
}

// Get file path from command line argument
const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node scripts/migrate-console-logs.js <file-path>');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

try {
  migrateConsoleLogsInFile(filePath);
} catch (error) {
  console.error(`Error migrating file: ${error.message}`);
  process.exit(1);
}
