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
  LEFT JOIN institution_nodes fi
  ON vc.institution_id = fi.id
  AND fi.node_type = 'institution'
`;

const INSTITUTION_JOIN_INVESTMENT_ACCOUNT = `
  LEFT JOIN institution_nodes fi
  ON ia.institution_id = fi.id
  AND fi.node_type = 'institution'
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
  fi.scraper_company_id as institution_scraper_company_id,
  fi.parent_id as institution_parent_id,
  fi.hierarchy_path as institution_hierarchy_path,
  fi.depth_level as institution_depth_level
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
      display_order,
      parent_id,
      hierarchy_path,
      depth_level
    FROM institution_nodes
    WHERE is_active = 1
      AND node_type = 'institution'
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
      display_order,
      parent_id,
      hierarchy_path,
      depth_level
    FROM institution_nodes
    WHERE id = $1 AND is_active = 1 AND node_type = 'institution'
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
      display_order,
      parent_id,
      hierarchy_path,
      depth_level
    FROM institution_nodes
    WHERE vendor_code = $1 AND is_active = 1 AND node_type = 'institution'
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
 * Return the full institution tree (roots, groups, leaves) ordered by hierarchy path.
 * @param {object} db - Database connection
 * @returns {Promise<Array>} Array of institution nodes
 */
async function getInstitutionTree(db) {
  const result = await db.query(`
    SELECT
      id,
      parent_id,
      vendor_code,
      node_type,
      institution_type,
      category,
      subcategory,
      display_name_he,
      display_name_en,
      is_scrapable,
      logo_url,
      scraper_company_id,
      credential_fields,
      is_active,
      display_order,
      hierarchy_path,
      depth_level
    FROM institution_nodes
    WHERE is_active = 1
    ORDER BY hierarchy_path
  `);

  return result.rows;
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
 * Get vendor codes for the requested institution types
 * @param {object} db - Database connection
 * @param {string[]} types - Array of institution types
 * @returns {Promise<string[]>} Array of vendor codes
 */
async function getVendorCodesByTypes(db, types = []) {
  if (!Array.isArray(types) || types.length === 0) {
    return [];
  }

  await loadInstitutionsCache(db);
  const typeSet = new Set(types);

  return institutionsCache
    .filter(inst => typeSet.has(inst.institution_type))
    .map(inst => inst.vendor_code);
}

/**
 * Get vendor codes for the requested categories
 * @param {object} db - Database connection
 * @param {string[]} categories - Array of categories
 * @returns {Promise<string[]>} Array of vendor codes
 */
async function getVendorCodesByCategories(db, categories = []) {
  if (!Array.isArray(categories) || categories.length === 0) {
    return [];
  }

  await loadInstitutionsCache(db);
  const categorySet = new Set(categories);

  return institutionsCache
    .filter(inst => categorySet.has(inst.category))
    .map(inst => inst.vendor_code);
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
    scraper_company_id: row.institution_scraper_company_id,
    parent_id: row.institution_parent_id,
    hierarchy_path: row.institution_hierarchy_path,
    depth_level: row.institution_depth_level
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

/**
 * Backfill missing institution_id values for vendor_credentials and investment_accounts.
 * Runs safe UPDATE statements mapping existing vendor / account_type strings to institution IDs.
 * @param {object} db - Database connection (defaults to shared database module)
 */
async function backfillMissingInstitutionIds(db) {
  const databaseModule = db || require('./database.js');

  try {
    const vendorUpdate = await databaseModule.query(
      `
        UPDATE vendor_credentials
           SET institution_id = (
             SELECT fi.id FROM institution_nodes fi
             WHERE fi.vendor_code = vendor_credentials.vendor
               AND fi.node_type = 'institution'
           )
         WHERE institution_id IS NULL
           AND vendor IN (SELECT vendor_code FROM institution_nodes WHERE node_type = 'institution')
      `,
    );

    if (vendorUpdate.rowCount > 0) {
      console.info(`[institutions] Backfilled institution_id for ${vendorUpdate.rowCount} vendor credential(s)`);
    }
  } catch (error) {
    console.error('[institutions] Failed to backfill vendor_credentials.institution_id', error);
  }

  try {
    const investmentUpdate = await databaseModule.query(
      `
        UPDATE investment_accounts
           SET institution_id = (
             SELECT fi.id FROM institution_nodes fi
             WHERE fi.vendor_code = investment_accounts.account_type
               AND fi.node_type = 'institution'
           )
         WHERE institution_id IS NULL
           AND account_type IN (SELECT vendor_code FROM institution_nodes WHERE node_type = 'institution')
      `,
    );

    if (investmentUpdate.rowCount > 0) {
      console.info(`[institutions] Backfilled institution_id for ${investmentUpdate.rowCount} investment account(s)`);
    }
  } catch (error) {
    console.error('[institutions] Failed to backfill investment_accounts.institution_id', error);
  }
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
  getInstitutionTree,

  // Mapping helpers
  mapInstitutionToVendorCode,
  mapVendorCodeToInstitutionId,
  getVendorCodesByTypes,
  getVendorCodesByCategories,

  // Query fragments (export for reuse in services)
  INSTITUTION_JOIN_VENDOR_CRED,
  INSTITUTION_JOIN_INVESTMENT_ACCOUNT,
  INSTITUTION_SELECT_FIELDS,

  // Row builders
  buildInstitutionFromRow,

  // Enrichment helpers
  enrichCredentialWithInstitution,
  enrichAccountWithInstitution,

  // Backfill helpers
  backfillMissingInstitutionIds,
};
