const DEFAULT_INVESTMENT_TIME_ZONE = 'Asia/Jerusalem';
const FEE_KEYWORDS = ['fee', 'fees', 'commission', 'עמלה', 'עמלות'];
const {
  transactionLooksLikePikadonDeposit,
} = require('./pikadon-candidates.js');

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function lower(value) {
  return String(value || '').toLowerCase();
}

function matchesKeyword(text, keywords) {
  const normalized = lower(text);
  return keywords.some((keyword) => normalized.includes(keyword));
}

function normalizeDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.split('T')[0];

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().split('T')[0];
}

function toIsoDateInTimeZone(value, timeZone = DEFAULT_INVESTMENT_TIME_ZONE) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 10);
    }
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(parsed);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    return parsed.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function isInvestmentContribution(transaction, { excludePikadonTransactions = false } = {}) {
  const amount = toNumber(transaction?.price);
  if (amount === null || amount >= 0) {
    return false;
  }

  const categoryType = lower(transaction?.category_type);
  if (categoryType && categoryType !== 'investment') {
    return false;
  }

  const haystack = [
    transaction?.name,
    transaction?.memo,
    transaction?.category_name,
    transaction?.category_name_en,
    transaction?.category_name_fr,
  ].join(' ');

  if (excludePikadonTransactions && transactionLooksLikePikadonDeposit(transaction)) {
    return false;
  }

  return !matchesKeyword(haystack, FEE_KEYWORDS);
}

async function fetchLinkedInvestmentTransactions(client, accountIds = [], options = {}) {
  const ids = Array.isArray(accountIds)
    ? accountIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : [];
  const { startDate, endDate } = options || {};

  const params = [];
  const filters = [];

  if (ids.length > 0) {
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
    filters.push(`tal.account_id IN (${placeholders})`);
    params.push(...ids);
  }

  if (startDate) {
    params.push(startDate);
    filters.push(`t.date >= $${params.length}`);
  }

  if (endDate) {
    params.push(endDate);
    filters.push(`t.date <= $${params.length}`);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await client.query(
    `
      SELECT
        tal.account_id,
        t.identifier,
        t.vendor,
        t.date,
        t.transaction_datetime,
        t.name,
        t.memo,
        t.price,
        COALESCE(cd.category_type, t.category_type) AS category_type,
        cd.name AS category_name,
        cd.name_en AS category_name_en,
        cd.name_fr AS category_name_fr,
        COALESCE(cd.is_counted_as_income, 1) AS is_counted_as_income
      FROM transaction_account_links tal
      JOIN transactions t
        ON tal.transaction_identifier = t.identifier
       AND tal.transaction_vendor = t.vendor
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      ${whereClause}
      ORDER BY tal.account_id ASC, t.date ASC, t.identifier ASC
    `,
    params,
  );

  return Array.isArray(result?.rows) ? result.rows : [];
}

function applyContributionRollforward(
  accounts,
  linkedTransactions,
  {
    accountIdField = 'id',
    dateField = 'as_of_date',
    currentValueField = 'current_value',
    costBasisField = 'cost_basis',
    timeZone = DEFAULT_INVESTMENT_TIME_ZONE,
    excludePikadonTransactions = false,
  } = {},
) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return [];
  }

  if (!Array.isArray(linkedTransactions) || linkedTransactions.length === 0) {
    return accounts;
  }

  const accountsById = new Map();
  accounts.forEach((account) => {
    const accountId = Number(account?.[accountIdField]);
    if (Number.isFinite(accountId)) {
      accountsById.set(accountId, account);
    }
  });

  if (accountsById.size === 0) {
    return accounts;
  }

  const transactionsByAccount = new Map();
  linkedTransactions.forEach((transaction) => {
    if (!isInvestmentContribution(transaction, { excludePikadonTransactions })) {
      return;
    }

    const accountId = Number(transaction?.account_id);
    if (!Number.isFinite(accountId) || !accountsById.has(accountId)) {
      return;
    }

    const effectiveDate = toIsoDateInTimeZone(
      transaction.transaction_datetime || transaction.date,
      timeZone,
    );
    const contributionAmount = Math.abs(toNumber(transaction.price) || 0);

    if (!effectiveDate || contributionAmount <= 0) {
      return;
    }

    if (!transactionsByAccount.has(accountId)) {
      transactionsByAccount.set(accountId, []);
    }

    transactionsByAccount.get(accountId).push({
      ...transaction,
      effectiveDate,
      contributionAmount,
    });
  });

  transactionsByAccount.forEach((transactions, accountId) => {
    const account = accountsById.get(accountId);
    if (!account) return;

    transactions.sort((left, right) => {
      if (left.effectiveDate === right.effectiveDate) {
        return String(left.identifier).localeCompare(String(right.identifier));
      }
      return left.effectiveDate.localeCompare(right.effectiveDate);
    });

    let lastAppliedDate = normalizeDateOnly(account[dateField]);
    let currentValue = toNumber(account[currentValueField]) ?? 0;
    let costBasis = toNumber(account[costBasisField]);
    if (costBasis === null) {
      costBasis = currentValue;
    }

    let appliedCount = 0;
    let adjustmentTotal = 0;

    transactions.forEach((transaction) => {
      if (lastAppliedDate && transaction.effectiveDate <= lastAppliedDate) {
        return;
      }

      currentValue += transaction.contributionAmount;
      costBasis += transaction.contributionAmount;
      lastAppliedDate = transaction.effectiveDate;
      adjustmentTotal += transaction.contributionAmount;
      appliedCount += 1;
    });

    if (appliedCount === 0) {
      return;
    }

    account[currentValueField] = currentValue;
    account[costBasisField] = costBasis;
    account[dateField] = lastAppliedDate;
    account.linked_contribution_adjustment = adjustmentTotal;
    account.linked_contribution_count = appliedCount;
  });

  return accounts;
}

function appendContributionHistory(
  points,
  linkedTransactions,
  {
    timeZone = DEFAULT_INVESTMENT_TIME_ZONE,
    excludePikadonTransactions = false,
  } = {},
) {
  if (!Array.isArray(points) || points.length === 0) {
    return Array.isArray(points) ? points : [];
  }

  if (!Array.isArray(linkedTransactions) || linkedTransactions.length === 0) {
    return points;
  }

  const groupedAdjustments = new Map();
  linkedTransactions.forEach((transaction) => {
    if (!isInvestmentContribution(transaction, { excludePikadonTransactions })) {
      return;
    }

    const effectiveDate = toIsoDateInTimeZone(
      transaction.transaction_datetime || transaction.date,
      timeZone,
    );
    const contributionAmount = Math.abs(toNumber(transaction.price) || 0);

    if (!effectiveDate || contributionAmount <= 0) {
      return;
    }

    groupedAdjustments.set(
      effectiveDate,
      (groupedAdjustments.get(effectiveDate) || 0) + contributionAmount,
    );
  });

  if (groupedAdjustments.size === 0) {
    return points;
  }

  const augmented = [...points].sort((left, right) => left.date.localeCompare(right.date));
  let lastPoint = { ...augmented[augmented.length - 1] };
  let lastDate = normalizeDateOnly(lastPoint.date);

  Array.from(groupedAdjustments.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .forEach(([effectiveDate, contributionAmount]) => {
      if (lastDate && effectiveDate <= lastDate) {
        return;
      }

      const currentValue = (toNumber(lastPoint.currentValue) || 0) + contributionAmount;
      const costBasis = (toNumber(lastPoint.costBasis) || 0) + contributionAmount;
      const gainLoss = currentValue - costBasis;

      lastPoint = {
        ...lastPoint,
        date: effectiveDate,
        currentValue,
        costBasis,
        gainLoss,
        roi: costBasis > 0 ? (gainLoss / costBasis) * 100 : 0,
      };
      lastDate = effectiveDate;
      augmented.push(lastPoint);
    });

  return augmented;
}

module.exports = {
  DEFAULT_INVESTMENT_TIME_ZONE,
  appendContributionHistory,
  applyContributionRollforward,
  fetchLinkedInvestmentTransactions,
  isInvestmentContribution,
  normalizeDateOnly,
  toIsoDateInTimeZone,
};

module.exports.default = module.exports;
