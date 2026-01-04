const database = require('../database.js');
const { resolveDateRange, standardizeResponse, standardizeError } = require('../../../lib/server/query-utils.js');

const VALID_FORMATS = new Set(['csv', 'json']);
const VALID_DATA_TYPES = new Set(['transactions', 'categories', 'vendors', 'budgets', 'full']);

function escapeCSV(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatTransactionsCSV(transactions = [], includeInstitutions = true) {
  const headers = [
    'Date',
    'Vendor',
    'Description',
    'Amount',
    'Category',
    'Parent Category',
    'Type',
    'Status',
    'Account Number',
  ];

  if (includeInstitutions) {
    headers.push('Institution', 'Institution Type');
  }

  const csvRows = [headers.join(',')];

  transactions.forEach((txn) => {
    const row = [
      escapeCSV(txn.date),
      escapeCSV(txn.vendor),
      escapeCSV(txn.name),
      escapeCSV(txn.price),
      escapeCSV(txn.category),
      escapeCSV(txn.parent_category),
      escapeCSV(txn.type),
      escapeCSV(txn.status),
      escapeCSV(txn.account_number),
    ];

    if (includeInstitutions) {
      const institutionName =
        txn.institution?.display_name_he ||
        txn.institution?.display_name_en ||
        '';
      row.push(
        escapeCSV(institutionName),
        escapeCSV(txn.institution?.institution_type || ''),
      );
    }
    csvRows.push(row.join(','));
  });

  return csvRows.join('\n');
}

function formatCategoriesCSV(categories = []) {
  const headers = ['Category', 'Parent Category', 'Transaction Count', 'Total Amount'];
  const csvRows = [headers.join(',')];

  categories.forEach((cat) => {
    const row = [
      escapeCSV(cat.category),
      escapeCSV(cat.parent_category),
      escapeCSV(cat.transaction_count),
      escapeCSV(cat.total_amount),
    ];
    csvRows.push(row.join(','));
  });

  return csvRows.join('\n');
}

function formatVendorsCSV(vendors = [], includeInstitutions = true) {
  const headers = [
    'Vendor',
    'Transaction Count',
    'Total Amount',
    'First Transaction',
    'Last Transaction',
  ];

  if (includeInstitutions) {
    headers.splice(1, 0, 'Institution', 'Institution Type');
  }
  const csvRows = [headers.join(',')];

  vendors.forEach((vendor) => {
    const row = [
      escapeCSV(vendor.vendor),
      escapeCSV(vendor.transaction_count),
      escapeCSV(vendor.total_amount),
      escapeCSV(vendor.first_transaction),
      escapeCSV(vendor.last_transaction),
    ];

    if (includeInstitutions) {
      const institutionName =
        vendor.institution?.display_name_he ||
        vendor.institution?.display_name_en ||
        '';
      row.splice(
        1,
        0,
        escapeCSV(institutionName),
        escapeCSV(vendor.institution?.institution_type || ''),
      );
    }
    csvRows.push(row.join(','));
  });

  return csvRows.join('\n');
}

function buildInstitutionFromRow(row = {}) {
  if (!row.institution_id && !row.institution_vendor_code) {
    return null;
  }
  return {
    id: row.institution_id,
    vendor_code: row.institution_vendor_code,
    display_name_he: row.institution_name_he,
    display_name_en: row.institution_name_en,
    institution_type: row.institution_type,
    logo_url: row.institution_logo_url,
  };
}

function attachInstitution(row = {}) {
  const {
    institution_id,
    institution_vendor_code,
    institution_name_he,
    institution_name_en,
    institution_type,
    institution_logo_url,
    ...rest
  } = row;

  return {
    ...rest,
    institution: buildInstitutionFromRow({
      institution_id,
      institution_vendor_code,
      institution_name_he,
      institution_name_en,
      institution_type,
      institution_logo_url,
    }),
  };
}

async function resolveCategoryFilters(categoryValues = []) {
  if (categoryValues.length === 0) {
    return { clause: '', params: [] };
  }

  const { rows: categoryRows } = await database.query(
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
    [categoryValues],
  );

  const categoryIdSet = new Set();

  for (const row of categoryRows) {
    const id = typeof row.id === 'number' ? row.id : Number(row.id);
    if (Number.isFinite(id)) {
      categoryIdSet.add(id);
    }
  }

  const selectedCategoryIds = Array.from(categoryIdSet);

  if (selectedCategoryIds.length === 0) {
    return { clause: '', params: [] };
  }

  return {
    clause: `AND t.category_definition_id = ANY($__CATEGORY_IDS__::int[])`,
    params: [selectedCategoryIds],
  };
}

async function exportData(params = {}) {
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
    includeInvestments = 'true',
    includeInstitutions = 'true',
  } = params;

  if (!VALID_FORMATS.has(format)) {
    throw standardizeError(
      `Invalid format. Expected one of ${Array.from(VALID_FORMATS).join(', ')}`,
      'INVALID_FORMAT',
    );
  }

  if (!VALID_DATA_TYPES.has(dataType)) {
    throw standardizeError(
      `Invalid data type. Expected one of ${Array.from(VALID_DATA_TYPES).join(', ')}`,
      'INVALID_DATA_TYPE',
    );
  }

  const { start, end } = resolveDateRange({ startDate, endDate, months });

  const categoryValues = categories
    ? (Array.isArray(categories) ? categories : String(categories).split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  const vendorList = vendors
    ? (Array.isArray(vendors) ? vendors : String(vendors).split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  const timestamp = new Date().toISOString().split('T')[0];

  const typeFilters = [];
  if (includeIncome === 'true') typeFilters.push('t.price > 0');
  if (includeExpenses === 'true') typeFilters.push('t.price < 0');
  if (includeInvestments !== 'true') {
    typeFilters.push("(cd.category_type IS NULL OR cd.category_type != 'investment')");
  }
  const includeInstitutionsFlag = includeInstitutions !== 'false';

  const typeFilterClause = typeFilters.length > 0 ? `AND (${typeFilters.join(' OR ')})` : '';

  const queryParams = [start, end];
  let categoryFilterClause = '';
  let vendorFilterClause = '';

  if (categoryValues.length > 0) {
    const categoryFilter = await resolveCategoryFilters(categoryValues);
    if (categoryFilter.params.length > 0) {
      queryParams.push(categoryFilter.params[0]);
      const paramIndex = queryParams.length;
      categoryFilterClause = categoryFilter.clause.replace('__CATEGORY_IDS__', paramIndex);
    }
  }

  if (vendorList.length > 0) {
    queryParams.push(vendorList);
    const vendorParamIndex = queryParams.length;
    vendorFilterClause = `AND t.vendor = ANY($${vendorParamIndex}::text[])`;
  }

  const exportData = {};

  if (dataType === 'transactions' || dataType === 'full') {
    const transactionsResult = await database.query(
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
            cd.category_type,
            fi.id as institution_id,
            fi.vendor_code as institution_vendor_code,
            fi.display_name_he as institution_name_he,
            fi.display_name_en as institution_name_en,
            fi.institution_type,
            fi.logo_url as institution_logo_url
          FROM transactions t
          LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
          LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
          LEFT JOIN institution_nodes fi ON fi.vendor_code = t.vendor AND fi.node_type = 'institution'
          WHERE t.date >= $1
          AND t.date <= $2
          ${typeFilterClause}
          ${categoryFilterClause}
          ${vendorFilterClause}
          ORDER BY t.date DESC, t.vendor, t.name
        `,
      queryParams,
    );

    exportData.transactions = includeInstitutionsFlag
      ? transactionsResult.rows.map(attachInstitution)
      : transactionsResult.rows.map((row) => {
          const { institution_id, institution_vendor_code, institution_name_he, institution_name_en, institution_type, institution_logo_url, ...rest } = row;
          return rest;
        });
  }

  if (dataType === 'categories' || dataType === 'full') {
    const categoriesResult = await database.query(
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
      queryParams,
    );

    exportData.categories = categoriesResult.rows;
  }

  if (dataType === 'vendors' || dataType === 'full') {
    const vendorsResult = await database.query(
      `
          SELECT
            t.vendor,
            COUNT(*) AS transaction_count,
            SUM(ABS(t.price)) AS total_amount,
            MIN(t.date) AS first_transaction,
            MAX(t.date) AS last_transaction,
            fi.id as institution_id,
            fi.vendor_code as institution_vendor_code,
            fi.display_name_he as institution_name_he,
            fi.display_name_en as institution_name_en,
            fi.institution_type,
            fi.logo_url as institution_logo_url
          FROM transactions t
          LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
          LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
          LEFT JOIN institution_nodes fi ON fi.vendor_code = t.vendor AND fi.node_type = 'institution'
          WHERE t.date >= $1
          AND t.date <= $2
          ${typeFilterClause}
          ${categoryFilterClause}
          ${vendorFilterClause}
          GROUP BY t.vendor
          ORDER BY total_amount DESC
        `,
      queryParams,
    );

    exportData.vendors = includeInstitutionsFlag
      ? vendorsResult.rows.map(attachInstitution)
      : vendorsResult.rows.map((row) => {
          const { institution_id, institution_vendor_code, institution_name_he, institution_name_en, institution_type, institution_logo_url, ...rest } = row;
          return rest;
        });
  }

  if (dataType === 'budgets' || dataType === 'full') {
    const budgetsResult = await database.query(
      `
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
      `,
    );

    exportData.budgets = budgetsResult.rows;
  }

  if (format === 'csv') {
    let csvContent = '';
    let filename = `clarify-export-${dataType}-${timestamp}.csv`;

    if (dataType === 'transactions') {
      csvContent = formatTransactionsCSV(exportData.transactions, includeInstitutionsFlag);
    } else if (dataType === 'categories') {
      csvContent = formatCategoriesCSV(exportData.categories);
    } else if (dataType === 'vendors') {
      csvContent = formatVendorsCSV(exportData.vendors, includeInstitutionsFlag);
    } else if (dataType === 'full') {
      const sections = [];

      if (exportData.transactions) {
        sections.push('=== TRANSACTIONS ===');
        sections.push(formatTransactionsCSV(exportData.transactions, includeInstitutionsFlag));
        sections.push('');
      }

      if (exportData.categories) {
        sections.push('=== CATEGORIES SUMMARY ===');
        sections.push(formatCategoriesCSV(exportData.categories));
        sections.push('');
      }

      if (exportData.vendors) {
        sections.push('=== VENDORS SUMMARY ===');
        sections.push(formatVendorsCSV(exportData.vendors, includeInstitutionsFlag));
        sections.push('');
      }

      csvContent = sections.join('\n');
      filename = `clarify-full-export-${timestamp}.csv`;
    }

    return {
      format: 'csv',
      contentType: 'text/csv',
      filename,
      body: csvContent,
    };
  }

  const response = standardizeResponse(
    {
      ...exportData,
      exportInfo: {
        format,
        dataType,
        dateRange: { start, end },
        filters: {
          categories: categoryValues.length > 0 ? categoryValues : null,
          vendors: vendorList.length > 0 ? vendorList : null,
          includeIncome: includeIncome === 'true',
          includeExpenses: includeExpenses === 'true',
          includeInvestments: includeInvestments === 'true',
          includeInstitutions: includeInstitutionsFlag,
        },
        recordCounts: {
          transactions: exportData.transactions?.length || 0,
          categories: exportData.categories?.length || 0,
          vendors: exportData.vendors?.length || 0,
          budgets: exportData.budgets?.length || 0,
        },
      },
    },
    {
      exportedAt: new Date().toISOString(),
      format,
      dataType,
    },
  );

  return {
    format: 'json',
    contentType: 'application/json',
    filename: `clarify-export-${dataType}-${timestamp}.json`,
    body: response,
  };
}

module.exports = {
  exportData,
};
module.exports.default = module.exports;
