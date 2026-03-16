/**
 * Interactive Brokers Flex Query Sync Service
 *
 * Fetches portfolio data from IBKR's Flex Web Service API and upserts
 * investment accounts + holdings into the local database.
 *
 * Flex Web Service flow:
 *   1. POST SendRequest with token + queryId → get ReferenceCode
 *   2. Poll GetStatement with referenceCode + token → get XML statement
 *   3. Parse positions, cash balances, and NAV from the XML
 *   4. Upsert into investment_accounts + investment_holdings
 */

const { DOMParser } = require('@xmldom/xmldom');

let database = require('../database.js');
const { mapVendorCodeToInstitutionId } = require('../institutions.js');

const IBKR_BASE_URL = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService';
const VENDOR_CODE = 'interactive_brokers';

// Flex statement fetch retry settings
const STATEMENT_POLL_INTERVAL_MS = 3_000;
const STATEMENT_MAX_RETRIES = 20;

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Step 1: Request a Flex statement by submitting token + queryId.
 * Returns a referenceCode used to fetch the actual statement.
 */
async function requestFlexStatement(token, queryId) {
  const url = `${IBKR_BASE_URL}.SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`;

  const response = await fetch(url);
  if (!response.ok) {
    throw serviceError(502, `IBKR SendRequest failed: HTTP ${response.status}`);
  }

  const xml = await response.text();
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  const status = getElementText(doc, 'Status');
  if (status !== 'Success') {
    const errorMsg = getElementText(doc, 'ErrorMessage') || 'Unknown error';
    throw serviceError(502, `IBKR SendRequest error: ${errorMsg}`);
  }

  const referenceCode = getElementText(doc, 'ReferenceCode');
  if (!referenceCode) {
    throw serviceError(502, 'IBKR SendRequest returned no ReferenceCode');
  }

  return referenceCode;
}

/**
 * Step 2: Poll for the Flex statement using the referenceCode.
 * IBKR may return a "not ready" status — retry with backoff.
 */
async function fetchFlexStatement(token, referenceCode) {
  const url = `${IBKR_BASE_URL}.GetStatement?q=${encodeURIComponent(referenceCode)}&t=${encodeURIComponent(token)}&v=3`;

  for (let attempt = 0; attempt < STATEMENT_MAX_RETRIES; attempt++) {
    const response = await fetch(url);
    if (!response.ok) {
      throw serviceError(502, `IBKR GetStatement failed: HTTP ${response.status}`);
    }

    const xml = await response.text();

    // Check if the response is a "still generating" wrapper
    if (xml.includes('<FlexStatementResponse>')) {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const status = getElementText(doc, 'Status');

      if (status === 'Warn') {
        // Statement not ready yet — wait and retry
        await sleep(STATEMENT_POLL_INTERVAL_MS);
        continue;
      }

      if (status !== 'Success' && status !== null) {
        const errorMsg = getElementText(doc, 'ErrorMessage') || 'Unknown error';
        throw serviceError(502, `IBKR GetStatement error: ${errorMsg}`);
      }
    }

    // We have the actual statement XML
    return xml;
  }

  throw serviceError(504, 'IBKR statement generation timed out after retries');
}

/**
 * Parse the Flex Query XML and extract positions and account info.
 */
function parseFlexStatement(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  const accountInfo = parseAccountInfo(doc);
  const positions = parseOpenPositions(doc);
  const cashBalances = parseCashBalances(doc);
  const nav = parseNAV(doc);

  return { accountInfo, positions, cashBalances, nav };
}

function parseAccountInfo(doc) {
  const el = doc.getElementsByTagName('AccountInformation')[0];
  if (!el) return {};
  return {
    accountId: attr(el, 'accountId'),
    currency: attr(el, 'currency') || 'USD',
    name: attr(el, 'name') || attr(el, 'accountId'),
  };
}

function parseOpenPositions(doc) {
  const positions = [];
  const nodes = doc.getElementsByTagName('OpenPosition');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    positions.push({
      symbol: attr(el, 'symbol'),
      description: attr(el, 'description'),
      assetCategory: attr(el, 'assetCategory'),
      currency: attr(el, 'currency'),
      quantity: parseFloat(attr(el, 'position') || '0'),
      costBasis: parseFloat(attr(el, 'costBasisMoney') || '0'),
      marketValue: parseFloat(attr(el, 'positionValue') || attr(el, 'markPrice') || '0'),
      markPrice: parseFloat(attr(el, 'markPrice') || '0'),
    });
  }
  return positions;
}

function parseCashBalances(doc) {
  const balances = [];
  const nodes = doc.getElementsByTagName('CashReportCurrency');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    balances.push({
      currency: attr(el, 'currency'),
      endingCash: parseFloat(attr(el, 'endingCash') || '0'),
    });
  }
  return balances;
}

function parseNAV(doc) {
  // Try EquitySummaryInBase first, then fallback
  const summaryNodes = doc.getElementsByTagName('EquitySummaryByReportDateInBase');
  if (summaryNodes.length > 0) {
    const el = summaryNodes[summaryNodes.length - 1]; // latest
    return {
      totalValue: parseFloat(attr(el, 'total') || '0'),
      cash: parseFloat(attr(el, 'cash') || '0'),
      stock: parseFloat(attr(el, 'stock') || '0'),
    };
  }
  return null;
}

/**
 * Main sync: Fetch data from IBKR and upsert accounts + holdings.
 */
async function syncFromIBKR({ token, queryId, credentialId, logger = console }) {
  if (!token || !queryId) {
    throw serviceError(400, 'IBKR token and queryId are required');
  }

  logger.info('[ibkr-sync] Requesting Flex statement...');
  const referenceCode = await requestFlexStatement(token, queryId);

  logger.info(`[ibkr-sync] Fetching statement (ref: ${referenceCode})...`);
  const xml = await fetchFlexStatement(token, referenceCode);

  logger.info('[ibkr-sync] Parsing statement...');
  const { accountInfo, positions, cashBalances, nav } = parseFlexStatement(xml);

  logger.info(
    `[ibkr-sync] Found ${positions.length} positions, ${cashBalances.length} cash balances`,
  );

  // Resolve institution_id for interactive_brokers
  const institutionId = await mapVendorCodeToInstitutionId(database, VENDOR_CODE);

  // Calculate total portfolio value
  const positionValue = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
  const cashValue = cashBalances.reduce((sum, c) => sum + (c.endingCash || 0), 0);
  const totalValue = nav?.totalValue || (positionValue + cashValue);
  const totalCostBasis = positions.reduce((sum, p) => sum + (p.costBasis || 0), 0);

  const today = new Date().toISOString().split('T')[0];
  const accountName = accountInfo.name || `IBKR ${accountInfo.accountId || 'Account'}`;
  const accountNumber = accountInfo.accountId || null;
  const currency = accountInfo.currency || 'USD';

  // Find the user's existing IBKR investment account (created via Accounts Management)
  const account = await findIBKRAccount({ institutionId, accountNumber });
  if (!account) {
    throw serviceError(
      400,
      'No Interactive Brokers account found. Please create one first in Investments > Add Account.',
    );
  }

  // Upsert a single aggregate holding snapshot for the whole account
  await upsertIBKRHolding({
    accountId: account.id,
    currentValue: totalValue,
    costBasis: totalCostBasis,
    asOfDate: today,
    notes: buildHoldingNotes(positions, cashBalances),
  });

  // Update credential last sync timestamp
  if (credentialId) {
    await database.query(
      `UPDATE vendor_credentials
         SET last_scrape_success = CURRENT_TIMESTAMP,
             last_scrape_attempt = CURRENT_TIMESTAMP,
             last_scrape_status = 'success',
             current_balance = $1,
             balance_updated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [totalValue, credentialId],
    );
  }

  logger.info(`[ibkr-sync] Sync complete. Total value: ${totalValue.toFixed(2)} ${currency}`);

  return {
    success: true,
    account: {
      id: account.id,
      name: accountName,
      accountNumber,
      currency,
    },
    summary: {
      positionCount: positions.length,
      positionValue,
      cashValue,
      totalValue,
      totalCostBasis,
      positions: positions.map((p) => ({
        symbol: p.symbol,
        quantity: p.quantity,
        marketValue: p.marketValue,
        costBasis: p.costBasis,
      })),
      cashBalances,
    },
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Find the user's existing IBKR investment account (created via Accounts Management).
 * Matches by institution_id, optionally narrowing by account_number.
 */
async function findIBKRAccount({ institutionId, accountNumber }) {
  // Try exact match by account_number first
  if (accountNumber) {
    const byNumber = await database.query(
      `SELECT id, account_name, currency FROM investment_accounts
       WHERE account_number = $1 AND institution_id = $2 AND is_active = true
       LIMIT 1`,
      [accountNumber, institutionId],
    );
    if (byNumber.rows.length > 0) {
      return byNumber.rows[0];
    }
  }

  // Fallback: any active IBKR account
  const byInstitution = await database.query(
    `SELECT id, account_name, currency FROM investment_accounts
     WHERE institution_id = $1 AND is_active = true
     ORDER BY created_at ASC
     LIMIT 1`,
    [institutionId],
  );

  return byInstitution.rows[0] || null;
}

/**
 * Upsert a single aggregate holding for the IBKR account.
 */
async function upsertIBKRHolding({ accountId, currentValue, costBasis, asOfDate, notes }) {
  await database.query(
    `INSERT INTO investment_holdings (
       account_id, current_value, cost_basis, as_of_date, notes
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (account_id, as_of_date) WHERE holding_type = 'standard'
     DO UPDATE SET
       current_value = EXCLUDED.current_value,
       cost_basis = EXCLUDED.cost_basis,
       notes = EXCLUDED.notes,
       updated_at = CURRENT_TIMESTAMP`,
    [accountId, currentValue, costBasis || null, asOfDate, notes || null],
  );
}

/**
 * Build a notes string summarizing positions and cash for the holding record.
 */
function buildHoldingNotes(positions, cashBalances) {
  const parts = [];

  if (positions.length > 0) {
    const topPositions = positions
      .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue))
      .slice(0, 10)
      .map((p) => `${p.symbol}: ${p.marketValue.toFixed(0)}`)
      .join(', ');
    parts.push(`Positions: ${topPositions}`);
  }

  if (cashBalances.length > 0) {
    const cashSummary = cashBalances
      .filter((c) => Math.abs(c.endingCash) > 0.01)
      .map((c) => `${c.currency}: ${c.endingCash.toFixed(0)}`)
      .join(', ');
    if (cashSummary) {
      parts.push(`Cash: ${cashSummary}`);
    }
  }

  return parts.join(' | ') || null;
}

/**
 * Check if IBKR credentials are configured.
 */
async function getIBKRStatus() {
  const institutionId = await mapVendorCodeToInstitutionId(database, VENDOR_CODE);

  const credentials = await database.query(
    `SELECT id, last_scrape_success, last_scrape_status, current_balance, balance_updated_at
     FROM vendor_credentials
     WHERE institution_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [institutionId],
  );

  const accounts = await database.query(
    `SELECT id, account_name, account_number, currency
     FROM investment_accounts
     WHERE institution_id = $1 AND is_active = true`,
    [institutionId],
  );

  const isConfigured = credentials.rows.length > 0;
  const credential = isConfigured ? credentials.rows[0] : null;

  return {
    isConfigured,
    credentialId: credential?.id || null,
    lastSync: credential?.last_scrape_success || null,
    lastStatus: credential?.last_scrape_status || null,
    currentBalance: credential?.current_balance || null,
    balanceUpdatedAt: credential?.balance_updated_at || null,
    accounts: accounts.rows,
  };
}

// ─── XML helpers ───────────────────────────────────────────────

function getElementText(doc, tagName) {
  const el = doc.getElementsByTagName(tagName)[0];
  return el?.textContent?.trim() || null;
}

function attr(el, name) {
  return el?.getAttribute?.(name) || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Test helpers ──────────────────────────────────────────────

function __setDatabase(mockDb) {
  database = mockDb;
}
function __resetDatabase() {
  database = require('../database.js');
}

module.exports = {
  syncFromIBKR,
  getIBKRStatus,
  parseFlexStatement,
  requestFlexStatement,
  fetchFlexStatement,
  __setDatabase,
  __resetDatabase,
};

module.exports.default = module.exports;
