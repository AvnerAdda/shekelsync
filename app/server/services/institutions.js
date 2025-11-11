/**
 * Financial Institutions Service
 *
 * Central service for managing financial institution lookups, caching, and mapping.
 * Used throughout the application to enrich vendor/account data with institution metadata.
 */

// In-memory cache for institutions to reduce DB queries
let institutionsCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * SQL fragments for reusable queries
 */
const INSTITUTION_JOIN_VENDOR_CRED = `
  LEFT JOIN financial_institutions fi
  ON vc.institution_id = fi.id
`;

const INSTITUTION_JOIN_INVESTMENT_ACCOUNT = `
  LEFT JOIN financial_institutions fi
  ON ia.institution_id = fi.id
`;

const INSTITUTION_SELECT_FIELDS = `
  fi.id as institution_id,
  fi.vendor_code as institution_vendor_code,
  fi.display_name_he as institution_display_name_he,
  fi.display_name_en as institution_display_name_en,
  fi.institution_type,
  fi.category as institution_category,
  fi.subcategory as institution_subcategory,
  fi.logo_url as institution_logo_url,
  fi.is_scrapable as institution_is_scrapable,
  fi.scraper_company_id as institution_scraper_company_id
`;

/**
 * Load all institutions into cache
 * @param {object} db - Database connection
 * @returns {Promise<Array>} Array of all active institutions
 */
async function loadInstitutionsCache(db) {
  const now = Date.now();

  // Return cache if still valid
  if (institutionsCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_TTL) {
    return institutionsCache;
  }

  const result = await db.query(`
    SELECT
      id,
      vendor_code,
      institution_type,
      display_name_he,
      display_name_en,
      category,
      subcategory,
      is_scrapable,
      logo_url,
      scraper_company_id,
      credential_fields,
      display_order
    FROM financial_institutions
    WHERE is_active = 1
    ORDER BY category, display_order
  `);

  institutionsCache = result.rows;
  cacheTimestamp = now;

  return institutionsCache;
}

/**
 * Clear institutions cache (call after updates)
 */
function clearInstitutionsCache() {
  institutionsCache = null;
  cacheTimestamp = null;
}

/**
 * Get institution by ID
 * @param {object} db - Database connection
 * @param {number} institutionId - Institution ID
 * @returns {Promise<object|null>} Institution record or null
 */
async function getInstitutionById(db, institutionId) {
  if (!institutionId) return null;

  // Try cache first
  const cached = institutionsCache?.find(inst => inst.id === institutionId);
  if (cached) return cached;

  // Query database
  const result = await db.query(`
    SELECT
      id,
      vendor_code,
      institution_type,
      display_name_he,
      display_name_en,
      category,
      subcategory,
      is_scrapable,
      logo_url,
      scraper_company_id,
      credential_fields,
      display_order
    FROM financial_institutions
    WHERE id = $1 AND is_active = 1
  `, [institutionId]);

  return result.rows[0] || null;
}

/**
 * Get institution by vendor code
 * @param {object} db - Database connection
 * @param {string} vendorCode - Vendor code (e.g., 'hapoalim', 'visaCal')
 * @returns {Promise<object|null>} Institution record or null
 */
async function getInstitutionByVendorCode(db, vendorCode) {
  if (!vendorCode) return null;

  // Try cache first
  await loadInstitutionsCache(db);
  const cached = institutionsCache?.find(inst => inst.vendor_code === vendorCode);
  if (cached) return cached;

  // Query database (if not in cache)
  const result = await db.query(`
    SELECT
      id,
      vendor_code,
      institution_type,
      display_name_he,
      display_name_en,
      category,
      subcategory,
      is_scrapable,
      logo_url,
      scraper_company_id,
      credential_fields,
      display_order
    FROM financial_institutions
    WHERE vendor_code = $1 AND is_active = 1
  `, [vendorCode]);

  return result.rows[0] || null;
}

/**
 * Get all institutions, optionally filtered
 * @param {object} db - Database connection
 * @param {object} filters - Optional filters {type, category, scrapable}
 * @returns {Promise<Array>} Array of institutions
 */
async function getAllInstitutions(db, filters = {}) {
  await loadInstitutionsCache(db);

  let institutions = [...institutionsCache];

  // Apply filters
  if (filters.type) {
    institutions = institutions.filter(i => i.institution_type === filters.type);
  }
  if (filters.category) {
    institutions = institutions.filter(i => i.category === filters.category);
  }
  if (filters.scrapable !== undefined) {
    institutions = institutions.filter(i => i.is_scrapable === (filters.scrapable ? 1 : 0));
  }

  return institutions;
}

/**
 * Get institutions by type
 * @param {object} db - Database connection
 * @param {string} type - Institution type ('bank', 'credit_card', 'investment', etc.)
 * @returns {Promise<Array>} Array of institutions
 */
async function getInstitutionsByType(db, type) {
  return getAllInstitutions(db, { type });
}

/**
 * Get institutions by category
 * @param {object} db - Database connection
 * @param {string} category - Category ('banking', 'investments', 'insurance', etc.)
 * @returns {Promise<Array>} Array of institutions
 */
async function getInstitutionsByCategory(db, category) {
  return getAllInstitutions(db, { category });
}

/**
 * Get all scrapable institutions
 * @param {object} db - Database connection
 * @returns {Promise<Array>} Array of scrapable institutions
 */
async function getScrapableInstitutions(db) {
  return getAllInstitutions(db, { scrapable: true });
}

/**
 * Map institution object to vendor code for israeli-bank-scrapers
 * @param {object} institution - Institution object
 * @returns {string|null} Vendor code or null
 */
function mapInstitutionToVendorCode(institution) {
  if (!institution) return null;
  return institution.scraper_company_id || institution.vendor_code;
}

/**
 * Map vendor code to institution ID
 * @param {object} db - Database connection
 * @param {string} vendorCode - Vendor code
 * @returns {Promise<number|null>} Institution ID or null
 */
async function mapVendorCodeToInstitutionId(db, vendorCode) {
  const institution = await getInstitutionByVendorCode(db, vendorCode);
  return institution?.id || null;
}

/**
 * Build institution object from query result row
 * Extracts institution fields prefixed with 'institution_'
 * @param {object} row - Database query result row
 * @returns {object|null} Institution object or null
 */
function buildInstitutionFromRow(row) {
  if (!row || !row.institution_id) return null;

  return {
    id: row.institution_id,
    vendor_code: row.institution_vendor_code,
    display_name_he: row.institution_display_name_he,
    display_name_en: row.institution_display_name_en,
    institution_type: row.institution_type,
    category: row.institution_category,
    subcategory: row.institution_subcategory,
    logo_url: row.institution_logo_url,
    is_scrapable: row.institution_is_scrapable === 1,
    scraper_company_id: row.institution_scraper_company_id
  };
}

/**
 * Enrich vendor credential object with institution data
 * @param {object} db - Database connection
 * @param {object} credential - Vendor credential object
 * @returns {Promise<object>} Enriched credential with institution property
 */
async function enrichCredentialWithInstitution(db, credential) {
  if (!credential) return credential;

  if (credential.institution_id) {
    credential.institution = await getInstitutionById(db, credential.institution_id);
  } else if (credential.vendor) {
    // Fallback: lookup by vendor code if institution_id not set
    credential.institution = await getInstitutionByVendorCode(db, credential.vendor);
  }

  return credential;
}

/**
 * Enrich investment account object with institution data
 * @param {object} db - Database connection
 * @param {object} account - Investment account object
 * @returns {Promise<object>} Enriched account with institution property
 */
async function enrichAccountWithInstitution(db, account) {
  if (!account) return account;

  if (account.institution_id) {
    account.institution = await getInstitutionById(db, account.institution_id);
  } else if (account.account_type) {
    // Fallback: lookup by account_type as vendor code
    account.institution = await getInstitutionByVendorCode(db, account.account_type);
  }

  return account;
}

module.exports = {
  // Cache management
  loadInstitutionsCache,
  clearInstitutionsCache,

  // Lookup functions
  getInstitutionById,
  getInstitutionByVendorCode,
  getAllInstitutions,
  getInstitutionsByType,
  getInstitutionsByCategory,
  getScrapableInstitutions,

  // Mapping helpers
  mapInstitutionToVendorCode,
  mapVendorCodeToInstitutionId,

  // Query fragments (export for reuse in services)
  INSTITUTION_JOIN_VENDOR_CRED,
  INSTITUTION_JOIN_INVESTMENT_ACCOUNT,
  INSTITUTION_SELECT_FIELDS,

  // Row builders
  buildInstitutionFromRow,

  // Enrichment helpers
  enrichCredentialWithInstitution,
  enrichAccountWithInstitution
};
