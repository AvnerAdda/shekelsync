const { CompanyTypes, createScraper } = require('israeli-bank-scrapers');
const crypto = require('crypto');
const database = require('../database.js');
const {
  BANK_VENDORS,
  SPECIAL_BANK_VENDORS,
  OTHER_BANK_VENDORS,
} = require('../../../utils/constants.js');
const {
  resolveCategory,
  findCategoryByName,
  getCategoryInfo,
} = require('../../../lib/category-helpers.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');

const DEFAULT_TIMEOUT = 120000;
const DEFAULT_LOOKBACK_MONTHS = 3;
let cachedBankCategory = null;

function createHttpError(statusCode, message, extra = {}) {
  const error = new Error(message || 'Scraping failed');
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function isBankVendor(companyId) {
  return (
    BANK_VENDORS.includes(companyId) ||
    SPECIAL_BANK_VENDORS.includes(companyId) ||
    OTHER_BANK_VENDORS.includes(companyId)
  );
}

function resolveTriggeredBy(credentials) {
  return (
    credentials?.username ||
    credentials?.id ||
    credentials?.nickname ||
    credentials?.email ||
    'unknown'
  );
}

async function getPuppeteerExecutable(logger = console) {
  try {
    const puppeteer = require('puppeteer');
    return puppeteer.executablePath();
  } catch (error) {
    logger?.warn?.('Could not resolve Puppeteer Chrome executable, falling back to default');
    return undefined;
  }
}

function resolveStartDate(input) {
  if (input?.startDate) {
    const date = new Date(input.startDate);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  const fallback = new Date();
  fallback.setMonth(fallback.getMonth() - DEFAULT_LOOKBACK_MONTHS);
  return fallback;
}

function buildScraperOptions(options, isBank, executablePath, startDate) {
  return {
    ...options,
    companyId: CompanyTypes[options.companyId],
    startDate,
    showBrowser: Boolean(isBank),
    verbose: true,
    timeout: DEFAULT_TIMEOUT,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  };
}

function prepareScraperCredentials(companyId, options, credentials) {
  if (companyId === CompanyTypes.visaCal || companyId === CompanyTypes.max) {
    return {
      username: credentials.username,
      password: credentials.password,
    };
  }

  if (companyId === CompanyTypes.discount || companyId === CompanyTypes.mercantile) {
    return {
      id: credentials.id,
      password: credentials.password,
      num: credentials.num || credentials.identification_code,
    };
  }

  if (companyId === CompanyTypes.hapoalim) {
    return {
      userCode: credentials.userCode || credentials.username,
      password: credentials.password,
    };
  }

  if (companyId === CompanyTypes.yahav) {
    return {
      username: credentials.username,
      password: credentials.password,
      nationalID: credentials.nationalID || credentials.id,
    };
  }

  if (companyId === CompanyTypes.beyahadBishvilha || companyId === CompanyTypes.behatsdaa) {
    return {
      id: credentials.id,
      password: credentials.password,
    };
  }

  if (companyId === CompanyTypes.oneZero) {
    return {
      email: credentials.email,
      password: credentials.password,
      otpCodeRetriever: credentials.otpCode ? () => Promise.resolve(credentials.otpCode) : undefined,
      otpLongTermToken: credentials.otpToken || null,
    };
  }

  if (companyId === CompanyTypes.amex) {
    return {
      username: credentials.id,
      card6Digits: credentials.card6Digits,
      password: credentials.password,
    };
  }

  if (isBankVendor(options.companyId)) {
    return {
      username: credentials.username,
      password: credentials.password,
      bankAccountNumber: credentials.bankAccountNumber || undefined,
    };
  }

  return {
    id: credentials.id,
    card6Digits: credentials.card6Digits,
    password: credentials.password,
  };
}

async function insertScrapeEvent(client, { triggeredBy, vendor, startDate }) {
  const result = await client.query(
    `INSERT INTO scrape_events (triggered_by, vendor, start_date, status, message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [triggeredBy, vendor, startDate, 'started', 'Scrape initiated'],
  );
  return result.rows[0]?.id || null;
}

async function updateScrapeEventStatus(client, auditId, status, message) {
  if (!auditId) return;
  await client.query(
    `UPDATE scrape_events SET status = $1, message = $2 WHERE id = $3`,
    [status, message, auditId],
  );
}

async function markVendorScrapeStatus(client, vendor, status) {
  const values = [status, vendor];
  const queries = {
    success: `UPDATE vendor_credentials
                SET last_scrape_attempt = CURRENT_TIMESTAMP,
                    last_scrape_success = CURRENT_TIMESTAMP,
                    last_scrape_status = 'success'
              WHERE vendor = $2`,
    failed: `UPDATE vendor_credentials
                SET last_scrape_attempt = CURRENT_TIMESTAMP,
                    last_scrape_status = 'failed'
              WHERE vendor = $2`,
  };

  const sql = status === 'success' ? queries.success : queries.failed;
  await client.query(sql, values);
}

async function insertTransaction(txn, client, companyId, isBank, accountNumber, vendorNickname) {
  const uniqueId = `${txn.identifier}-${companyId}-${txn.processedDate}-${txn.description}`;
  const hash = crypto.createHash('sha1');
  hash.update(uniqueId);
  const identifier = hash.digest('hex');

  if (isBank) {
    const bankCategory = await getBankCategoryDefinition(client);
    await client.query(
      `INSERT INTO transactions (
        identifier,
        vendor,
        vendor_nickname,
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      ON CONFLICT (identifier, vendor) DO NOTHING`,
      [
        identifier,
        companyId,
        vendorNickname || null,
        new Date(txn.date),
        txn.description,
        txn.chargedAmount || txn.originalAmount || 0,
        bankCategory.category_definition_id || bankCategory.id,
        txn.description,
        true,
        0.8,
        txn.type,
        txn.processedDate,
        txn.originalAmount,
        txn.originalCurrency,
        txn.chargedCurrency,
        txn.memo,
        txn.status,
        accountNumber,
        bankCategory.category_type || 'expense',
        new Date(txn.date),
        txn.processedDate ? new Date(txn.processedDate) : new Date(),
      ],
    );
    return;
  }

  const rawAmount = txn.chargedAmount || txn.originalAmount || 0;
  const amount = rawAmount > 0 ? rawAmount * -1 : rawAmount;

  let categoryDefinitionId = null;
  let parentCategory = null;
  let subcategory = null;
  let category = txn.category;

  const categorisation = await resolveCategory({
    client,
    rawCategory: txn.category,
    transactionName: txn.description,
  });

  if (categorisation) {
    categoryDefinitionId = categorisation.categoryDefinitionId;
    parentCategory = categorisation.parentCategory;
    subcategory = categorisation.subcategory;
    category = subcategory || parentCategory || category;
  } else if (amount < 0) {
    categoryDefinitionId = 1;
    const expenseCategory = await getCategoryInfo(1, client);
    if (expenseCategory) {
      category = expenseCategory.name;
      parentCategory = expenseCategory.name;
      subcategory = null;
    }
  }

  const categoryInfo = categoryDefinitionId ? await getCategoryInfo(categoryDefinitionId, client) : null;
  const categoryType = categoryInfo?.category_type || (category === 'Income' ? 'income' : 'expense');

  await client.query(
    `INSERT INTO transactions (
      identifier,
      vendor,
      vendor_nickname,
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
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    ON CONFLICT (identifier, vendor) DO NOTHING`,
    [
      identifier,
      companyId,
      vendorNickname || null,
      new Date(txn.date),
      txn.description,
      amount,
      categoryDefinitionId,
      txn.description,
      Boolean(categoryDefinitionId),
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
      new Date(txn.date),
      txn.processedDate ? new Date(txn.processedDate) : new Date(),
    ],
  );
}

async function getBankCategoryDefinition(client) {
  if (cachedBankCategory) return cachedBankCategory;
  const bankCategory = await findCategoryByName(BANK_CATEGORY_NAME, null, client);
  if (!bankCategory) {
    throw new Error(`Bank category '${BANK_CATEGORY_NAME}' not found in category_definitions`);
  }
  cachedBankCategory = bankCategory;
  return bankCategory;
}

async function applyCategorizationRules(client) {
  const rulesResult = await client.query(
    `SELECT
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
      ORDER BY cr.priority DESC, cr.id`,
  );

  const rules = rulesResult.rows;
  let totalUpdated = 0;

  for (const rule of rules) {
    const pattern = `%${rule.name_pattern}%`;
    let categoryId = rule.category_definition_id;
    let resolvedSub = rule.resolved_subcategory || null;
    let resolvedParent =
      rule.resolved_parent_category || (resolvedSub ? null : rule.target_category) || null;

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

    const confidence = categoryId ? 0.8 : 0.5;

    const updateResult = await client.query(
      `UPDATE transactions
         SET category_definition_id = COALESCE($2, category_definition_id),
             auto_categorized = true,
             confidence_score = CASE
               WHEN confidence_score IS NULL OR confidence_score < $3 THEN $3
               ELSE confidence_score
             END
       WHERE LOWER(name) LIKE LOWER($1)
         AND (
           category_definition_id IS NULL
           OR category_definition_id NOT IN (
             SELECT id FROM category_definitions
             WHERE name = $4 OR category_type = 'income'
           )
           OR category_definition_id IN (
             SELECT id FROM category_definitions
             WHERE depth_level < 2
           )
         )`,
      [pattern, categoryId, confidence, BANK_CATEGORY_NAME],
    );

    totalUpdated += updateResult.rowCount;
  }

  return { rulesApplied: rules.length, transactionsUpdated: totalUpdated };
}

async function applyAccountPairings(client) {
  const pairingsResult = await client.query(
    `SELECT
        id,
        credit_card_vendor,
        credit_card_account_number,
        bank_vendor,
        bank_account_number,
        match_patterns
      FROM account_pairings
      WHERE is_active = true`,
  );

  const pairings = pairingsResult.rows;
  if (pairings.length === 0) {
    return { pairingsApplied: 0, transactionsUpdated: 0 };
  }

  let totalUpdated = 0;

  for (const pairing of pairings) {
    const bankVendor = pairing.bank_vendor;
    const bankAccountNumber = pairing.bank_account_number;
    const matchPatterns = pairing.match_patterns ? JSON.parse(pairing.match_patterns) : [];

    if (matchPatterns.length === 0) {
      continue;
    }

    const params = [bankVendor];
    const conditions = matchPatterns.map((pattern, idx) => {
      params.push(pattern.toLowerCase());
      return `LOWER(name) LIKE '%' || $${idx + 2} || '%'`;
    });

    let query = `
      UPDATE transactions
         SET category_definition_id = CASE
             WHEN price < 0 THEN 25
             WHEN price > 0 THEN 75
             ELSE category_definition_id
           END
       WHERE vendor = $1
         AND (${conditions.join(' OR ')})
    `;

    if (bankAccountNumber) {
      params.push(bankAccountNumber);
      query += ` AND account_number = $${params.length}`;
    }

    const updateResult = await client.query(query, params);
    totalUpdated += updateResult.rowCount;

    if (updateResult.rowCount > 0) {
      await client.query(
        `INSERT INTO account_pairing_log (pairing_id, action, transaction_count)
         VALUES ($1, $2, $3)`,
        [pairing.id, 'applied', updateResult.rowCount],
      );
    }
  }

  return { pairingsApplied: pairings.length, transactionsUpdated: totalUpdated };
}

async function updateVendorAccountNumbers(client, options, credentials, discoveredAccountNumbers, isBank) {
  if (discoveredAccountNumbers.size === 0) {
    return;
  }

  const accountNumbersStr = Array.from(discoveredAccountNumbers).join(';');
  const fieldName = isBank ? 'bank_account_number' : 'card6_digits';

  // Fix: Match by credential ID (primary key) instead of encrypted username/id_number
  // credentials.id is the database row ID which uniquely identifies the credential
  await client.query(
    `UPDATE vendor_credentials
        SET ${fieldName} = $1,
            updated_at = CURRENT_TIMESTAMP
      WHERE vendor = $2
        AND id = $3`,
    [accountNumbersStr, options.companyId, credentials.id],
  );
}

async function updateVendorBalance(client, options, credentials, account, logger = console) {
  if (account.balance === undefined || account.balance === null) {
    logger?.debug?.(`No balance found for account ${account.accountNumber || 'unknown'}`);
    return;
  }

  logger?.info?.(`Captured balance for ${options.companyId}: ₪${account.balance} (account: ${account.accountNumber || 'N/A'})`);

  // Match by credential ID (primary key) for reliability
  // If account number exists, also match it for multi-account support
  const result = await client.query(
    `UPDATE vendor_credentials
        SET current_balance = $1,
            balance_updated_at = CURRENT_TIMESTAMP,
            last_scrape_success = CURRENT_TIMESTAMP,
            last_scrape_status = 'success'
      WHERE vendor = $2
        AND id = $3
        AND (
          $4 IS NULL OR
          bank_account_number = $4 OR
          card6_digits = $4
        )`,
    [account.balance, options.companyId, credentials.id, account.accountNumber || null],
  );

  if (result.rowCount > 0) {
    logger?.info?.(`✓ Balance updated successfully for credential ID ${credentials.id}`);
  } else {
    logger?.warn?.(`✗ Balance update failed - no matching credential found (vendor: ${options.companyId}, credID: ${credentials.id}, account: ${account.accountNumber || 'N/A'})`);
  }
}

async function processScrapeResult(client, { options, credentials, result, isBank, logger = console }) {
  let bankTransactions = 0;
  const discoveredAccountNumbers = new Set();

  for (const account of result.accounts || []) {
    if (account.accountNumber) {
      discoveredAccountNumbers.add(account.accountNumber);
    }

    try {
      await updateVendorBalance(client, options, credentials, account, logger);
    } catch (balanceError) {
      logger?.error?.(`Failed to update balance for ${account.accountNumber}:`, balanceError);
    }

    for (const txn of account.txns || []) {
      if (isBank) {
        bankTransactions += 1;
      }
      await insertTransaction(txn, client, options.companyId, isBank, account.accountNumber, credentials.nickname);
    }
  }

  await updateVendorAccountNumbers(client, options, credentials, discoveredAccountNumbers, isBank);

  return { bankTransactions };
}

async function runScrape({ options, credentials, execute, logger = console }) {
  if (!options?.companyId) {
    throw createHttpError(400, 'Missing companyId');
  }

  const companyType = CompanyTypes[options.companyId];
  if (!companyType) {
    throw createHttpError(400, 'Invalid company ID');
  }

  const isBank = isBankVendor(options.companyId);
  const resolvedStartDate = resolveStartDate(options);
  const client = await database.getClient();
  let auditId = null;

  try {
    await client.query('BEGIN');

    const triggeredBy = resolveTriggeredBy(credentials);
    auditId = await insertScrapeEvent(client, {
      triggeredBy,
      vendor: options.companyId,
      startDate: resolvedStartDate,
    });

    const executablePath = await getPuppeteerExecutable(logger);
    const scraperOptions = buildScraperOptions(options, isBank, executablePath, resolvedStartDate);
    const scraperCredentials = prepareScraperCredentials(companyType, options, credentials);

    const scraperExecutor = execute
      ? () => execute({ scraperOptions, scraperCredentials })
      : async () => {
          const scraper = createScraper(scraperOptions);
          return scraper.scrape(scraperCredentials);
        };

    const result = await scraperExecutor();

    if (!result?.success) {
      const message = `${result?.errorType || 'ScrapeError'}: ${result?.errorMessage || 'Unknown error'}`;
      await updateScrapeEventStatus(client, auditId, 'failed', message);
      await markVendorScrapeStatus(client, options.companyId, 'failed');
      throw createHttpError(400, message, { errorType: result?.errorType });
    }

    const summary = await processScrapeResult(client, {
      options,
      credentials,
      result,
      isBank,
      logger,
    });

    await applyCategorizationRules(client);
    await applyAccountPairings(client);
    await markVendorScrapeStatus(client, options.companyId, 'success');

    const accountsCount = Array.isArray(result.accounts) ? result.accounts.length : 0;
    const message = `Success: accounts=${accountsCount}, bankTxns=${summary.bankTransactions}`;
    await updateScrapeEventStatus(client, auditId, 'success', message);

    await client.query('COMMIT');

    return {
      success: true,
      message: 'Scraping and database update completed successfully',
      accounts: result.accounts,
      bankTransactions: summary.bankTransactions,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (auditId) {
      await updateScrapeEventStatus(
        client,
        auditId,
        'failed',
        error?.message || 'Unknown error',
      );
    }
    await markVendorScrapeStatus(client, options.companyId, 'failed');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  runScrape,
};

module.exports.default = module.exports;
