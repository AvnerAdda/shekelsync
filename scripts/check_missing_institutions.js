#!/usr/bin/env node
/**
 * Diagnostic script that surfaces recurring patterns or action items
 * that still lack institution metadata. Run with:
 *   node scripts/check_missing_institutions.js
 */
const path = require('path');

// Ensure module resolution matches the app server
process.env.ALLOW_DEV_NO_ENCRYPTION = process.env.ALLOW_DEV_NO_ENCRYPTION || 'true';

const recurringAnalysisService = require(path.join(
  __dirname,
  '../app/server/services/analytics/recurring-analysis.js',
));
const actionItemsService = require(path.join(
  __dirname,
  '../app/server/services/analytics/action-items.js',
));
const database = require(path.join(__dirname, '../app/server/services/database.js'));

async function main() {
  const recurring = await recurringAnalysisService.getRecurringAnalysis({
    months: 6,
    minOccurrences: 2,
    minConfidence: 0.3,
  });
  const recurringMissing = recurring.recurring_patterns.filter((pattern) => !pattern.institution);

  const actionItems = await actionItemsService.getActionItems({ includeProgress: 'false' });
  const actionMissing = actionItems.items.filter(
    (item) => !item.metadata?.institution && (item.metadata?.vendor || item.metadata?.institution_id),
  );

  const report = {
    generated_at: new Date().toISOString(),
    recurring: {
      total: recurring.recurring_patterns.length,
      missing: recurringMissing.length,
      samples: recurringMissing.slice(0, 10).map((pattern) => ({
        merchant_pattern: pattern.merchant_pattern,
        merchant_display_name: pattern.merchant_display_name,
        vendor: pattern.vendor || null,
        frequency: pattern.frequency,
      })),
    },
    action_items: {
      total: actionItems.items.length,
      missing: actionMissing.length,
      samples: actionMissing.slice(0, 10).map((item) => ({
        id: item.id,
        title: item.title,
        vendor: item.metadata?.vendor || null,
      })),
    },
  };

  console.log('=== Institution Coverage Report ===');
  console.log(report);

  // Write the report so the admin UI can pick it up
  const fs = require('fs');
  const path = require('path');
  const outputPath = path.join(__dirname, '../app/dist/institution-coverage.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`Report written to ${outputPath}`);
}

main()
  .catch((error) => {
    console.error('[check_missing_institutions] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await database.close?.();
    } catch (err) {
      console.warn('Failed to close database pool', err);
    }
  });
