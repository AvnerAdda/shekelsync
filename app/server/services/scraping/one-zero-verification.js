/**
 * One Zero phone verification.
 *
 * One Zero logs in with email + password + a long-term "OTP token" that the
 * bank issues once a phone number has been confirmed by SMS. The scraper
 * library exposes the two SMS steps (send code, exchange code for token) on a
 * single scraper instance that remembers the SMS context in between, so we
 * keep that instance in memory for a few minutes while the user types the code.
 *
 * The token is written to the credential (encrypted, like every secret) and is
 * never returned to the renderer. After that, every sync — including
 * scheduled ones with no window open — logs in without asking for a code.
 */

const crypto = require('crypto');
const { CompanyTypes, createScraper } = require('israeli-bank-scrapers-core');
const baseDatabase = require('../database.js');
const credentialsService = require('../credentials.js');

const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_CONFIRM_ATTEMPTS = 5;
const MAX_PENDING_SESSIONS = 20;
const CODE_PATTERN = /^\d{4,8}$/;

const defaultDeps = {
  database: baseDatabase,
  createScraper,
  updateCredential: (payload) => credentialsService.updateCredential(payload),
  now: () => Date.now(),
};

let deps = { ...defaultDeps };
const sessions = new Map();

function verificationError(statusCode, code, message, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/**
 * Accepts the ways people write an Israeli mobile number (050-1234567,
 * 0501234567, 972501234567, +972 50 123 4567, 00972...) and returns E.164.
 * Any other number must already be in international format.
 */
function normalizePhoneNumber(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw.trim().replace(/[\s\-().]/g, '');
  if (!value) return null;

  if (value.startsWith('00')) {
    value = `+${value.slice(2)}`;
  }

  if (value.startsWith('+')) {
    return /^\+\d{8,15}$/.test(value) ? value : null;
  }

  if (!/^\d+$/.test(value)) return null;

  if (value.startsWith('972')) {
    return value.length >= 11 && value.length <= 13 ? `+${value}` : null;
  }

  if (value.startsWith('0') && value.length === 10) {
    return `+972${value.slice(1)}`;
  }

  return null;
}

function maskPhoneNumber(e164) {
  const digits = String(e164 || '').replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : '••••';
}

function pruneExpiredSessions() {
  const now = deps.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
    }
  }
}

function dropSessionsForCredential(credentialId) {
  for (const [id, session] of sessions) {
    if (session.credentialId === credentialId) {
      sessions.delete(id);
    }
  }
}

async function assertOneZeroCredential(credentialId) {
  const result = await deps.database.query(
    'SELECT id, vendor FROM vendor_credentials WHERE id = $1',
    [credentialId],
  );
  const row = result?.rows?.[0];
  if (!row) {
    throw verificationError(404, 'credential_not_found', 'Credential not found');
  }
  if (row.vendor !== CompanyTypes.oneZero) {
    throw verificationError(400, 'not_one_zero', 'Phone verification is only available for One Zero accounts');
  }
}

async function startVerification({ credentialId, phoneNumber }) {
  const phone = normalizePhoneNumber(phoneNumber);
  if (!phone) {
    throw verificationError(400, 'invalid_phone_number', 'Enter the mobile number registered with One Zero');
  }

  await assertOneZeroCredential(credentialId);

  pruneExpiredSessions();
  dropSessionsForCredential(credentialId);
  if (sessions.size >= MAX_PENDING_SESSIONS) {
    throw verificationError(429, 'too_many_sessions', 'Too many pending verifications. Try again in a few minutes.');
  }

  const scraper = deps.createScraper({
    companyId: CompanyTypes.oneZero,
    startDate: new Date(deps.now()),
  });

  let result;
  try {
    result = await scraper.triggerTwoFactorAuth(phone);
  } catch {
    result = null;
  }
  if (!result?.success) {
    throw verificationError(502, 'sms_send_failed', 'One Zero did not send a code. Check the number and try again.');
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = deps.now() + SESSION_TTL_MS;
  sessions.set(sessionId, { credentialId, scraper, expiresAt, attempts: 0 });

  return {
    sessionId,
    expiresAt: new Date(expiresAt).toISOString(),
    maskedPhoneNumber: maskPhoneNumber(phone),
  };
}

async function confirmVerification({ credentialId, sessionId, code }) {
  const trimmedCode = String(code ?? '').replace(/\s+/g, '');
  if (!CODE_PATTERN.test(trimmedCode)) {
    throw verificationError(400, 'invalid_code', 'Enter the code from the SMS');
  }

  const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
  if (!session || session.credentialId !== credentialId) {
    throw verificationError(404, 'session_not_found', 'This code request is no longer active. Send a new code.');
  }

  if (session.expiresAt <= deps.now()) {
    sessions.delete(sessionId);
    throw verificationError(410, 'session_expired', 'The code expired. Send a new code.');
  }

  session.attempts += 1;

  let result;
  try {
    result = await session.scraper.getLongTermTwoFactorToken(trimmedCode);
  } catch {
    result = null;
  }

  const token = result?.success ? result.longTermTwoFactorAuthToken : null;
  if (typeof token !== 'string' || !token.trim()) {
    const attemptsRemaining = Math.max(0, MAX_CONFIRM_ATTEMPTS - session.attempts);
    if (attemptsRemaining === 0) {
      sessions.delete(sessionId);
      throw verificationError(429, 'too_many_attempts', 'Too many wrong codes. Send a new code.', {
        attemptsRemaining,
      });
    }
    throw verificationError(400, 'code_rejected', 'One Zero did not accept that code', { attemptsRemaining });
  }

  await deps.updateCredential({ id: credentialId, otpToken: token.trim() });
  sessions.delete(sessionId);

  return { verified: true };
}

module.exports = {
  startVerification,
  confirmVerification,
  normalizePhoneNumber,
  maskPhoneNumber,
  SESSION_TTL_MS,
  MAX_CONFIRM_ATTEMPTS,
  __setDependencies(overrides = {}) {
    deps = { ...deps, ...overrides };
  },
  __resetForTests() {
    deps = { ...defaultDeps };
    sessions.clear();
  },
};
module.exports.default = module.exports;
