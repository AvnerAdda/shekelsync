import { getDB } from '../db.js';
import { resolveDateRange, standardizeResponse, standardizeError } from '@/lib/server/query-utils.js';

/**
 * Data Export API
 * Supports multiple formats: CSV, JSON
 * Filters: date range, categories, vendors, transaction types
 */

const VALID_FORMATS = new Set(['csv', 'json']);
const VALID_DATA_TYPES = new Set(['transactions', 'categories', 'vendors', 'budgets', 'full']);

// Helper function to escape CSV fields
function escapeCSV(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Helper function to format transactions as CSV
function formatTransactionsCSV(transactions) {
  const headers = [
    'Date',
    'Vendor',
    'Description',
    'Amount',
    'Category',
    'Parent Category',
    'Type',
    'Status',
    'Account Number'
  ];

  const csvRows = [headers.join(',')];

  transactions.forEach(txn => {
    const row = [
      escapeCSV(txn.date),
      escapeCSV(txn.vendor),
      escapeCSV(txn.name),
      escapeCSV(txn.price),
      escapeCSV(txn.category),
      escapeCSV(txn.parent_category),
      escapeCSV(txn.type),
      escapeCSV(txn.status),
      escapeCSV(txn.account_number)
    ];
    csvRows.push(row.join(','));
  });

  return csvRows.join('\n');
}

// Helper function to format categories as CSV
function formatCategoriesCSV(categories) {
  const headers = ['Category', 'Parent Category', 'Transaction Count', 'Total Amount'];
  const csvRows = [headers.join(',')];

  categories.forEach(cat => {
    const row = [
      escapeCSV(cat.category),
      escapeCSV(cat.parent_category),
      escapeCSV(cat.transaction_count),
      escapeCSV(cat.total_amount)
    ];
    csvRows.push(row.join(','));
  });

  return csvRows.join('\n');
}

// Helper function to format vendors as CSV
function formatVendorsCSV(vendors) {
  const headers = ['Vendor', 'Transaction Count', 'Total Amount', 'First Transaction', 'Last Transaction'];
  const csvRows = [headers.join(',')];

  vendors.forEach(vendor => {
    const row = [
      escapeCSV(vendor.vendor),
      escapeCSV(vendor.transaction_count),
      escapeCSV(vendor.total_amount),
      escapeCSV(vendor.first_transaction),
      escapeCSV(vendor.last_transaction)
    ];
    csvRows.push(row.join(','));
  });

  return csvRows.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json(standardizeError('Method not allowed', 'METHOD_NOT_ALLOWED'));
  }

  const client = await getDB();

  try {
    const {
      format = 'csv',
      dataType = 'transactions',
      startDate,
      endDate,
      months = 12,
      categories,
      vendors,
      includeIncome = 'true',
      includeExpenses = 'true',
      includeInvestments = 'true'
    } = req.query;

    // Validation
    if (!VALID_FORMATS.has(format)) {
      return res.status(400).json(
        standardizeError(`Invalid format. Expected one of ${Array.from(VALID_FORMATS).join(', ')}`, 'INVALID_FORMAT')
      );
    }

    if (!VALID_DATA_TYPES.has(dataType)) {
      return res.status(400).json(
        standardizeError(`Invalid data type. Expected one of ${Array.from(VALID_DATA_TYPES).join(', ')}`, 'INVALID_DATA_TYPE')
      );
    }

    const { start, end } = resolveDateRange({ startDate, endDate, months });

    const categoryValues = categories
      ? (Array.isArray(categories) ? categories : categories.split(','))
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    const vendorList = vendors
      ? (Array.isArray(vendors) ? vendors : vendors.split(','))
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    let exportData = {};
    const timestamp = new Date().toISOString().split('T')[0];

    // Build type filters
    const typeFilters = [];
    if (includeIncome === 'true') typeFilters.push('t.price > 0');
    if (includeExpenses === 'true') typeFilters.push('t.price < 0');

    const typeFilterClause = typeFilters.length > 0 ? `AND (${typeFilters.join(' OR ')})` : '';

    const queryParams = [start, end];
    let categoryFilterClause = '';
    let vendorFilterClause = '';

    if (categoryValues.length > 0) {
      const { rows: categoryRows } = await client.query(
        `
          WITH provided AS (
            SELECT LOWER(TRIM(identifier)) AS identifier
            FROM UNNEST($1::text[]) AS provided(identifier)
          ),
          matched AS (
            SELECT cd.id, cd.name, cd.name_en
            FROM category_definitions cd
            JOIN provided p ON
              cd.id::text = p.identifier
              OR LOWER(cd.name) = p.identifier
              OR LOWER(cd.name_en) = p.identifier
          ),
          category_tree AS (
            SELECT id, name, name_en
            FROM matched
            UNION ALL
            SELECT child.id, child.name, child.name_en
            FROM category_definitions child
            JOIN category_tree ct ON child.parent_id = ct.id
          )
          SELECT DISTINCT id, name, name_en
          FROM category_tree
        `,
        [categoryValues]
      );

      const categoryIdSet = new Set();
      const categoryNameSet = new Set(categoryValues);

      for (const row of categoryRows) {
        const id = typeof row.id === 'number' ? row.id : Number(row.id);
        if (Number.isFinite(id)) {
          categoryIdSet.add(id);
        }
        if (row.name) {
          categoryNameSet.add(row.name);
        }
        if (row.name_en) {
          categoryNameSet.add(row.name_en);
        }
      }

      const selectedCategoryIds = Array.from(categoryIdSet);

      if (selectedCategoryIds.length > 0) {
        queryParams.push(selectedCategoryIds);
        const idsParamIndex = queryParams.length;
        categoryFilterClause = `AND t.category_definition_id = ANY($${idsParamIndex}::int[])`;
      }
    }

    if (vendorList.length > 0) {
      queryParams.push(vendorList);
      const vendorParamIndex = queryParams.length;
      vendorFilterClause = `AND t.vendor = ANY($${vendorParamIndex}::text[])`;
    }

    if (dataType === 'transactions' || dataType === 'full') {
      // Export transactions
      const transactionsResult = await client.query(
        `
          SELECT
            t.date,
            t.vendor,
            t.name,
            t.price,
            CASE WHEN cd.parent_id IS NOT NULL THEN cd.name ELSE parent.name END AS category,
            COALESCE(parent.name, cd.name) AS parent_category,
            t.type,
            t.status,
            t.account_number,
            t.processed_date,
            t.category_definition_id,
            cd.name AS category_name,
            cd.name_en AS category_name_en,
            parent.name AS parent_category_name,
            parent.name_en AS parent_category_name_en,
            cd.category_type
          FROM transactions t
          LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
          LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
          WHERE t.date >= $1
          AND t.date <= $2
          ${typeFilterClause}
          ${categoryFilterClause}
          ${vendorFilterClause}
          
          ORDER BY t.date DESC, t.vendor, t.name
        `,
        queryParams
      );

      exportData.transactions = transactionsResult.rows;
    }

    if (dataType === 'categories' || dataType === 'full') {
      // Export category summary
      const categoriesResult = await client.query(
        `
          SELECT
            COALESCE(parent.id, cd.id) AS category_definition_id,
            COALESCE(parent.name, cd.name, t.parent_category, t.category, 'Uncategorized') AS category,
            COALESCE(parent.name_en, cd.name_en, t.parent_category, t.category, 'Uncategorized') AS category_name_en,
            parent.name AS parent_category,
            parent.name_en AS parent_category_name_en,
            COUNT(*) AS transaction_count,
            SUM(ABS(t.price)) AS total_amount,
            MAX(COALESCE(parent.category_type, cd.category_type)) AS category_type
          FROM transactions t
          LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
          LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
          WHERE t.date >= $1
          AND t.date <= $2
          ${typeFilterClause}
          ${categoryFilterClause}
          ${vendorFilterClause}
          
          GROUP BY
            COALESCE(parent.id, cd.id),
            COALESCE(parent.name, cd.name, t.parent_category, t.category, 'Uncategorized'),
            COALESCE(parent.name_en, cd.name_en, t.parent_category, t.category, 'Uncategorized'),
            parent.name,
            parent.name_en
          ORDER BY total_amount DESC
        `,
        queryParams
      );

      exportData.categories = categoriesResult.rows;
    }

    if (dataType === 'vendors' || dataType === 'full') {
      // Export vendor summary
      const vendorsResult = await client.query(
        `
          SELECT
            t.vendor,
            COUNT(*) AS transaction_count,
            SUM(ABS(t.price)) AS total_amount,
            MIN(t.date) AS first_transaction,
            MAX(t.date) AS last_transaction
          FROM transactions t
          LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
          LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
          WHERE t.date >= $1
          AND t.date <= $2
          ${typeFilterClause}
          ${categoryFilterClause}
          ${vendorFilterClause}
          
          GROUP BY t.vendor
          ORDER BY total_amount DESC
        `,
        queryParams
      );

      exportData.vendors = vendorsResult.rows;
    }

    if (dataType === 'budgets' || dataType === 'full') {
      // Export budgets
      const budgetsResult = await client.query(`
        SELECT
          cb.category_definition_id,
          cd.name AS category_name,
          parent.name AS parent_category_name,
          parent.name_en AS parent_category_name_en,
          cb.period_type,
          cb.budget_limit,
          cb.is_active,
          cb.created_at,
          cb.updated_at
        FROM category_budgets cb
        JOIN category_definitions cd ON cd.id = cb.category_definition_id
        LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
        ORDER BY cd.category_type, parent.name, cd.name, cb.period_type
      `);

      exportData.budgets = budgetsResult.rows;
    }

    // Format response based on format
    if (format === 'csv') {
      let csvContent = '';
      let filename = `clarify-export-${dataType}-${timestamp}.csv`;

      if (dataType === 'transactions') {
        csvContent = formatTransactionsCSV(exportData.transactions);
      } else if (dataType === 'categories') {
        csvContent = formatCategoriesCSV(exportData.categories);
      } else if (dataType === 'vendors') {
        csvContent = formatVendorsCSV(exportData.vendors);
      } else if (dataType === 'full') {
        // For full export, create separate CSV sections
        const sections = [];

        if (exportData.transactions) {
          sections.push('=== TRANSACTIONS ===');
          sections.push(formatTransactionsCSV(exportData.transactions));
          sections.push('');
        }

        if (exportData.categories) {
          sections.push('=== CATEGORIES SUMMARY ===');
          sections.push(formatCategoriesCSV(exportData.categories));
          sections.push('');
        }

        if (exportData.vendors) {
          sections.push('=== VENDORS SUMMARY ===');
          sections.push(formatVendorsCSV(exportData.vendors));
          sections.push('');
        }

        csvContent = sections.join('\n');
        filename = `clarify-full-export-${timestamp}.csv`;
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csvContent);
    }

    // JSON format
    const response = standardizeResponse({
      ...exportData,
      exportInfo: {
        format,
        dataType,
        dateRange: { start, end },
        filters: {
          categories: categoryValues.length > 0 ? categoryValues : null,
          vendors: vendorList.length > 0 ? vendorList : null,
          excludeDuplicates: excludeDuplicates === 'true',
          includeIncome: includeIncome === 'true',
          includeExpenses: includeExpenses === 'true',
          includeInvestments: includeInvestments === 'true'
        },
        recordCounts: {
          transactions: exportData.transactions?.length || 0,
          categories: exportData.categories?.length || 0,
          vendors: exportData.vendors?.length || 0,
          budgets: exportData.budgets?.length || 0
        }
      }
    }, {
      exportedAt: new Date().toISOString(),
      format,
      dataType
    });

    if (format === 'json') {
      const filename = `clarify-export-${dataType}-${timestamp}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    res.status(200).json(response);

  } catch (error) {
    console.error('Error in data export:', error);
    res.status(500).json(
      standardizeError('Failed to export data', 'EXPORT_ERROR', {
        message: error.message
      })
    );
  } finally {
    client.release();
  }
}
