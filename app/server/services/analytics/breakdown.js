const { performance } = require('node:perf_hooks');
const actualDatabase = require('../database.js');
const { recordBreakdownMetric } = require('./metrics-store.js');
let database = actualDatabase;
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { resolveLocale, getLocalizedCategoryName } = require('../../../lib/server/locale-utils.js');
const { createTtlCache } = require('../../../lib/server/ttl-cache.js');

const breakdownCache = createTtlCache({ maxEntries: 30, defaultTtlMs: 60 * 1000 });

const VALID_TYPES = new Set(['expense', 'income', 'investment']);

const TYPE_CONFIG = {
  expense: {
    categoryType: 'expense',
    priceFilter: 't.price < 0',
    amountExpression: 'ABS(t.price)',
    amountFn: (price) => Math.abs(price),
  },
  income: {
    categoryType: 'income',
    priceFilter: 't.price > 0',
    amountExpression: 't.price',
    amountFn: (price) => price,
  },
  investment: {
    categoryType: 'investment',
    priceFilter: '',
    amountExpression: 'ABS(t.price)',
    amountFn: (price) => Math.abs(price),
  },
};

function validateType(type) {
  if (!VALID_TYPES.has(type)) {
    throw Object.assign(new Error(`Invalid type. Expected one of ${Array.from(VALID_TYPES).join(', ')}`), {
      status: 400,
    });
  }
}

async function getBreakdownAnalytics(query = {}) {
  const {
    type = 'expense',
    startDate,
    endDate,
    months = 3,
    locale: localeInput,
    includeTransactions,
  } = query;
  const locale = resolveLocale(localeInput);
  const timerStart = performance.now();

  validateType(type);

  const config = TYPE_CONFIG[type];
  const { start, end } = resolveDateRange({ startDate, endDate, months });
  const includeTransactionsFlag =
    includeTransactions === true ||
    includeTransactions === 'true' ||
    includeTransactions === '1';
  const skipCache =
    process.env.NODE_ENV === 'test' ||
    query.noCache === true ||
    query.noCache === 'true' ||
    query.noCache === '1';
  const cacheKey = JSON.stringify({
    type,
    start: start.toISOString(),
    end: end.toISOString(),
    months,
    locale,
    includeTransactions: includeTransactionsFlag,
  });
  if (!skipCache) {
    const cached = breakdownCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }
  const periodLengthMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(Math.max(start.getTime() - periodLengthMs, 0));
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];
  const prevStartStr = prevStart.toISOString().split('T')[0];
  const prevEndStr = prevEnd.toISOString().split('T')[0];

  const priceFilterClause = config.priceFilter ? `AND ${config.priceFilter}` : '';
  const amountExpression = config.amountExpression.replace(/t\./g, 'd.');

  const previousCategoryResult = await database.query(
    `WITH RECURSIVE category_tree AS (
        SELECT
          id as category_id,
          id as level1_id,
          name as level1_name,
          color as level1_color,
          icon as level1_icon,
          description as level1_description,
          parent_id,
          depth_level
        FROM category_definitions
        WHERE depth_level = 1 AND category_type = $3

        UNION ALL

        SELECT
          cd.id as category_id,
          ct.level1_id,
          ct.level1_name,
          ct.level1_color,
          ct.level1_icon,
          ct.level1_description,
          cd.parent_id,
          cd.depth_level
        FROM category_definitions cd
        JOIN category_tree ct ON cd.parent_id = ct.category_id
        WHERE cd.category_type = $3
      )
      SELECT
        ct.level1_id as parent_id,
        ct.level1_name as parent_name,
        COUNT(t.identifier) as transaction_count,
        SUM(${config.amountExpression}) as total_amount
      FROM transactions t
      JOIN category_definitions cd ON t.category_definition_id = cd.id
      JOIN category_tree ct ON cd.id = ct.category_id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND cd.category_type = $3
        AND cd.depth_level >= 1
        ${priceFilterClause}
        AND tpe.transaction_identifier IS NULL
      GROUP BY ct.level1_id, ct.level1_name`,
    [prevStartStr, prevEndStr, config.categoryType],
  );

  const previousVendorResult = await database.query(
    `SELECT
        COALESCE(t.vendor, 'Unknown') as vendor,
        COUNT(t.identifier) as transaction_count,
        SUM(${config.amountExpression}) as total_amount
      FROM transactions t
      JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND cd.category_type = $3
        ${priceFilterClause}
        AND tpe.transaction_identifier IS NULL
      GROUP BY COALESCE(t.vendor, 'Unknown')`,
    [prevStartStr, prevEndStr, config.categoryType],
  );

  const previousCategoryTotals = new Map();
  previousCategoryResult.rows.forEach((row) => {
    const parentId = row.parent_id !== null && row.parent_id !== undefined
      ? Number(row.parent_id)
      : null;
    const parentKey = parentId ?? row.parent_name ?? 'Uncategorized';
    previousCategoryTotals.set(parentKey, {
      count: Number(row.transaction_count || 0),
      total: Number.parseFloat(row.total_amount || 0),
    });
  });

  const previousVendorTotals = new Map();
  previousVendorResult.rows.forEach((row) => {
    const vendorKey = row.vendor || 'Unknown';
    previousVendorTotals.set(vendorKey, {
      count: Number(row.transaction_count || 0),
      total: Number.parseFloat(row.total_amount || 0),
    });
  });

  const categoryMap = new Map();
  const categoryHistoryMap = new Map();
  const vendorMap = new Map();
  const vendorHistoryMap = new Map();
  const monthMap = new Map();

  let transactions = [];
  let totalAmount = 0;
  let count = 0;
  let average = 0;
  let minAmount = 0;
  let maxAmount = 0;
  let transactionsRowCount = 0;

  if (includeTransactionsFlag) {
    const transactionsResult = await database.query(
      `WITH RECURSIVE category_tree AS (
          SELECT
            id as category_id,
            id as level1_id,
            name as level1_name,
            name_en as level1_name_en,
            name_fr as level1_name_fr,
            color as level1_color,
            icon as level1_icon,
            description as level1_description,
            parent_id,
            depth_level
          FROM category_definitions
          WHERE depth_level = 1 AND category_type = $3

          UNION ALL

          SELECT
            cd.id as category_id,
            ct.level1_id,
            ct.level1_name,
            ct.level1_name_en,
            ct.level1_name_fr,
            ct.level1_color,
            ct.level1_icon,
            ct.level1_description,
            cd.parent_id,
            cd.depth_level
          FROM category_definitions cd
          JOIN category_tree ct ON cd.parent_id = ct.category_id
          WHERE cd.category_type = $3
        )
        SELECT
          t.identifier,
          t.vendor,
          t.date,
          t.price,
          t.processed_date,
          t.name as transaction_name,
          t.account_number,
          cd.id as subcategory_id,
          cd.name as subcategory_name,
          cd.name_en as subcategory_name_en,
          cd.name_fr as subcategory_name_fr,
          cd.color as subcategory_color,
          cd.icon as subcategory_icon,
          cd.description as subcategory_description,
          cd.parent_id,
          cd.depth_level,
          ct.level1_id as parent_id,
          ct.level1_name as parent_name,
          ct.level1_name_en as parent_name_en,
          ct.level1_name_fr as parent_name_fr,
          ct.level1_color as parent_color,
          ct.level1_icon as parent_icon,
          ct.level1_description as parent_description,
          fi.id as institution_id,
          fi.display_name_he as institution_name_he,
          fi.display_name_en as institution_name_en,
          fi.logo_url as institution_logo,
          fi.institution_type as institution_type
        FROM transactions t
        JOIN category_definitions cd ON t.category_definition_id = cd.id
        JOIN category_tree ct ON cd.id = ct.category_id
        LEFT JOIN vendor_credentials vc ON t.vendor = vc.vendor
        LEFT JOIN institution_nodes fi ON vc.institution_id = fi.id AND fi.node_type = 'institution'
        LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
          ON t.identifier = tpe.transaction_identifier
          AND t.vendor = tpe.transaction_vendor
        WHERE t.date >= $1 AND t.date <= $2
          AND cd.category_type = $3
          AND cd.depth_level >= 1
          ${priceFilterClause}
          AND tpe.transaction_identifier IS NULL
        ORDER BY t.date ASC`,
      [startStr, endStr, config.categoryType],
    );

    transactionsRowCount = transactionsResult.rows.length;
    transactions = transactionsResult.rows.map((row) => {
      const parentName = getLocalizedCategoryName({
        name: row.parent_name,
        name_en: row.parent_name_en,
        name_fr: row.parent_name_fr,
      }, locale) || row.parent_name || 'Uncategorized';

      const subcategoryName = getLocalizedCategoryName({
        name: row.subcategory_name,
        name_en: row.subcategory_name_en,
        name_fr: row.subcategory_name_fr,
      }, locale) || row.subcategory_name || null;

      return {
        ...row,
        parent_name: parentName,
        subcategory_name: subcategoryName,
        price: Number.parseFloat(row.price),
        date: new Date(row.date),
      };
    });

    // Deduplicate transactions (recursive CTE can return duplicate rows for multi-level categories)
    const identifiers = transactions.map(tx => tx.identifier);
    const uniqueIdentifiers = new Set(identifiers);
    if (identifiers.length !== uniqueIdentifiers.size) {
      // Keep the first occurrence of each transaction ID
      const seen = new Set();
      transactions = transactions.filter(tx => {
        if (seen.has(tx.identifier)) {
          return false;
        }
        seen.add(tx.identifier);
        return true;
      });
    }

    // Use all transactions (including pending) for summary and breakdown calculations
    const amounts = transactions.map((tx) => config.amountFn(tx.price));
    totalAmount = amounts.reduce((sum, value) => sum + value, 0);
    count = transactions.length;
    average = count > 0 ? totalAmount / count : 0;
    minAmount = count > 0 ? Math.min(...amounts) : 0;
    maxAmount = count > 0 ? Math.max(...amounts) : 0;

    const now = new Date();

    // Use all transactions (including pending) for breakdown calculations
    transactions.forEach((tx) => {
      const amount = config.amountFn(tx.price);
      const processedDate = tx.processed_date || tx.processedDate;
      const isPending = processedDate ? new Date(processedDate) > now : false;

      const monthKey = tx.date.toISOString().slice(0, 7);

      const parentKey = tx.parent_id ?? tx.parent_name ?? 'Uncategorized';
      if (!categoryMap.has(parentKey)) {
        categoryMap.set(parentKey, {
          parentId: tx.parent_id,
          category: tx.parent_name || 'Uncategorized',
          color: tx.parent_color,
          icon: tx.parent_icon,
          description: tx.parent_description,
          count: 0,
          total: 0,
          pendingCount: 0,
          processedCount: 0,
          subcategories: new Map(),
        });
      }
      const parentEntry = categoryMap.get(parentKey);
      parentEntry.count += 1;
      parentEntry.total += amount;
      if (isPending) {
        parentEntry.pendingCount += 1;
      } else {
        parentEntry.processedCount += 1;
      }
      if (!categoryHistoryMap.has(parentKey)) {
        categoryHistoryMap.set(parentKey, new Map());
      }
      const catHistory = categoryHistoryMap.get(parentKey);
      catHistory.set(monthKey, (catHistory.get(monthKey) || 0) + amount);

      const isDirectlyAtLevel1 = tx.depth_level === 1 || tx.subcategory_id === tx.parent_id;
      const subKey = isDirectlyAtLevel1
        ? `${parentKey}::direct`
        : (tx.subcategory_id ?? `${parentKey}::${tx.subcategory_name || 'Other'}`);

      const subName = isDirectlyAtLevel1
        ? `${tx.parent_name || 'Uncategorized'} (Direct)`
        : (tx.subcategory_name || 'Other');

      const subColor = isDirectlyAtLevel1 ? tx.parent_color : tx.subcategory_color;
      const subIcon = isDirectlyAtLevel1 ? tx.parent_icon : tx.subcategory_icon;
      const subDescription = isDirectlyAtLevel1 ? tx.parent_description : tx.subcategory_description;

      if (!parentEntry.subcategories.has(subKey)) {
        parentEntry.subcategories.set(subKey, {
          id: isDirectlyAtLevel1 ? tx.parent_id : tx.subcategory_id,
          name: subName,
          color: subColor,
          icon: subIcon,
          description: subDescription,
          count: 0,
          total: 0,
          pendingCount: 0,
          processedCount: 0,
        });
      }
      const subEntry = parentEntry.subcategories.get(subKey);
      subEntry.count += 1;
      subEntry.total += amount;
      if (isPending) {
        subEntry.pendingCount += 1;
      } else {
        subEntry.processedCount += 1;
      }

      const vendorKey = tx.vendor || 'Unknown';
      if (!vendorMap.has(vendorKey)) {
        vendorMap.set(vendorKey, {
          vendor: vendorKey,
          count: 0,
          total: 0,
          institution: tx.institution_id ? {
            id: tx.institution_id,
            display_name_he: tx.institution_name_he,
            display_name_en: tx.institution_name_en,
            logo_url: tx.institution_logo,
            institution_type: tx.institution_type,
          } : null,
        });
      }
      const vendorEntry = vendorMap.get(vendorKey);
      vendorEntry.count += 1;
      vendorEntry.total += amount;
      if (!vendorHistoryMap.has(vendorKey)) {
        vendorHistoryMap.set(vendorKey, new Map());
      }
      const vendorHistory = vendorHistoryMap.get(vendorKey);
      vendorHistory.set(monthKey, (vendorHistory.get(monthKey) || 0) + amount);

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, { month: monthKey, total: 0 });
      }
      monthMap.get(monthKey).total += amount;
    });
  } else {
    const categoryBaseCte = `WITH RECURSIVE category_tree AS (
        SELECT
          id as category_id,
          id as level1_id,
          name as level1_name,
          name_en as level1_name_en,
          name_fr as level1_name_fr,
          color as level1_color,
          icon as level1_icon,
          description as level1_description,
          parent_id,
          depth_level
        FROM category_definitions
        WHERE depth_level = 1 AND category_type = $3

        UNION ALL

        SELECT
          cd.id as category_id,
          ct.level1_id,
          ct.level1_name,
          ct.level1_name_en,
          ct.level1_name_fr,
          ct.level1_color,
          ct.level1_icon,
          ct.level1_description,
          cd.parent_id,
          cd.depth_level
        FROM category_definitions cd
        JOIN category_tree ct ON cd.parent_id = ct.category_id
        WHERE cd.category_type = $3
      ),
      filtered AS (
        SELECT
          t.identifier,
          t.vendor,
          t.date,
          t.price,
          t.processed_date,
          cd.id as subcategory_id,
          cd.name as subcategory_name,
          cd.name_en as subcategory_name_en,
          cd.name_fr as subcategory_name_fr,
          cd.color as subcategory_color,
          cd.icon as subcategory_icon,
          cd.description as subcategory_description,
          cd.parent_id as subcategory_parent_id,
          cd.depth_level,
          ct.level1_id as parent_id,
          ct.level1_name as parent_name,
          ct.level1_name_en as parent_name_en,
          ct.level1_name_fr as parent_name_fr,
          ct.level1_color as parent_color,
          ct.level1_icon as parent_icon,
          ct.level1_description as parent_description
        FROM transactions t
        JOIN category_definitions cd ON t.category_definition_id = cd.id
        JOIN category_tree ct ON cd.id = ct.category_id
        LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
          ON t.identifier = tpe.transaction_identifier
          AND t.vendor = tpe.transaction_vendor
        WHERE t.date >= $1 AND t.date <= $2
          AND cd.category_type = $3
          AND cd.depth_level >= 1
          ${priceFilterClause}
          AND tpe.transaction_identifier IS NULL
      ),
      deduped AS (
        SELECT * FROM (
          SELECT filtered.*, ROW_NUMBER() OVER (PARTITION BY identifier ORDER BY date ASC) as rn
          FROM filtered
        ) WHERE rn = 1
      )`;

    const categoryTotalsResult = await database.query(
      `${categoryBaseCte}
      SELECT
        parent_id,
        parent_name,
        parent_name_en,
        parent_name_fr,
        parent_color,
        parent_icon,
        parent_description,
        subcategory_id,
        subcategory_name,
        subcategory_name_en,
        subcategory_name_fr,
        subcategory_color,
        subcategory_icon,
        subcategory_description,
        subcategory_parent_id,
        depth_level,
        COUNT(identifier) as transaction_count,
        SUM(${amountExpression}) as total_amount,
        SUM(CASE WHEN processed_date IS NOT NULL AND datetime(processed_date) > datetime('now', 'localtime') THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN processed_date IS NULL OR datetime(processed_date) <= datetime('now', 'localtime') THEN 1 ELSE 0 END) AS processed_count
      FROM deduped d
      GROUP BY parent_id,
        parent_name,
        parent_name_en,
        parent_name_fr,
        parent_color,
        parent_icon,
        parent_description,
        subcategory_id,
        subcategory_name,
        subcategory_name_en,
        subcategory_name_fr,
        subcategory_color,
        subcategory_icon,
        subcategory_description,
        subcategory_parent_id,
        depth_level`,
      [startStr, endStr, config.categoryType],
    );

    const categoryHistoryResult = await database.query(
      `${categoryBaseCte}
      SELECT
        parent_id,
        parent_name,
        strftime('%Y-%m', date) as month,
        SUM(${amountExpression}) as total_amount
      FROM deduped d
      GROUP BY parent_id, parent_name, month
      ORDER BY month`,
      [startStr, endStr, config.categoryType],
    );

    for (const row of categoryTotalsResult.rows) {
      const parentName = getLocalizedCategoryName({
        name: row.parent_name,
        name_en: row.parent_name_en,
        name_fr: row.parent_name_fr,
      }, locale) || row.parent_name || 'Uncategorized';

      const subcategoryName = getLocalizedCategoryName({
        name: row.subcategory_name,
        name_en: row.subcategory_name_en,
        name_fr: row.subcategory_name_fr,
      }, locale) || row.subcategory_name || null;

      const parentKey = row.parent_id ?? parentName ?? 'Uncategorized';
      if (!categoryMap.has(parentKey)) {
        categoryMap.set(parentKey, {
          parentId: row.parent_id,
          category: parentName,
          color: row.parent_color,
          icon: row.parent_icon,
          description: row.parent_description,
          count: 0,
          total: 0,
          pendingCount: 0,
          processedCount: 0,
          subcategories: new Map(),
        });
      }
      const parentEntry = categoryMap.get(parentKey);
      const rowCount = Number(row.transaction_count || 0);
      const rowTotal = Number.parseFloat(row.total_amount || 0);
      const rowPending = Number(row.pending_count || 0);
      const rowProcessed = Number(row.processed_count || 0);
      parentEntry.count += rowCount;
      parentEntry.total += rowTotal;
      parentEntry.pendingCount += rowPending;
      parentEntry.processedCount += rowProcessed;

      const isDirectlyAtLevel1 = row.depth_level === 1 || row.subcategory_id === row.parent_id;
      const subKey = isDirectlyAtLevel1
        ? `${parentKey}::direct`
        : (row.subcategory_id ?? `${parentKey}::${subcategoryName || 'Other'}`);

      const subName = isDirectlyAtLevel1
        ? `${parentName} (Direct)`
        : (subcategoryName || 'Other');

      const subColor = isDirectlyAtLevel1 ? row.parent_color : row.subcategory_color;
      const subIcon = isDirectlyAtLevel1 ? row.parent_icon : row.subcategory_icon;
      const subDescription = isDirectlyAtLevel1 ? row.parent_description : row.subcategory_description;

      if (!parentEntry.subcategories.has(subKey)) {
        parentEntry.subcategories.set(subKey, {
          id: isDirectlyAtLevel1 ? row.parent_id : row.subcategory_id,
          name: subName,
          color: subColor,
          icon: subIcon,
          description: subDescription,
          count: 0,
          total: 0,
          pendingCount: 0,
          processedCount: 0,
        });
      }
      const subEntry = parentEntry.subcategories.get(subKey);
      subEntry.count += rowCount;
      subEntry.total += rowTotal;
      subEntry.pendingCount += rowPending;
      subEntry.processedCount += rowProcessed;
    }

    for (const row of categoryHistoryResult.rows) {
      const parentKey = row.parent_id ?? row.parent_name ?? 'Uncategorized';
      if (!categoryHistoryMap.has(parentKey)) {
        categoryHistoryMap.set(parentKey, new Map());
      }
      const catHistory = categoryHistoryMap.get(parentKey);
      catHistory.set(row.month, Number.parseFloat(row.total_amount || 0));
    }

    const baseCte = `WITH filtered AS (
        SELECT
          t.identifier,
          t.vendor,
          t.date,
          t.price,
          t.processed_date
        FROM transactions t
        JOIN category_definitions cd ON t.category_definition_id = cd.id
        LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
          ON t.identifier = tpe.transaction_identifier
          AND t.vendor = tpe.transaction_vendor
        WHERE t.date >= $1 AND t.date <= $2
          AND cd.category_type = $3
          AND cd.depth_level >= 1
          ${priceFilterClause}
          AND tpe.transaction_identifier IS NULL
      ),
      deduped AS (
        SELECT * FROM (
          SELECT filtered.*, ROW_NUMBER() OVER (PARTITION BY identifier ORDER BY date ASC) as rn
          FROM filtered
        ) WHERE rn = 1
      )`;

    const vendorTotalsResult = await database.query(
      `${baseCte}
      SELECT
        COALESCE(d.vendor, 'Unknown') as vendor,
        COUNT(d.identifier) as transaction_count,
        SUM(${amountExpression}) as total_amount,
        MIN(fi.id) as institution_id,
        MIN(fi.display_name_he) as institution_name_he,
        MIN(fi.display_name_en) as institution_name_en,
        MIN(fi.logo_url) as institution_logo,
        MIN(fi.institution_type) as institution_type
      FROM deduped d
      LEFT JOIN vendor_credentials vc ON d.vendor = vc.vendor
      LEFT JOIN institution_nodes fi ON vc.institution_id = fi.id AND fi.node_type = 'institution'
      GROUP BY COALESCE(d.vendor, 'Unknown')`,
      [startStr, endStr, config.categoryType],
    );

    const vendorHistoryResult = await database.query(
      `${baseCte}
      SELECT
        COALESCE(d.vendor, 'Unknown') as vendor,
        strftime('%Y-%m', d.date) as month,
        SUM(${amountExpression}) as total_amount
      FROM deduped d
      GROUP BY vendor, month
      ORDER BY month`,
      [startStr, endStr, config.categoryType],
    );

    const monthTotalsResult = await database.query(
      `${baseCte}
      SELECT
        strftime('%Y-%m', d.date) as month,
        SUM(${amountExpression}) as total_amount
      FROM deduped d
      GROUP BY month
      ORDER BY month`,
      [startStr, endStr, config.categoryType],
    );

    const summaryResult = await database.query(
      `${baseCte}
      SELECT
        COUNT(d.identifier) as count,
        SUM(${amountExpression}) as total,
        MIN(${amountExpression}) as min,
        MAX(${amountExpression}) as max
      FROM deduped d`,
      [startStr, endStr, config.categoryType],
    );

    for (const row of vendorTotalsResult.rows) {
      const vendorKey = row.vendor || 'Unknown';
      vendorMap.set(vendorKey, {
        vendor: vendorKey,
        count: Number(row.transaction_count || 0),
        total: Number.parseFloat(row.total_amount || 0),
        institution: row.institution_id ? {
          id: row.institution_id,
          display_name_he: row.institution_name_he,
          display_name_en: row.institution_name_en,
          logo_url: row.institution_logo,
          institution_type: row.institution_type,
        } : null,
      });
    }

    for (const row of vendorHistoryResult.rows) {
      const vendorKey = row.vendor || 'Unknown';
      if (!vendorHistoryMap.has(vendorKey)) {
        vendorHistoryMap.set(vendorKey, new Map());
      }
      const history = vendorHistoryMap.get(vendorKey);
      history.set(row.month, Number.parseFloat(row.total_amount || 0));
    }

    for (const row of monthTotalsResult.rows) {
      monthMap.set(row.month, { month: row.month, total: Number.parseFloat(row.total_amount || 0) });
    }

    const summaryRow = summaryResult.rows[0] || {};
    totalAmount = Number.parseFloat(summaryRow.total || 0);
    count = Number(summaryRow.count || 0);
    minAmount = Number.parseFloat(summaryRow.min || 0);
    maxAmount = Number.parseFloat(summaryRow.max || 0);
    average = count > 0 ? totalAmount / count : 0;
    transactionsRowCount = count;
  }

  const byCategory = Array.from(categoryMap.values()).map((entry) => {
    const parentKey = entry.parentId ?? entry.category ?? 'Uncategorized';
    const history = categoryHistoryMap.get(parentKey)
      ? Array.from(categoryHistoryMap.get(parentKey).entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([month, total]) => ({ month, total }))
      : [];
    const previousTotals = previousCategoryTotals.get(parentKey);

    return {
      parentId: entry.parentId,
      category: entry.category,
      color: entry.color,
      icon: entry.icon,
      description: entry.description,
      count: entry.count,
      total: entry.total,
      pendingCount: entry.pendingCount || 0,
      processedCount: entry.processedCount || 0,
      previousTotal: previousTotals ? previousTotals.total : 0,
      previousCount: previousTotals ? previousTotals.count : 0,
      history,
      subcategories: Array.from(entry.subcategories.values())
        .sort((a, b) => b.total - a.total)
        .map((sub) => ({
          id: sub.id,
          name: sub.name,
          color: sub.color,
          icon: sub.icon,
          description: sub.description,
          count: sub.count,
          total: sub.total,
          pendingCount: sub.pendingCount || 0,
          processedCount: sub.processedCount || 0,
        })),
    };
  }).sort((a, b) => b.total - a.total);

  const byVendor = Array.from(vendorMap.values())
    .sort((a, b) => b.total - a.total)
    .map((row) => {
      const history = vendorHistoryMap.get(row.vendor)
        ? Array.from(vendorHistoryMap.get(row.vendor).entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([month, total]) => ({ month, total }))
        : [];
      const previousTotals = previousVendorTotals.get(row.vendor) ??
        previousVendorTotals.get('Unknown');

      return {
        vendor: row.vendor,
        count: row.count,
        total: row.total,
        previousTotal: previousTotals ? previousTotals.total : 0,
        previousCount: previousTotals ? previousTotals.count : 0,
        history,
        institution: row.institution,
      };
    });

  const byMonth = Array.from(monthMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({
      ...row,
      inflow: type === 'expense' ? 0 : row.total,
      outflow: type === 'expense' ? row.total : 0,
    }));

  const response = {
    dateRange: { start, end },
    summary: {
      total: totalAmount,
      count,
      average,
      min: minAmount,
      max: maxAmount,
    },
    breakdowns: {
      byCategory,
      byVendor,
      byMonth,
    },
  };
  if (includeTransactionsFlag) {
    response.transactions = transactions.map((tx) => ({
      ...tx,
      price: tx.price,
    }));
  }

  const durationMs = Number((performance.now() - timerStart).toFixed(2));
  const metricPayload = {
    durationMs,
    type,
    dateRange: { start: startStr, end: endStr, previousStart: prevStartStr, previousEnd: prevEndStr },
    rowCounts: {
      current: transactionsRowCount,
      previousCategories: previousCategoryResult.rows.length,
      previousVendors: previousVendorResult.rows.length,
    },
  };

  console.info('[analytics:breakdown]', JSON.stringify(metricPayload));
  recordBreakdownMetric(metricPayload);

  if (!skipCache) {
    breakdownCache.set(cacheKey, response);
  }
  return response;
}

module.exports = {
  getBreakdownAnalytics,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};
module.exports.default = module.exports;
