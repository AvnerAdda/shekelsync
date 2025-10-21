import { subMonths } from 'date-fns';
import { dialect } from '../../../lib/sql-dialect.js';

/**
 * Builds a duplicate exclusion filter that can be appended to a WHERE clause.
 * The returned string includes the leading "AND" when conditions exist; otherwise an empty string.
 */
export async function buildDuplicateFilter(client, alias = 'transactions') {
  let duplicateFilter = '';

  try {
    let hasDuplicatesTable = false;
    let hasManualExclusions = false;

    if (dialect.useSqlite) {
      const duplicatesCheck = await client.query(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transaction_duplicates'`
      );
      const manualCheck = await client.query(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'manual_exclusions'`
      );
      hasDuplicatesTable = duplicatesCheck.rows.length > 0;
      hasManualExclusions = manualCheck.rows.length > 0;
    } else {
      const [duplicatesTableCheck, manualExclusionsTableCheck] = await Promise.all([
        client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = 'transaction_duplicates'
          );
        `),
        client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = 'manual_exclusions'
          );
        `),
      ]);

      hasDuplicatesTable = duplicatesTableCheck.rows[0].exists;
      hasManualExclusions = manualExclusionsTableCheck.rows[0].exists;
    }

    const conditions = [];
    const booleanTrue = dialect.useSqlite ? '1' : 'TRUE';

    if (hasDuplicatesTable) {
      conditions.push(`
        NOT EXISTS (
          SELECT 1 FROM transaction_duplicates td
          WHERE td.exclude_from_totals = ${booleanTrue}
          AND (
            (td.transaction1_identifier = ${alias}.identifier AND td.transaction1_vendor = ${alias}.vendor) OR
            (td.transaction2_identifier = ${alias}.identifier AND td.transaction2_vendor = ${alias}.vendor)
          )
        )
      `);
    }

    if (hasManualExclusions) {
      conditions.push(`
        NOT EXISTS (
          SELECT 1 FROM manual_exclusions me
          WHERE me.transaction_identifier = ${alias}.identifier
          AND me.transaction_vendor = ${alias}.vendor
        )
      `);
    }

    if (conditions.length > 0) {
      duplicateFilter = `AND (${conditions.join(' AND ')})`;
    }
  } catch (error) {
    console.log('Duplicate filtering not available:', error.message);
  }

  return duplicateFilter;
}

/**
 * Normalises start/end date range based on query params.
 * Falls back to last `months` months when explicit dates are not provided.
 */
export function resolveDateRange({ startDate, endDate, months = 3 }) {
  let start;
  let end;

  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
  } else {
    end = new Date();
    start = subMonths(end, parseInt(months, 10));
  }

  return { start, end };
}
