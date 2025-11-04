const { randomBytes, createCipheriv, createDecipheriv, scryptSync } = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

let encryptionKeyBuffer;

function ensureKeyBuffer() {
  if (encryptionKeyBuffer) {
    return encryptionKeyBuffer;
  }

  const envKey = process.env.CLARIFY_ENCRYPTION_KEY;
  if (envKey) {
    const keyBuffer = Buffer.from(envKey, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error('CLARIFY_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).');
    }
    encryptionKeyBuffer = keyBuffer;
    return encryptionKeyBuffer;
  }

  if (process.env.ALLOW_DEV_NO_ENCRYPTION === 'true') {
    console.warn('CLARIFY_ENCRYPTION_KEY not set. Using development fallback key because ALLOW_DEV_NO_ENCRYPTION=true.');
    encryptionKeyBuffer = scryptSync('electron-app-key', 'salt', 32);
    return encryptionKeyBuffer;
  }

  throw new Error(
    'CLARIFY_ENCRYPTION_KEY is required. Set it in your environment or enable ALLOW_DEV_NO_ENCRYPTION=true for local development.',
  );
}

function encrypt(text) {
  if (typeof text !== 'string') {
    return text === null || text === undefined ? null : String(text);
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, ensureKeyBuffer(), iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
}

function decrypt(encryptedText) {
  if (encryptedText === null || encryptedText === undefined) {
    return null;
  }

  if (typeof encryptedText !== 'string') {
    return encryptedText;
  }

  const [ivHex, encryptedData, authTagHex] = encryptedText.split(':');

  if (!ivHex || !encryptedData || !authTagHex) {
    throw new Error('Invalid encrypted payload');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, ensureKeyBuffer(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
};
module.exports.default = module.exports;
