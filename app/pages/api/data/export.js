import { getDB } from '../db.js';
import { buildDuplicateFilter, resolveDateRange, standardizeResponse, standardizeError } from '../utils/queryUtils.js';

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
      excludeDuplicates = 'true',
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
    const duplicateFilter = excludeDuplicates === 'true' ? await buildDuplicateFilter(client, 't') : '';

    let exportData = {};
    const timestamp = new Date().toISOString().split('T')[0];

    // Build type filters
    const typeFilters = [];
    if (includeIncome === 'true') typeFilters.push("t.price > 0");
    if (includeExpenses === 'true') typeFilters.push("t.price < 0");

    const typeFilterClause = typeFilters.length > 0 ? `AND (${typeFilters.join(' OR ')})` : '';

    // Build category filter
    let categoryFilter = '';
    if (categories) {
      const categoryList = Array.isArray(categories) ? categories : categories.split(',');
      const placeholders = categoryList.map((_, i) => `$${i + 3}`).join(',');
      categoryFilter = `AND (t.category IN (${placeholders}) OR t.parent_category IN (${placeholders}))`;
    }

    // Build vendor filter
    let vendorFilter = '';
    const vendorList = vendors ? (Array.isArray(vendors) ? vendors : vendors.split(',')) : [];
    if (vendorList.length > 0) {
      const vendorPlaceholders = vendorList.map((_, i) => `$${(categories ? categories.split(',').length : 0) + i + 3}`).join(',');
      vendorFilter = `AND t.vendor IN (${vendorPlaceholders})`;
    }

    const baseParams = [start, end];
    if (categories) baseParams.push(...categories.split(','));
    if (vendors) baseParams.push(...vendorList);

    if (dataType === 'transactions' || dataType === 'full') {
      // Export transactions
      const transactionsResult = await client.query(`
        SELECT
          t.date,
          t.vendor,
          t.name,
          t.price,
          t.category,
          t.parent_category,
          t.type,
          t.status,
          t.account_number,
          t.processed_date
        FROM transactions t
        WHERE t.date >= $1
        AND t.date <= $2
        ${typeFilterClause}
        ${categoryFilter}
        ${vendorFilter}
        ${duplicateFilter}
        ORDER BY t.date DESC, t.vendor, t.name
      `, baseParams);

      exportData.transactions = transactionsResult.rows;
    }

    if (dataType === 'categories' || dataType === 'full') {
      // Export category summary
      const categoriesResult = await client.query(`
        SELECT
          COALESCE(t.parent_category, t.category) as category,
          t.parent_category,
          COUNT(*) as transaction_count,
          SUM(ABS(t.price)) as total_amount
        FROM transactions t
        WHERE t.date >= $1
        AND t.date <= $2
        ${typeFilterClause}
        ${duplicateFilter}
        GROUP BY COALESCE(t.parent_category, t.category), t.parent_category
        ORDER BY total_amount DESC
      `, [start, end]);

      exportData.categories = categoriesResult.rows;
    }

    if (dataType === 'vendors' || dataType === 'full') {
      // Export vendor summary
      const vendorsResult = await client.query(`
        SELECT
          t.vendor,
          COUNT(*) as transaction_count,
          SUM(ABS(t.price)) as total_amount,
          MIN(t.date) as first_transaction,
          MAX(t.date) as last_transaction
        FROM transactions t
        WHERE t.date >= $1
        AND t.date <= $2
        ${typeFilterClause}
        ${duplicateFilter}
        GROUP BY t.vendor
        ORDER BY total_amount DESC
      `, [start, end]);

      exportData.vendors = vendorsResult.rows;
    }

    if (dataType === 'budgets' || dataType === 'full') {
      // Export budgets
      const budgetsResult = await client.query(`
        SELECT
          category,
          period_type,
          budget_limit,
          is_active,
          created_at,
          updated_at
        FROM category_budgets
        ORDER BY category, period_type
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
          categories: categories ? categories.split(',') : null,
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