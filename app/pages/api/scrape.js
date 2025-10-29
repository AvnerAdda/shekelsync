import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';
import crypto from 'crypto';
import { getDB } from './db';
import { BANK_VENDORS, SPECIAL_BANK_VENDORS, OTHER_BANK_VENDORS } from '../../utils/constants';
import {
  resolveCategory,
  matchCategorizationRule,
  findCategoryByName,
  getCategoryInfo
} from '../../lib/category-helpers.js';
import { BANK_CATEGORY_NAME } from '../../lib/category-constants.js';
import { autoCategorizeBankTransaction } from '../../lib/auto-categorize-bank.js';

let cachedBankCategory = null;

async function getBankCategoryDefinition(client) {
  if (cachedBankCategory) return cachedBankCategory;
  const bankCategory = await findCategoryByName(BANK_CATEGORY_NAME, null, client);
  if (!bankCategory) {
    throw new Error(`Bank category '${BANK_CATEGORY_NAME}' not found in category_definitions`);
  }
  cachedBankCategory = bankCategory;
  return bankCategory;
}

async function insertTransaction(txn, client, companyId, isBank, accountNumber) {
  const uniqueId = `${txn.identifier}-${companyId}-${txn.processedDate}-${txn.description}`;
  const hash = crypto.createHash('sha1');
  hash.update(uniqueId);
  txn.identifier = hash.digest('hex');

  // Use originalAmount if chargedAmount is not available (for MAX and other cards)
  let amount = txn.chargedAmount || txn.originalAmount || 0;

  // Log warning if amount calculation uses fallback
  if (!txn.chargedAmount && txn.originalAmount) {
    console.log(`Using originalAmount for ${companyId} transaction: ${txn.description}`);
  }

  let category = txn.category;
  let parentCategory = null;
  let subcategory = null;
  let categoryDefinitionId = null;

  if (!isBank) {
    const rawAmount = txn.chargedAmount || txn.originalAmount || 0;
    amount = rawAmount > 0 ? rawAmount * -1 : rawAmount;

    if (amount === 0) {
      console.warn(`Warning: Zero amount detected for ${companyId} transaction: ${txn.description}`, {
        chargedAmount: txn.chargedAmount,
        originalAmount: txn.originalAmount,
        finalAmount: amount,
        txn: txn
      });
    }

    const resolved = await resolveCategory({
      client,
      rawCategory: txn.category,
      transactionName: txn.description,
    });

    if (resolved) {
      categoryDefinitionId = resolved.categoryDefinitionId;
      parentCategory = resolved.parentCategory;
      subcategory = resolved.subcategory;
      category = subcategory || parentCategory || category;
    }
  } else {
    // Smart categorization for bank transactions based on name and price
    const autoCat = await autoCategorizeBankTransaction(txn.description, amount, client);
    categoryDefinitionId = autoCat.categoryDefinitionId;

    // Get full category info for labels
    const categoryInfo = await getCategoryInfo(categoryDefinitionId, client);
    if (categoryInfo) {
      category = categoryInfo.name;
      parentCategory = categoryInfo.parent_id ? categoryInfo.parent_name : categoryInfo.name;
      subcategory = categoryInfo.parent_id ? categoryInfo.name : null;
    }
  }

  // Determine category_type based on transaction characteristics
  let categoryType = 'expense'; // default
  if (isBank && categoryDefinitionId) {
    // For bank transactions, get the actual category_type from the assigned category
    const categoryInfo = await getCategoryInfo(categoryDefinitionId, client);
    categoryType = categoryInfo?.category_type || 'expense';
  } else if (!isBank) {
    categoryType = category === 'Income' ? 'income' : 'expense';
  }

  try {
    await client.query(
      `INSERT INTO transactions (
        identifier,
        vendor,
        date,
        name,
        price,
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
        account_number,
        category_type,
        transaction_datetime,
        processed_datetime
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      ON CONFLICT (identifier, vendor) DO NOTHING`,
      [
        txn.identifier,
        companyId,
        new Date(txn.date),
        txn.description,
        amount,
        categoryDefinitionId,
        txn.description,
        categoryDefinitionId ? true : false,
        categoryDefinitionId ? 0.8 : 0.0,
        txn.type,
        txn.processedDate,
        txn.originalAmount,
        txn.originalCurrency,
        txn.chargedCurrency,
        txn.memo,
        txn.status,
        accountNumber,
        categoryType,
        new Date(txn.date), // Full datetime for transaction
        txn.processedDate ? new Date(txn.processedDate) : new Date() // Full datetime for processed
      ]
    );
  } catch (error) {
    console.error("Error inserting transaction:", error);
    throw error;
  }
}

async function autoCategorizeTransaction(transactionName, client) {
  try {
    const match = await matchCategorizationRule(transactionName, client);
    if (!match) {
      return { success: false };
    }

    return {
      success: true,
      categoryDefinitionId: match.category_definition_id || null,
      parentCategory: match.parent_category || null,
      subcategory: match.subcategory || null,
      confidence: 0.8
    };
  } catch (error) {
    console.error('Error in auto-categorization:', error);
    return { success: false };
  }
}

async function applyCategorizationRules(client) {
  try {
    // Get all active categorization rules
    const rulesResult = await client.query(`
      SELECT
        cr.id,
        cr.name_pattern,
        cr.target_category,
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
      let resolvedSub = rule.resolved_subcategory || null;
      let resolvedParent =
        rule.resolved_parent_category ||
        (resolvedSub ? null : rule.target_category) ||
        null;

      if (!categoryId) {
        const resolved = await resolveCategory({
          client,
          rawCategory: resolvedSub || resolvedParent || rule.target_category,
          transactionName: rule.name_pattern,
        });

        if (resolved) {
          categoryId = resolved.categoryDefinitionId;
          resolvedParent = resolved.parentCategory || resolvedParent;
          resolvedSub = resolved.subcategory || resolvedSub;
        }
      }

      const categoryName = resolvedSub || resolvedParent || rule.target_category || rule.name_pattern;
      const confidence = categoryId ? 0.8 : 0.5;

      const updateResult = await client.query(`
        UPDATE transactions
        SET
          category_definition_id = COALESCE($2, category_definition_id),
          auto_categorized = true,
          confidence_score = MAX(confidence_score, $3)
        WHERE LOWER(name) LIKE LOWER($1)
          AND (
            category_definition_id IS NULL
            OR category_definition_id NOT IN (
              SELECT id FROM category_definitions
              WHERE name = $4 OR category_type = 'income'
            )
          )
      `, [pattern, categoryId, confidence, BANK_CATEGORY_NAME]);

      totalUpdated += updateResult.rowCount;
    }

    console.log(`Applied ${rules.length} rules to ${totalUpdated} transactions`);
    return { rulesApplied: rules.length, transactionsUpdated: totalUpdated };
  } catch (error) {
    console.error('Error applying categorization rules:', error);
    throw error;
  }
}

// NOTE: Duplicate detection is now handled via category_definition_id pointing to
// "Bank Settlements" category. Credit card payments are categorized during insertion.
// The old transaction_duplicates table has been removed in favor of this approach.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const client = await getDB();
  try {
    const { options, credentials } = req.body;

    console.log('Received scrape request:');
    console.log('  Company ID:', options.companyId);
    console.log('  Start Date:', options.startDate);
    console.log('  Credentials keys:', Object.keys(credentials));
    console.log('  Credentials (masked):', {
      ...credentials,
      password: credentials.password ? '***' : undefined,
      id: credentials.id ? credentials.id.substring(0, 3) + '***' : undefined
    });

    const companyId = CompanyTypes[options.companyId];
    if (!companyId) {
      throw new Error('Invalid company ID');
    }

    let isBank = false;
    if (BANK_VENDORS.includes(options.companyId) || 
        SPECIAL_BANK_VENDORS.includes(options.companyId) || 
        OTHER_BANK_VENDORS.includes(options.companyId)){
      isBank = true;
    }

    // Prepare credentials based on company type
    let scraperCredentials;

    if (options.companyId === 'visaCal' || options.companyId === 'max') {
      // Visa Cal and Max use username + password
      scraperCredentials = {
        username: credentials.username,
        password: credentials.password
      };
    } else if (options.companyId === 'discount' || options.companyId === 'mercantile') {
      // Discount and Mercantile require id, password, and num (identification code)
      scraperCredentials = {
        id: credentials.id,
        password: credentials.password,
        num: credentials.num || credentials.identification_code
      };
    } else if (options.companyId === 'hapoalim') {
      // Hapoalim uses userCode instead of username
      scraperCredentials = {
        userCode: credentials.userCode || credentials.username,
        password: credentials.password
      };
    } else if (options.companyId === 'yahav') {
      // Yahav uses username, password, and nationalID
      scraperCredentials = {
        username: credentials.username,
        password: credentials.password,
        nationalID: credentials.nationalID || credentials.id
      };
    } else if (options.companyId === 'beyahadBishvilha' || options.companyId === 'behatsdaa') {
      // BeyahadBishvilha and Behatsdaa use id + password
      scraperCredentials = {
        id: credentials.id,
        password: credentials.password
      };
    } else if (options.companyId === 'oneZero') {
      // OneZero uses email-based authentication with OTP
      scraperCredentials = {
        email: credentials.email,
        password: credentials.password,
        otpCodeRetriever: credentials.otpCode ? () => Promise.resolve(credentials.otpCode) : undefined,
        otpLongTermToken: credentials.otpToken || null
      };
    } else if (BANK_VENDORS.includes(options.companyId)) {
      // Other banks use username + password
      scraperCredentials = {
        username: credentials.username,
        password: credentials.password,
        bankAccountNumber: credentials.bankAccountNumber || undefined
      };
    } else if (options.companyId === 'amex') {
      // Amex uses id (as username), card6Digits, and password
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

    console.log('Prepared scraper credentials (masked):');
    console.log('  Keys:', Object.keys(scraperCredentials));
    console.log('  Values:', {
      ...scraperCredentials,
      password: scraperCredentials.password ? '***' : undefined,
      id: scraperCredentials.id ? scraperCredentials.id.substring(0, 3) + '***' : undefined,
      num: scraperCredentials.num ? scraperCredentials.num.substring(0, 3) + '***' : undefined
    });

    // Get Puppeteer's Chrome path dynamically
    let executablePath;
    try {
      const puppeteer = require('puppeteer');
      executablePath = puppeteer.executablePath();
    } catch (error) {
      console.warn('Could not find Puppeteer Chrome, using system browser');
      executablePath = undefined; // Let Puppeteer find its own browser
    }

    const scraper = createScraper({
      ...options,
      companyId,
      startDate: new Date(options.startDate),
      showBrowser: isBank,
      verbose: true, // Enable verbose logging
      timeout: 120000, // 2 minutes timeout
      executablePath: executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    // Insert audit row: started
    const triggeredBy = credentials?.username || credentials?.id || credentials?.nickname || 'unknown';
    const insertAudit = await client.query(
      `INSERT INTO scrape_events (triggered_by, vendor, start_date, status, message)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        triggeredBy,
        options.companyId,
        new Date(options.startDate),
        'started',
        'Scrape initiated'
      ]
    );
    const auditId = insertAudit.rows[0]?.id;

    let result;
    try {
      console.log('Starting scrape operation...');
      result = await scraper.scrape(scraperCredentials);
      console.log('Scrape operation completed');
    } catch (scrapeError) {
      console.error('Scrape operation threw an error:', scrapeError);
      throw scrapeError;
    }

    console.log('Scraping result:');
    console.log(JSON.stringify(result, null, 2));

    if (!result.success) {
      console.error('Scraping failed with details:');
      console.error('  Error Type:', result.errorType);
      console.error('  Error Message:', result.errorMessage);

      // Update audit as failed
      if (auditId) {
        await client.query(
          `UPDATE scrape_events SET status = $1, message = $2 WHERE id = $3`,
          ['failed', `${result.errorType}: ${result.errorMessage || 'No message'}`, auditId]
        );
      }

      // Return more detailed error to client
      return res.status(400).json({
        message: 'Scraping failed',
        errorType: result.errorType,
        errorMessage: result.errorMessage,
        error: result.errorMessage || result.errorType || 'Scraping failed'
      });
    }
    
    let bankTransactions = 0;
    for (const account of result.accounts) {
      // Store account balance if available (primarily for bank accounts)
      if (account.balance !== undefined && account.balance !== null) {
        try {
          await client.query(`
            UPDATE vendor_credentials
            SET current_balance = $1,
                balance_updated_at = CURRENT_TIMESTAMP,
                last_scrape_success = CURRENT_TIMESTAMP,
                last_scrape_status = 'success'
            WHERE vendor = $2 AND (
              bank_account_number = $3 OR
              card6_digits = $3
            )`,
            [account.balance, options.companyId, account.accountNumber]
          );
          console.log(`Updated balance for ${options.companyId} account ${account.accountNumber}: ${account.balance}`);
        } catch (balanceError) {
          console.error(`Failed to update balance for account ${account.accountNumber}:`, balanceError);
        }
      }

      for (const txn of account.txns) {
        if (isBank){
          bankTransactions++;
        }
        await insertTransaction(txn, client, options.companyId, isBank, account.accountNumber);
      }
    }

    // Update last scrape attempt for this vendor (regardless of balance availability)
    try {
      await client.query(`
        UPDATE vendor_credentials
        SET last_scrape_attempt = CURRENT_TIMESTAMP,
            last_scrape_success = CURRENT_TIMESTAMP,
            last_scrape_status = 'success'
        WHERE vendor = $1`,
        [options.companyId]
      );
    } catch (updateError) {
      console.error(`Failed to update scrape timestamps for vendor ${options.companyId}:`, updateError);
    }

    await applyCategorizationRules(client);

    console.log(`Scraped ${bankTransactions} bank transactions`);

    // Update audit as success
    if (auditId) {
      const accountsCount = Array.isArray(result.accounts) ? result.accounts.length : 0;
      const message = `Success: accounts=${accountsCount}, bankTxns=${bankTransactions}`;
      await client.query(
        `UPDATE scrape_events SET status = $1, message = $2 WHERE id = $3`,
        ['success', message, auditId]
      );
    }

    res.status(200).json({
      message: 'Scraping and database update completed successfully',
      accounts: result.accounts
    });
  } catch (error) {
    console.error('Scraping failed:', error);

    // Update vendor credentials to track failed scrape
    try {
      const { options } = req.body;
      if (options && options.companyId) {
        await client.query(`
          UPDATE vendor_credentials
          SET last_scrape_attempt = CURRENT_TIMESTAMP,
              last_scrape_status = 'failed'
          WHERE vendor = $1`,
          [options.companyId]
        );
      }
    } catch (updateError) {
      console.error('Failed to update scrape failure status:', updateError);
    }

    // Attempt to log failure if an audit row exists in scope
    try {
      if (typeof auditId !== 'undefined' && auditId) {
        await client.query(
          `UPDATE scrape_events SET status = $1, message = $2 WHERE id = $3`,
          ['failed', error instanceof Error ? error.message : 'Unknown error', auditId]
        );
      }
    } catch (e) {
      // noop - avoid masking original error
    }
    res.status(500).json({
      message: 'Scraping failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
} 
