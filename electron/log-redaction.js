/**
 * Redaction applied to everything written to the log file and to diagnostics exports.
 * Users attach these to bug reports, so they must not carry account/card/ID numbers,
 * balances, e-mail addresses or secrets.
 */

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// key=value, key: value and JSON "key":"value" forms
const SECRET_REGEX = /("?)(api[_-]?key|token|secret|password|id_number|identification_code|username)\1(\s*[:=]\s*)("?)[^"\s,}]{4,}\4/gi;
// The trailing lookahead keeps "balance: 2026-10-26" (a date) intact
const BALANCE_REGEX = /(balance"?\s*[:=]?\s*"?)(₪\s*)?-?[\d,]+(?:\.\d+)?(?![\d-])/gi;
const SHEKEL_AMOUNT_REGEX = /₪\s*-?[\d,]+(?:\.\d+)?/g;
// Account, card and ID numbers: any run of 6+ digits, optionally split by dashes (not durations like 120000ms)
const LONG_NUMBER_REGEX = /(?<![\d.])\d(?:[\d-]{4,}\d)(?![\d.])(?!\s*ms\b)/g;

function maskNumber(match) {
  const digits = match.replace(/-/g, '');
  if (digits.length < 6 || /^\d{4}-\d{2}-\d{2}$/.test(match)) {
    return match;
  }
  return `****${digits.slice(-4)}`;
}

function redactSensitiveText(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }
  return value
    .replace(EMAIL_REGEX, '[redacted-email]')
    .replace(SECRET_REGEX, (_match, quote, key, separator, valueQuote) => (
      `${quote}${key}${quote}${separator}${valueQuote}[redacted]${valueQuote}`
    ))
    .replace(BALANCE_REGEX, (_match, prefix) => `${prefix}[redacted]`)
    .replace(SHEKEL_AMOUNT_REGEX, '₪[redacted]')
    .replace(LONG_NUMBER_REGEX, maskNumber);
}

function redactValue(value, depth = 0) {
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  if (depth > 4 || !value || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Error) {
    const copy = new Error(redactSensitiveText(value.message));
    copy.stack = redactSensitiveText(value.stack);
    return copy;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redactValue(entry, depth + 1)]),
  );
}

/** electron-log hook: redact every message before it reaches a transport. */
function redactLogMessageHook(message) {
  if (!message || !Array.isArray(message.data)) {
    return message;
  }
  return { ...message, data: message.data.map((entry) => redactValue(entry)) };
}

module.exports = {
  redactLogMessageHook,
  redactSensitiveText,
  redactValue,
};
