const DEFAULT_TIME_ZONE = 'Asia/Jerusalem';

function normalizeDateInput(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  const type = typeof value;
  if (type === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (type === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const hasTimeZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
    const withT = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const normalized = hasTimeZone ? withT : `${withT}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function parseUTCDate(value) {
  return normalizeDateInput(value);
}

function toUTCISOString(value) {
  const date = parseUTCDate(value);
  return date ? date.toISOString() : null;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  parseUTCDate,
  toUTCISOString,
};

module.exports.default = module.exports;
