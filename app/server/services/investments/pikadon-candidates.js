const DEFAULT_PIKADON_TIME_ZONE = 'Asia/Jerusalem';
const PIKADON_KEYWORDS = [
  'פיקדון',
  'פקדון',
  'pikadon',
  'term deposit',
  'fixed deposit',
  'תוכנית חסכון',
  'פק"מ',
  'פקמ',
];

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDateInTimeZone(value, timeZone = DEFAULT_PIKADON_TIME_ZONE) {
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

function transactionLooksLikePikadonDeposit(transaction) {
  const amount = toNumber(transaction?.price);
  if (!Number.isFinite(amount) || amount >= 0) {
    return false;
  }

  const haystack = `${transaction?.name || ''} ${transaction?.memo || ''}`.trim().toLowerCase();
  if (!haystack) {
    return false;
  }

  return PIKADON_KEYWORDS.some((keyword) =>
    haystack.includes(String(keyword || '').toLowerCase()),
  );
}

function buildPikadonCandidate({
  accountId,
  transactionIdentifier,
  transactionVendor,
  transaction,
  timeZone = DEFAULT_PIKADON_TIME_ZONE,
} = {}) {
  if (!transactionLooksLikePikadonDeposit(transaction)) {
    return null;
  }

  const principal = Math.abs(toNumber(transaction?.price) || 0);
  const depositDate = toIsoDateInTimeZone(
    transaction?.transaction_datetime || transaction?.date,
    timeZone,
  );
  const normalizedAccountId = Number(accountId);

  if (!Number.isFinite(principal) || principal <= 0 || !depositDate) {
    return null;
  }

  return {
    account_id: Number.isFinite(normalizedAccountId) ? normalizedAccountId : null,
    transaction_identifier: transactionIdentifier || null,
    transaction_vendor: transactionVendor || null,
    principal,
    deposit_date: depositDate,
    transaction_name: transaction?.name || null,
  };
}

module.exports = {
  DEFAULT_PIKADON_TIME_ZONE,
  PIKADON_KEYWORDS,
  buildPikadonCandidate,
  toIsoDateInTimeZone,
  transactionLooksLikePikadonDeposit,
};

module.exports.default = module.exports;
