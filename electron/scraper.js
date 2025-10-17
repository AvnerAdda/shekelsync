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

// Import constants - need to handle ES module import in CommonJS
const BANK_VENDORS = ['hapoalim', 'leumi', 'mizrahi', 'otsarHahayal', 'beinleumi', 'massad', 'yahav', 'union'];
const SPECIAL_BANK_VENDORS = ['discount', 'mercantile'];
const CREDIT_CARD_VENDORS = ['visaCal', 'max', 'isracard', 'amex'];

class ElectronScraper {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
  }

  async insertTransaction(txn, companyId, isBank, accountNumber) {
    const uniqueId = `${txn.identifier}-${companyId}-${txn.processedDate}-${txn.description}`;
    const hash = crypto.createHash('sha1');
    hash.update(uniqueId);
    txn.identifier = hash.digest('hex');

    let amount = txn.chargedAmount;
    let category = txn.category;
    let parentCategory = null;
    let subcategory = null;

    if (!isBank) {
      amount = txn.chargedAmount * -1;

      // First, try to map Hebrew category from scraper using category_mapping table
      if (txn.category) {
        const mappingResult = await dbManager.query(
          `SELECT parent_category, subcategory FROM category_mapping WHERE hebrew_category = $1`,
          [txn.category]
        );

        if (mappingResult.rows.length > 0) {
          parentCategory = mappingResult.rows[0].parent_category;
          subcategory = mappingResult.rows[0].subcategory;
          category = subcategory || parentCategory;
        }
      }

      // If no mapping found, try to categorize using merchant catalog
      if (!parentCategory) {
        const categorization = await this.autoCategorizeTransaction(txn.description);
        if (categorization.success) {
          parentCategory = categorization.parent_category;
          subcategory = categorization.subcategory;
          category = subcategory || parentCategory;
        }
      }
    } else {
      category = "Bank";
      parentCategory = "Bank";
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
          txn.description,
          parentCategory ? true : false,
          parentCategory ? 0.8 : 0.0,
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
          name_pattern,
          parent_category,
          subcategory,
          priority
         FROM categorization_rules
         WHERE is_active = true
         AND $1 ILIKE '%' || name_pattern || '%'
         ORDER BY
           priority DESC,
           LENGTH(name_pattern) DESC
         LIMIT 1`,
        [cleanName]
      );

      if (rulesResult.rows.length > 0) {
        const match = rulesResult.rows[0];
        return {
          success: true,
          parent_category: match.parent_category || match.name_pattern,
          subcategory: match.subcategory,
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
        SELECT id, name_pattern, target_category, parent_category, subcategory, priority
        FROM categorization_rules
        WHERE is_active = true
        ORDER BY priority DESC, id
      `);

      const rules = rulesResult.rows;
      let totalUpdated = 0;

      // Apply each rule to transactions that don't already have the target category
      for (const rule of rules) {
        const pattern = `%${rule.name_pattern}%`;

        // Determine what to set based on rule configuration
        const parentCat = rule.parent_category || rule.target_category;
        const subcat = rule.subcategory;
        const category = subcat || parentCat;

        const updateResult = await dbManager.query(`
          UPDATE transactions
          SET
            category = $2,
            parent_category = $3,
            subcategory = $4
          WHERE LOWER(name) LIKE LOWER($1)
          AND category != $2
          AND category IS NOT NULL
          AND parent_category != 'Bank'
          AND category != 'Income'
        `, [pattern, category, parentCat, subcat]);

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