const path = require('path');

// Load israeli-bank-scrapers from app directory
let CompanyTypes, createScraper;
try {
  const scraperModule = require(path.join(__dirname, '..', 'app', 'node_modules', 'israeli-bank-scrapers'));
  CompanyTypes = scraperModule.CompanyTypes;
  createScraper = scraperModule.createScraper;
} catch (error) {
  console.error('Failed to load israeli-bank-scrapers:', error.message);
  // Fallback - try global installation
  try {
    const scraperModule = require('israeli-bank-scrapers');
    CompanyTypes = scraperModule.CompanyTypes;
    createScraper = scraperModule.createScraper;
  } catch (fallbackError) {
    console.error('israeli-bank-scrapers not available:', fallbackError.message);
  }
}
const crypto = require('crypto');
const { dbManager } = require('./database');
const { BANK_CATEGORY_NAME } = require('../app/lib/category-constants.js');

// Import constants - need to handle ES module import in CommonJS
const BANK_VENDORS = ['hapoalim', 'leumi', 'mizrahi', 'otsarHahayal', 'beinleumi', 'massad', 'yahav', 'union'];
const SPECIAL_BANK_VENDORS = ['discount', 'mercantile'];
const CREDIT_CARD_VENDORS = ['visaCal', 'max', 'isracard', 'amex'];

class ElectronScraper {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
  }

  normalizeCategoryRecord(info) {
    if (!info) return null;
    if (info.id) {
      return {
        id: info.id,
        name: info.name,
        parentName: info.parent_name || null,
        parentId: info.parent_id ?? null,
      };
    }

    return {
      id: info.category_definition_id || null,
      name: info.subcategory || info.parent_category || null,
      parentName: info.parent_category || null,
      parentId: info.parent_id ?? null,
    };
  }

  async getCategoryInfo(categoryId) {
    if (!categoryId) return null;
    const result = await dbManager.query(
      `SELECT
         cd.id,
         cd.name,
         cd.category_type,
         cd.parent_id,
         parent.name AS parent_name
       FROM category_definitions cd
       LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
       WHERE cd.id = $1`,
      [categoryId]
    );
    return result.rows[0] || null;
  }

  async resolveCategoryFromMapping(term) {
    if (!term) return null;
    const mapping = await dbManager.query(
      `SELECT
         cm.category_definition_id,
         cd.name AS subcategory,
         cd.parent_id,
         parent.name AS parent_category
       FROM category_mapping cm
       JOIN category_definitions cd ON cd.id = cm.category_definition_id
       LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
       WHERE cm.hebrew_category = $1`,
      [term]
    );
    return mapping.rows[0] || null;
  }

  async findCategoryByName(name, parentName) {
    if (!name) return null;
    const params = [name];
    let query = `
      SELECT
        cd.id AS category_definition_id,
        cd.name AS subcategory,
        cd.parent_id,
        parent.name AS parent_category
      FROM category_definitions cd
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
      WHERE LOWER(cd.name) = LOWER($1)
    `;
    if (parentName) {
      params.push(parentName);
      query += ' AND LOWER(parent.name) = LOWER($2)';
    }
    const result = await dbManager.query(query, params);
    return result.rows[0] || null;
  }

  async insertTransaction(txn, companyId, isBank, accountNumber) {
    const uniqueId = `${txn.identifier}-${companyId}-${txn.processedDate}-${txn.description}`;
    const hash = crypto.createHash('sha1');
    hash.update(uniqueId);
    txn.identifier = hash.digest('hex');

    let amount = txn.chargedAmount || txn.originalAmount || 0;
    let category = txn.category;
    let parentCategory = null;
    let subcategory = null;
    let categoryDefinitionId = null;
    let categoryInfo = null;

    if (!isBank) {
      const rawAmount = txn.chargedAmount || txn.originalAmount || 0;
      amount = rawAmount > 0 ? rawAmount * -1 : rawAmount;

      if (txn.category) {
        categoryInfo = this.normalizeCategoryRecord(
          await this.resolveCategoryFromMapping(txn.category)
        );
      }

      if (!categoryInfo) {
        const categorisation = await this.autoCategorizeTransaction(txn.description);
        if (categorisation.success) {
          if (categorisation.categoryDefinitionId) {
            categoryInfo = this.normalizeCategoryRecord(
              await this.getCategoryInfo(categorisation.categoryDefinitionId)
            );
          }
          if (!categoryInfo && categorisation.subcategory) {
            categoryInfo = this.normalizeCategoryRecord(
              await this.findCategoryByName(
                categorisation.subcategory,
                categorisation.parentCategory
              )
            );
          }
          if (!categoryInfo && categorisation.parentCategory) {
            categoryInfo = this.normalizeCategoryRecord(
              await this.findCategoryByName(categorisation.parentCategory, null)
            );
          }

          if (!categoryInfo) {
            parentCategory = categorisation.parentCategory || parentCategory;
            subcategory = categorisation.subcategory || subcategory;
            category = categorisation.subcategory || categorisation.parentCategory || category;
          }
        }
      }

      if (!categoryInfo && category && category !== 'N/A') {
        categoryInfo = this.normalizeCategoryRecord(
          await this.findCategoryByName(category, parentCategory)
        );
      }

      if (categoryInfo && categoryInfo.id) {
        categoryDefinitionId = categoryInfo.id;
        const hasParent = Boolean(categoryInfo.parentName);
        category = categoryInfo.name || category;
        parentCategory = hasParent ? (categoryInfo.parentName || category) : (categoryInfo.name || category);
        subcategory = hasParent ? (categoryInfo.name || subcategory || category) : null;
      }
    } else {
      amount = txn.chargedAmount || txn.originalAmount || 0;
      const bankCategory = await resolveBankCategory(dbManager);
      categoryDefinitionId = bankCategory.id;
      const hasParent = Boolean(bankCategory.parent_name);
      category = bankCategory.name;
      parentCategory = hasParent ? bankCategory.parent_name : bankCategory.name;
      subcategory = hasParent ? bankCategory.name : null;
    }

    try {
      await dbManager.query(
        `INSERT INTO transactions (
          identifier,
          vendor,
          date,
          name,
          price,
          category,
          parent_category,
          subcategory,
          category_definition_id,
          merchant_name,
          auto_categorized,
          confidence_score,
          type,
          processed_date,
          original_amount,
          original_currency,
          charged_currency,
          memo,
          status,
          account_number
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (identifier, vendor) DO NOTHING`,
        [
          txn.identifier,
          companyId,
          new Date(txn.date),
          txn.description,
          amount,
          category || 'N/A',
          parentCategory,
          subcategory,
          categoryDefinitionId,
          txn.description,
          Boolean(categoryDefinitionId || parentCategory),
          categoryDefinitionId ? 0.8 : parentCategory ? 0.5 : 0.0,
          txn.type,
          txn.processedDate,
          txn.originalAmount,
          txn.originalCurrency,
          txn.chargedCurrency,
          txn.memo,
          txn.status,
          accountNumber
        ]
      );
    } catch (error) {
      console.error("Error inserting transaction:", error);
      throw error;
    }
  }

  async autoCategorizeTransaction(transactionName) {
    try {
      const cleanName = transactionName.toLowerCase().trim();

      // Query categorization rules for matching patterns
      const rulesResult = await dbManager.query(
        `SELECT
          cr.name_pattern,
          cr.category_definition_id,
          cd.name AS subcategory,
          cd.parent_id,
          parent.name AS parent_category,
          cr.priority
         FROM categorization_rules cr
         LEFT JOIN category_definitions cd ON cd.id = cr.category_definition_id
         LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
         WHERE cr.is_active = true
         AND $1 ILIKE '%' || cr.name_pattern || '%'
         ORDER BY
           cr.priority DESC,
           LENGTH(cr.name_pattern) DESC
         LIMIT 1`,
        [cleanName]
      );

      if (rulesResult.rows.length > 0) {
        const match = rulesResult.rows[0];
        return {
          success: true,
          categoryDefinitionId: match.category_definition_id || null,
          parentCategory: match.parent_category || null,
          subcategory: match.subcategory || null,
          confidence: 0.8
        };
      }

      return { success: false };
    } catch (error) {
      console.error('Error in auto-categorization:', error);
      return { success: false };
    }
  }

  async applyCategorizationRules() {
    try {
      // Get all active categorization rules
      const rulesResult = await dbManager.query(`
        SELECT
          cr.id,
          cr.name_pattern,
          cr.target_category,
          cr.parent_category,
          cr.subcategory,
          cr.category_definition_id,
          cd.name AS resolved_subcategory,
          parent.name AS resolved_parent_category,
          cr.priority
        FROM categorization_rules cr
        LEFT JOIN category_definitions cd ON cd.id = cr.category_definition_id
        LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
        WHERE cr.is_active = true
        ORDER BY cr.priority DESC, cr.id
      `);

      const rules = rulesResult.rows;
      let totalUpdated = 0;

      // Apply each rule to transactions that don't already have the target category
      for (const rule of rules) {
        const pattern = `%${rule.name_pattern}%`;
        let categoryId = rule.category_definition_id;
        let resolvedSub = rule.resolved_subcategory || rule.subcategory || null;
        let resolvedParent =
          rule.resolved_parent_category ||
          rule.parent_category ||
          (resolvedSub ? null : rule.target_category) ||
          null;

        if (!categoryId) {
          const fallback = this.normalizeCategoryRecord(
            await this.findCategoryByName(
              resolvedSub || resolvedParent || rule.target_category,
              resolvedParent
            )
          );
          if (fallback) {
            categoryId = fallback.id;
            resolvedParent = fallback.parentName || resolvedParent;
            resolvedSub = fallback.parentId ? fallback.name : resolvedSub;
          }
        }

        const categoryName = resolvedSub || resolvedParent || rule.target_category || rule.name_pattern;
        const confidence = categoryId ? 0.8 : 0.5;

        const updateResult = await dbManager.query(`
          UPDATE transactions
          SET
            category_definition_id = COALESCE($2, category_definition_id),
            category = COALESCE($3, category),
            parent_category = COALESCE($4, parent_category),
            subcategory = COALESCE($5, subcategory),
            auto_categorized = true,
            confidence_score = GREATEST(confidence_score, $6)
          WHERE LOWER(name) LIKE LOWER($1)
            AND category_definition_id NOT IN (
              SELECT id FROM category_definitions
              WHERE name = $7 OR category_type = 'income'
            )
        `, [pattern, categoryId, categoryName, resolvedParent, resolvedSub, confidence, BANK_CATEGORY_NAME]);

        totalUpdated += updateResult.rowCount;
      }

      console.log(`Applied ${rules.length} rules to ${totalUpdated} transactions`);
      return { rulesApplied: rules.length, transactionsUpdated: totalUpdated };
    } catch (error) {
      console.error('Error applying categorization rules:', error);
      throw error;
    }
  }

  prepareCredentials(companyId, credentials) {
    let scraperCredentials;

    if (companyId === 'visaCal' || companyId === 'max') {
      // Visa Cal and Max use username + password
      scraperCredentials = {
        username: credentials.username,
        password: credentials.password
      };
    } else if (companyId === 'discount' || companyId === 'mercantile') {
      // Discount and Mercantile require id, password, and num (identification code)
      scraperCredentials = {
        id: credentials.id,
        password: credentials.password,
        num: credentials.num || credentials.identification_code
      };
    } else if (companyId === 'hapoalim') {
      // Hapoalim uses userCode instead of username
      scraperCredentials = {
        userCode: credentials.username,
        password: credentials.password
      };
    } else if (companyId === 'yahav') {
      // Yahav uses username, password, and nationalID
      scraperCredentials = {
        username: credentials.username,
        password: credentials.password,
        nationalID: credentials.nationalID || credentials.id
      };
    } else if (BANK_VENDORS.includes(companyId)) {
      // Other banks use username + password
      scraperCredentials = {
        username: credentials.username,
        password: credentials.password,
        bankAccountNumber: credentials.bankAccountNumber || undefined
      };
    } else if (companyId === 'amex') {
      // Amex uses username (ID number), card6Digits, and password
      scraperCredentials = {
        username: credentials.id,
        card6Digits: credentials.card6Digits,
        password: credentials.password
      };
    } else {
      // Isracard and other credit cards use id, card6Digits, and password
      scraperCredentials = {
        id: credentials.id,
        card6Digits: credentials.card6Digits,
        password: credentials.password
      };
    }

    return scraperCredentials;
  }

  sendProgress(data) {
    if (this.mainWindow && this.mainWindow.webContents) {
      this.mainWindow.webContents.send('scrape:progress', data);
    }
  }

  async scrape(options, credentials) {
    const { companyId, startDate } = options;

    this.sendProgress({
      vendor: companyId,
      status: 'starting',
      progress: 0,
      message: 'Initializing scraper...'
    });

    try {
      const companyType = CompanyTypes[companyId];
      if (!companyType) {
        throw new Error(`Invalid company ID: ${companyId}`);
      }

      const isBank = BANK_VENDORS.includes(companyId) || SPECIAL_BANK_VENDORS.includes(companyId);
      const scraperCredentials = this.prepareCredentials(companyId, credentials);

      console.log('Prepared scraper credentials (masked):', {
        ...scraperCredentials,
        password: scraperCredentials.password ? '***' : undefined,
        id: scraperCredentials.id ? scraperCredentials.id.substring(0, 3) + '***' : undefined,
        num: scraperCredentials.num ? scraperCredentials.num.substring(0, 3) + '***' : undefined
      });

      // Create scraper with Electron-specific configuration
      const scraper = createScraper({
        companyId: companyType,
        startDate: new Date(startDate),
        showBrowser: isBank, // Banks require UI interaction
        verbose: true,
        timeout: 120000, // 2 minutes timeout
        executablePath: (() => {
          try {
            // Try to get Puppeteer's bundled Chrome first
            const puppeteer = require(path.join(__dirname, '..', 'app', 'node_modules', 'puppeteer'));
            return puppeteer.executablePath();
          } catch (error) {
            console.warn('Could not find Puppeteer Chrome in Electron, using default');
            return undefined; // Let israeli-bank-scrapers find its own browser
          }
        })(),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      });

      // Insert audit row: started
      const triggeredBy = credentials?.username || credentials?.id || credentials?.nickname || 'electron-user';
      const auditResult = await dbManager.query(
        `INSERT INTO scrape_events (triggered_by, vendor, start_date, status, message)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          triggeredBy,
          companyId,
          new Date(startDate),
          'started',
          'Scrape initiated from Electron app'
        ]
      );
      const auditId = auditResult.rows[0]?.id;

      this.sendProgress({
        vendor: companyId,
        status: 'authenticating',
        progress: 25,
        message: 'Connecting to bank/credit card provider...'
      });

      console.log('Starting scrape operation...');
      const result = await scraper.scrape(scraperCredentials);

      this.sendProgress({
        vendor: companyId,
        status: 'processing',
        progress: 75,
        message: 'Processing transactions...'
      });

      console.log('Scrape operation completed');

      if (!result.success) {
        console.error('Scraping failed:', result.errorType, result.errorMessage);

        // Update audit as failed
        if (auditId) {
          await dbManager.query(
            `UPDATE scrape_events SET status = $1, message = $2 WHERE id = $3`,
            ['failed', `${result.errorType}: ${result.errorMessage || 'No message'}`, auditId]
          );
        }

        this.sendProgress({
          vendor: companyId,
          status: 'failed',
          progress: 100,
          message: `Failed: ${result.errorMessage || result.errorType}`,
          error: result.errorMessage || result.errorType
        });

        return {
          success: false,
          errorType: result.errorType,
          errorMessage: result.errorMessage
        };
      }

      // Process transactions
      let bankTransactions = 0;
      let totalTransactions = 0;

      for (const account of result.accounts) {
        for (const txn of account.txns) {
          if (isBank) {
            bankTransactions++;
          }
          totalTransactions++;
          await this.insertTransaction(txn, companyId, isBank, account.accountNumber);
        }
      }

      // Apply categorization rules
      await this.applyCategorizationRules();

      console.log(`Scraped ${totalTransactions} transactions (${bankTransactions} bank transactions)`);

      // Update audit as success
      if (auditId) {
        const accountsCount = Array.isArray(result.accounts) ? result.accounts.length : 0;
        const message = `Success: accounts=${accountsCount}, transactions=${totalTransactions}`;
        await dbManager.query(
          `UPDATE scrape_events SET status = $1, message = $2 WHERE id = $3`,
          ['success', message, auditId]
        );
      }

      this.sendProgress({
        vendor: companyId,
        status: 'completed',
        progress: 100,
        message: `Successfully imported ${totalTransactions} transactions`,
        accounts: result.accounts.length,
        transactions: totalTransactions
      });

      return {
        success: true,
        accounts: result.accounts,
        transactionCount: totalTransactions,
        bankTransactions: bankTransactions
      };

    } catch (error) {
      console.error('Scraping failed:', error);

      this.sendProgress({
        vendor: companyId,
        status: 'failed',
        progress: 100,
        message: `Error: ${error.message}`,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = { ElectronScraper };
let bankCategoryCache = null;

async function resolveBankCategory(client) {
  if (bankCategoryCache) return bankCategoryCache;
  const result = await client.query(
    `SELECT
       cd.id,
       cd.name,
       cd.parent_id,
       parent.name AS parent_name
     FROM category_definitions cd
     LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
     WHERE cd.name = $1
     LIMIT 1`,
    [BANK_CATEGORY_NAME]
  );

  if (!result.rows.length) {
    throw new Error(`Bank category '${BANK_CATEGORY_NAME}' not found`);
  }

  bankCategoryCache = result.rows[0];
  return bankCategoryCache;
}
