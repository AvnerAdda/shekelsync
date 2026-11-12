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

  if (
    excludePikadonTransactions
    && (
      Number(transaction?.is_pikadon_related) === 1
      || transactionLooksLikePikadonDeposit(transaction)
    )
  ) {
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
    filters.push(`substr(t.date, 1, 10) >= $${params.length}`);
  }

  if (endDate) {
    params.push(endDate);
    filters.push(`substr(t.date, 1, 10) <= $${params.length}`);
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
        t.original_currency,
        t.charged_currency,
        t.is_pikadon_related,
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

    // Estimates only extend a real statement. Without one, a few months of
    // accruals would masquerade as the whole balance.
    if (Number(transaction?.is_estimated) === 1) {
      const account = accountsById.get(accountId);
      if (!normalizeDateOnly(account[dateField]) || toNumber(account[currentValueField]) === null) {
        return;
      }
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

    const snapshotDate = normalizeDateOnly(account[dateField]);
    let lastAppliedDate = snapshotDate;
    let currentValue = toNumber(account[currentValueField]) ?? 0;
    let costBasis = toNumber(account[costBasisField]);
    if (costBasis === null) {
      costBasis = currentValue;
    }

    let appliedCount = 0;
    let adjustmentTotal = 0;
    let estimatedCount = 0;
    let estimatedTotal = 0;
    let estimatedThroughDate = null;

    transactions.forEach((transaction) => {
      // Every contribution after the original snapshot belongs in the balance,
      // including several contributions sharing the same effective date.
      if (snapshotDate && transaction.effectiveDate <= snapshotDate) {
        return;
      }

      currentValue += transaction.contributionAmount;
      costBasis += transaction.contributionAmount;

      if (Number(transaction.is_estimated) === 1) {
        // Estimated payroll contributions grow the balance but are not a
        // valuation: keep the statement date so staleness prompts still fire.
        estimatedTotal += transaction.contributionAmount;
        estimatedCount += 1;
        estimatedThroughDate = transaction.effectiveDate;
        return;
      }

      lastAppliedDate = transaction.effectiveDate;
      adjustmentTotal += transaction.contributionAmount;
      appliedCount += 1;
    });

    if (appliedCount === 0 && estimatedCount === 0) {
      return;
    }

    account[currentValueField] = currentValue;
    account[costBasisField] = costBasis;
    account[dateField] = lastAppliedDate;
    if (appliedCount > 0) {
      account.linked_contribution_adjustment = adjustmentTotal;
      account.linked_contribution_count = appliedCount;
    }
    if (estimatedCount > 0) {
      account.estimated_contribution_adjustment = estimatedTotal;
      account.estimated_contribution_count = estimatedCount;
      account.estimated_contribution_since = snapshotDate;
      account.estimated_contribution_through = estimatedThroughDate;
    }
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

    const group = groupedAdjustments.get(effectiveDate) || { total: 0, estimated: 0 };
    group.total += contributionAmount;
    if (Number(transaction.is_estimated) === 1) {
      group.estimated += contributionAmount;
    }
    groupedAdjustments.set(effectiveDate, group);
  });

  if (groupedAdjustments.size === 0) {
    return points;
  }

  const augmented = [...points].sort((left, right) => left.date.localeCompare(right.date));
  let lastPoint = { ...augmented[augmented.length - 1] };
  let lastDate = normalizeDateOnly(lastPoint.date);
  let estimatedSoFar = 0;

  Array.from(groupedAdjustments.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .forEach(([effectiveDate, { total: contributionAmount, estimated }]) => {
      if (lastDate && effectiveDate <= lastDate) {
        return;
      }

      const currentValue = (toNumber(lastPoint.currentValue) || 0) + contributionAmount;
      const costBasis = (toNumber(lastPoint.costBasis) || 0) + contributionAmount;
      const gainLoss = currentValue - costBasis;
      estimatedSoFar += estimated;

      lastPoint = {
        ...lastPoint,
        date: effectiveDate,
        currentValue,
        costBasis,
        gainLoss,
        roi: costBasis > 0 ? (gainLoss / costBasis) * 100 : 0,
      };
      if (estimatedSoFar > 0) {
        lastPoint.estimatedContributionTotal = estimatedSoFar;
        if (estimated > 0) {
          // An estimated payroll contribution is not a valuation.
          lastPoint.isActualValuation = false;
        }
      }
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
