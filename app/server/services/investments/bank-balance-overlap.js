const {
  toNumber,
} = require('./account-holdings-rollup.js');

function normalizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNumericId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getInstitutionId(record) {
  return normalizeNumericId(record?.institution_id ?? record?.institution?.id);
}

function getVendorCode(record) {
  return normalizeText(
    record?.institution?.vendor_code
      || record?.institution_vendor_code
      || record?.vendor_code
      || record?.source_vendor_code,
  );
}

function getAccountNumber(record) {
  return normalizeText(record?.account_number || record?.source_account_number);
}

function vendorsCompatible(leftVendor, rightVendor) {
  if (leftVendor && rightVendor) {
    return leftVendor === rightVendor;
  }

  return true;
}

function resolveMatchingBankAccountId(bankAccounts, source) {
  if (!Array.isArray(bankAccounts) || bankAccounts.length === 0 || !source) {
    return null;
  }

  const sourceInstitutionId = getInstitutionId(source);
  const sourceVendorCode = getVendorCode(source);
  const sourceAccountNumber = getAccountNumber(source);

  if (sourceAccountNumber) {
    const exactMatches = bankAccounts.filter((account) => (
      getAccountNumber(account) === sourceAccountNumber
      && vendorsCompatible(getVendorCode(account), sourceVendorCode)
    ));

    if (exactMatches.length === 1) {
      return normalizeNumericId(exactMatches[0].id);
    }
  }

  if (sourceInstitutionId !== null) {
    const institutionMatches = bankAccounts.filter(
      (account) => getInstitutionId(account) === sourceInstitutionId,
    );

    if (institutionMatches.length === 1) {
      return normalizeNumericId(institutionMatches[0].id);
    }
  }

  if (sourceVendorCode) {
    const vendorMatches = bankAccounts.filter(
      (account) => getVendorCode(account) === sourceVendorCode,
    );

    if (vendorMatches.length === 1) {
      return normalizeNumericId(vendorMatches[0].id);
    }
  }

  return null;
}

function buildBankBalanceOverlapAdjustmentMap(accounts = [], sources = []) {
  const bankAccounts = Array.isArray(accounts)
    ? accounts.filter((account) => account?.account_type === 'bank_balance')
    : [];
  const adjustments = new Map();

  if (bankAccounts.length === 0 || !Array.isArray(sources) || sources.length === 0) {
    return adjustments;
  }

  sources.forEach((source) => {
    const matchedBankAccountId = resolveMatchingBankAccountId(bankAccounts, source);
    const activeValue = toNumber(source?.active_value) || 0;

    if (!matchedBankAccountId || activeValue <= 0) {
      return;
    }

    adjustments.set(
      matchedBankAccountId,
      (adjustments.get(matchedBankAccountId) || 0) + activeValue,
    );
  });

  return adjustments;
}

function subtractOverlap(value, overlap) {
  const numericValue = toNumber(value);
  if (numericValue === null) {
    return value;
  }

  const adjustedValue = Math.max(numericValue - overlap, 0);
  return Math.round((adjustedValue + Number.EPSILON) * 1e6) / 1e6;
}

function applyBankBalanceOverlapAdjustments(accounts = [], sources = [], options = {}) {
  const { adjustExplicitValue = false } = options;
  const adjustments = buildBankBalanceOverlapAdjustmentMap(accounts, sources);

  if (adjustments.size === 0) {
    return accounts;
  }

  return accounts.map((account) => {
    const accountId = normalizeNumericId(account?.id);
    const overlap = accountId !== null ? adjustments.get(accountId) : null;
    const bankCurrentValue = toNumber(account?.current_value);

    if (!overlap || account?.account_type !== 'bank_balance') {
      return account;
    }

    // Only subtract when the bank balance is large enough to plausibly include
    // the Pikadon amount. If the available balance is smaller than the deposit,
    // the bank balance is already excluding it and should be left intact.
    if (bankCurrentValue === null || bankCurrentValue + 1e-6 < overlap) {
      return account;
    }

    const nextAccount = {
      ...account,
      current_value: subtractOverlap(account.current_value, overlap),
      cost_basis: subtractOverlap(account.cost_basis, overlap),
    };

    if (adjustExplicitValue) {
      nextAccount.current_value_explicit = subtractOverlap(account.current_value_explicit, overlap);
    }

    return nextAccount;
  });
}

async function fetchActivePikadonOverlapSources(dbAdapter, accountIds = []) {
  const normalizedAccountIds = Array.isArray(accountIds)
    ? accountIds
      .map((value) => normalizeNumericId(value))
      .filter((value) => value !== null)
    : [];

  if (normalizedAccountIds.length === 0) {
    return [];
  }

  const placeholders = normalizedAccountIds.map((_, index) => `$${index + 1}`).join(',');
  const result = await dbAdapter.query(
    `
      SELECT
        ih.account_id AS pikadon_account_id,
        ia.institution_id AS institution_id,
        COALESCE(t.vendor, ih.deposit_transaction_vendor, fi.vendor_code) AS source_vendor_code,
        COALESCE(t.account_number, ia.account_number) AS source_account_number,
        SUM(COALESCE(ih.current_value, ih.cost_basis, 0)) AS active_value
      FROM investment_holdings ih
      JOIN investment_accounts ia ON ia.id = ih.account_id
      LEFT JOIN institution_nodes fi ON ia.institution_id = fi.id AND fi.node_type = 'institution'
      LEFT JOIN transactions t
        ON ih.deposit_transaction_id = t.identifier
       AND ih.deposit_transaction_vendor = t.vendor
      WHERE ih.holding_type = 'pikadon'
        AND COALESCE(ih.status, 'active') = 'active'
        AND ih.account_id IN (${placeholders})
      GROUP BY
        ih.account_id,
        ia.institution_id,
        COALESCE(t.vendor, ih.deposit_transaction_vendor, fi.vendor_code),
        COALESCE(t.account_number, ia.account_number)
    `,
    normalizedAccountIds,
  );

  return Array.isArray(result?.rows) ? result.rows : [];
}

module.exports = {
  applyBankBalanceOverlapAdjustments,
  buildBankBalanceOverlapAdjustmentMap,
  fetchActivePikadonOverlapSources,
};

module.exports.default = module.exports;
