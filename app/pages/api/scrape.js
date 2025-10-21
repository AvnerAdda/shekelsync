import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';
import crypto from 'crypto';
import { getDB } from './db';
import { BANK_VENDORS, SPECIAL_BANK_VENDORS } from '../../utils/constants';

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

  if (!isBank){
    // Ensure amount is negative for credit card transactions (expenses)
    // Handle cases where originalAmount might already be negative
    const rawAmount = txn.chargedAmount || txn.originalAmount || 0;
    amount = rawAmount > 0 ? rawAmount * -1 : rawAmount;

    // Validate amount is not zero for credit card transactions
    if (amount === 0) {
      console.warn(`Warning: Zero amount detected for ${companyId} transaction: ${txn.description}`, {
        chargedAmount: txn.chargedAmount,
        originalAmount: txn.originalAmount,
        finalAmount: amount,
        txn: txn
      });
    }

    // First, try to map Hebrew category from scraper using category_mapping table
    if (txn.category) {
      const mappingResult = await client.query(
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
      const categorization = await autoCategorizeTransaction(txn.description, client);
      if (categorization.success) {
        parentCategory = categorization.parent_category;
        subcategory = categorization.subcategory;
        category = subcategory || parentCategory;
      }
    }

    // If we still don't have a parent category, but we have a category, try to find parent from category_definitions
    if (!parentCategory && category && category !== 'N/A') {
      const parentLookup = await client.query(
        `SELECT parent_cd.name as parent_name
         FROM category_definitions cd
         JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id
         WHERE cd.name = $1`,
        [category]
      );

      if (parentLookup.rows.length > 0) {
        parentCategory = parentLookup.rows[0].parent_name;
        console.log(`Found parent category for ${category}: ${parentCategory}`);
      }
    }
  }else{
    category = "Bank";
    parentCategory = "Bank";
  }

  try {
    await client.query(
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
        account_number,
        transaction_datetime,
        processed_datetime
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
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
        accountNumber,
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
    const cleanName = transactionName.toLowerCase().trim();

    // Query categorization rules for matching patterns (unified with former merchant_catalog)
    const rulesResult = await client.query(
      `SELECT
        name_pattern,
        parent_category,
        subcategory,
        priority
       FROM categorization_rules
       WHERE is_active = true
       AND LOWER($1) LIKE '%' || LOWER(name_pattern) || '%'
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
        confidence: 0.8 // Default confidence for rule-based categorization
      };
    }

    return { success: false };
  } catch (error) {
    console.error('Error in auto-categorization:', error);
    return { success: false };
  }
}

async function applyCategorizationRules(client) {
  try {
    // Get all active categorization rules
    const rulesResult = await client.query(`
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

      const updateResult = await client.query(`
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

async function autoMarkCreditCardPaymentDuplicates(client) {
  try {
    // Auto-mark credit card payment transactions as duplicates
    const duplicateResult = await client.query(`
      INSERT INTO transaction_duplicates (
        transaction1_identifier,
        transaction1_vendor,
        transaction2_identifier,
        transaction2_vendor,
        match_type,
        confidence,
        exclude_from_totals,
        is_confirmed,
        created_at,
        notes
      )
      SELECT
        t.identifier,
        t.vendor,
        t.identifier,
        t.vendor,
        'credit_card_payment',
        1.0,
        true,
        true,
        CURRENT_TIMESTAMP,
        'Auto-detected credit card payment transaction - exclude from totals to avoid double counting'
      FROM transactions t
      WHERE (t.name LIKE '%חיוב לכרטיס ויזה%' OR t.name LIKE '%חיוב לכרטיס ממקס%')
        AND t.category = 'Bank'
        AND t.price < 0
        AND NOT EXISTS (
          SELECT 1 FROM transaction_duplicates td
          WHERE td.transaction1_identifier = t.identifier
          AND td.transaction1_vendor = t.vendor
        )
      ON CONFLICT DO NOTHING
    `);

    const markedCount = duplicateResult.rowCount;
    if (markedCount > 0) {
      console.log(`Auto-marked ${markedCount} credit card payment transactions as duplicates`);
    }

    return { duplicatesMarked: markedCount };
  } catch (error) {
    console.error('Error auto-marking credit card payment duplicates:', error);
    // Don't throw - this is a non-critical operation
    return { duplicatesMarked: 0, error: error.message };
  }
}

async function linkTransactionsToCategoryDefinitions(client) {
  try {
    // Link transactions to category_definitions by matching category names
    const linkResult = await client.query(`
      UPDATE transactions
      SET category_definition_id = cd.id
      FROM category_definitions cd
      WHERE transactions.category_definition_id IS NULL
        AND transactions.category = cd.name
        AND transactions.category != 'Bank'
        AND cd.is_active = true
    `);

    const linkedCount = linkResult.rowCount;
    if (linkedCount > 0) {
      console.log(`Linked ${linkedCount} transactions to category definitions`);
    }

    return { transactionsLinked: linkedCount };
  } catch (error) {
    console.error('Error linking transactions to category definitions:', error);
    // Don't throw - this is a non-critical operation
    return { transactionsLinked: 0, error: error.message };
  }
}

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
    if (BANK_VENDORS.includes(options.companyId) || SPECIAL_BANK_VENDORS.includes(options.companyId)){
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
        userCode: credentials.username,
        password: credentials.password
      };
    } else if (options.companyId === 'yahav') {
      // Yahav uses username, password, and nationalID
      scraperCredentials = {
        username: credentials.username,
        password: credentials.password,
        nationalID: credentials.nationalID || credentials.id
      };
    } else if (BANK_VENDORS.includes(options.companyId)) {
      // Other banks use username + password
      scraperCredentials = {
        username: credentials.username,
        password: credentials.password,
        bankAccountNumber: credentials.bankAccountNumber || undefined
      };
    } else if (options.companyId === 'amex') {
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

    // Auto-detect and mark credit card payment duplicates
    if (isBank) {
      await autoMarkCreditCardPaymentDuplicates(client);
    }

    // Link transactions to category_definitions
    await linkTransactionsToCategoryDefinitions(client);

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
