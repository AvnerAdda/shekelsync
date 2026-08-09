const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { requireFromApp } = require('./paths');

const CREDENTIAL_FIELDS = ['username', 'password', 'id_number', 'identification_code'];
const KEY_PATTERN = /^[0-9a-f]{64}$/i;
const HEX_PATTERN = /^[0-9a-f]+$/i;

function inspectPath(filePath) {
  if (!filePath) return { exists: false, unavailable: false, isFile: false };
  try {
    const stat = fs.statSync(filePath);
    return { exists: true, unavailable: false, isFile: stat.isFile() };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, unavailable: false, isFile: false };
    }
    return { exists: false, unavailable: true, isFile: false };
  }
}

function inspectMarker(filePath) {
  const state = inspectPath(filePath);
  if (!state.exists || state.unavailable || !state.isFile) return state;

  try {
    fs.readFileSync(filePath, 'utf8');
    return state;
  } catch {
    return { exists: false, unavailable: true, isFile: false };
  }
}

function emptyResult(status, details = {}) {
  return {
    status,
    encryptedFields: 0,
    authenticatedFields: 0,
    failedFields: 0,
    malformedFields: 0,
    plainFields: 0,
    ...details,
  };
}

function decryptConfigWithCandidate(encryptedConfig, candidateKey) {
  if (!KEY_PATTERN.test(String(candidateKey || '')) || typeof encryptedConfig !== 'string') {
    return { status: 'mismatch' };
  }

  const parseConfig = (value, keySource) => {
    try {
      const config = JSON.parse(value);
      if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
      if (
        config.database !== undefined &&
        (!config.database || typeof config.database !== 'object' || Array.isArray(config.database))
      ) {
        return null;
      }
      if (
        config.database?.mode !== undefined &&
        !['sqlite', 'postgres'].includes(String(config.database.mode).toLowerCase())
      ) {
        return null;
      }
      if (config.database?.path !== undefined && typeof config.database.path !== 'string') {
        return null;
      }
      return { status: 'match', config, keySource };
    } catch {
      return null;
    }
  };

  if (!encryptedConfig.includes(':')) {
    return parseConfig(Buffer.from(encryptedConfig, 'base64').toString('utf8'), 'base64') || {
      status: 'mismatch',
    };
  }

  const parts = encryptedConfig.split(':');
  if (
    parts.length !== 2 ||
    parts[0].length !== 32 ||
    parts[1].length === 0 ||
    parts[1].length % 2 !== 0 ||
    !HEX_PATTERN.test(parts[0]) ||
    !HEX_PATTERN.test(parts[1])
  ) {
    return { status: 'mismatch' };
  }

  const [ivHex, ciphertextHex] = parts;
  const decryptWithKey = (keyBuffer, keySource) => {
    let plaintext;
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-ctr',
        keyBuffer,
        Buffer.from(ivHex, 'hex'),
      );
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextHex, 'hex')),
        decipher.final(),
      ]);
      return parseConfig(plaintext.toString('utf8'), keySource);
    } catch {
      return null;
    } finally {
      plaintext?.fill(0);
    }
  };

  const candidateBuffer = Buffer.from(candidateKey, 'hex');
  try {
    const current = decryptWithKey(candidateBuffer, 'candidate');
    if (current) return current;
  } finally {
    candidateBuffer.fill(0);
  }

  // Pre-keychain configs used this fixed derivation. It does not authenticate
  // the candidate, but it can safely locate the credential store for the
  // authenticated database check that follows.
  const legacyBuffer = crypto.scryptSync('electron-app-key', 'salt', 32);
  try {
    return decryptWithKey(legacyBuffer, 'legacy') || { status: 'mismatch' };
  } finally {
    legacyBuffer.fill(0);
  }
}

function resolveUserDataPath(override) {
  if (typeof override === 'string' && override.length > 0) return override;
  try {
    const { app } = require('electron');
    return app.getPath('userData');
  } catch {
    return null;
  }
}

function resolveKeyScope(override) {
  if (['production', 'development'].includes(override)) return override;
  try {
    const { app } = require('electron');
    return app?.isPackaged === false ? 'development' : 'production';
  } catch {
    return 'production';
  }
}

function validateAuxiliaryArtifacts(candidateKey, options = {}) {
  const userDataPath = resolveUserDataPath(options.userDataPath);
  if (!userDataPath) {
    return { status: 'absent', total: 0, authenticated: 0, failed: 0, malformed: 0 };
  }

  const scope = resolveKeyScope(options.scope);
  const secureStorePath = path.join(userDataPath, 'secure-store');
  const scopedSessionPath = path.join(secureStorePath, `session.${scope}.enc`);
  const paths = [
    scopedSessionPath,
    path.join(secureStorePath, 'chatbot-secrets.enc'),
    path.join(secureStorePath, 'telegram.enc'),
  ];
  const legacyMarker = path.join(secureStorePath, '.legacy-session-ignored');
  const authorityMarker = path.join(secureStorePath, '.session-file-authoritative');

  const keyBuffer = Buffer.from(candidateKey, 'hex');
  let total = 0;
  let authenticated = 0;
  let failed = 0;
  let malformed = 0;
  let unavailable = 0;
  const markerState = inspectMarker(legacyMarker);
  if (markerState.unavailable || (markerState.exists && !markerState.isFile)) unavailable += 1;
  const authorityState = inspectMarker(authorityMarker);
  if (authorityState.unavailable || (authorityState.exists && !authorityState.isFile)) {
    unavailable += 1;
  } else if (authorityState.exists) {
    // SessionStore deliberately installs this marker before an authoritative
    // file write. A marker without its payload is an interrupted protected
    // state, never evidence of a fresh install that may create a new key.
    const scopedSessionState = inspectPath(scopedSessionPath);
    if (
      scopedSessionState.unavailable ||
      !scopedSessionState.exists ||
      !scopedSessionState.isFile
    ) {
      unavailable += 1;
    }
  }
  if (scope === 'production' && !markerState.exists && !markerState.unavailable) {
    paths.push(path.join(secureStorePath, 'session.enc'));
  }
  try {
    for (const artifactPath of paths) {
      try {
        const encrypted = fs.readFileSync(artifactPath, 'utf8');
        total += 1;
        const envelope = parseEnvelope(encrypted);
        if (envelope.kind !== 'encrypted') {
          malformed += 1;
        } else if (authenticateEnvelope(envelope, keyBuffer)) {
          authenticated += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        if (error?.code === 'ENOENT') {
          // The authoritative marker and scoped payload are one recovery
          // state. If the payload disappears between inspection and read,
          // preserve that as unavailable instead of reopening the fresh-install
          // path that is allowed to create a master key.
          if (artifactPath === scopedSessionPath && authorityState.exists) {
            total += 1;
            unavailable += 1;
          }
          continue;
        }
        total += 1;
        unavailable += 1;
      }
    }
  } finally {
    keyBuffer.fill(0);
  }

  let status = 'absent';
  if (unavailable > 0) status = 'unavailable';
  else if (malformed > 0) status = authenticated > 0 || failed > 0 ? 'partial' : 'malformed';
  else if (total > 0 && authenticated === total) status = 'match';
  else if (authenticated === 0 && failed > 0) status = 'mismatch';
  else if (total > 0) status = 'partial';

  return { status, total, authenticated, failed, malformed, unavailable };
}

function resolveCredentialStore(candidateKey, options = {}) {
  const explicitDatabasePath = options.databasePath || process.env.SQLITE_DB_PATH;
  const userDataPath = resolveUserDataPath(options.userDataPath);
  if (!userDataPath && !explicitDatabasePath) {
    return { status: 'unavailable', configStatus: 'unavailable' };
  }

  const preferredPath = userDataPath ? path.join(userDataPath, 'shekelsync.sqlite') : null;
  const legacyPath = userDataPath ? path.join(userDataPath, 'clarify.sqlite') : null;
  const configPath = options.configPath || (userDataPath ? path.join(userDataPath, 'config.enc') : null);
  let configStatus = 'absent';
  let configuredDatabase;

  const configState = inspectPath(configPath);
  if (configState.unavailable) {
    return { status: 'unavailable', configStatus: 'unavailable' };
  }
  if (configState.exists) {
    try {
      if (!configState.isFile) {
        return { status: 'unavailable', configStatus: 'unavailable' };
      }
      const configResult = decryptConfigWithCandidate(
        fs.readFileSync(configPath, 'utf8'),
        candidateKey,
      );
      if (configResult.status !== 'match') {
        return { status: 'config_mismatch', configStatus: 'mismatch' };
      }
      configStatus = configResult.keySource === 'candidate' ? 'candidate' : configResult.keySource;
      const databaseConfig = configResult.config.database;
      if (String(databaseConfig?.mode || '').toLowerCase() === 'postgres') {
        return { status: 'external', configStatus };
      }
      if (typeof databaseConfig?.path === 'string' && databaseConfig.path.length > 0) {
        configuredDatabase = path.resolve(databaseConfig.path);
      }
    } catch {
      return { status: 'unavailable', configStatus: 'unavailable' };
    }
  }

  const preferredState = inspectPath(preferredPath);
  const legacyState = inspectPath(legacyPath);
  if (preferredState.unavailable || legacyState.unavailable) {
    return { status: 'unavailable', configStatus };
  }
  const preferredExists = preferredState.exists;
  const legacyExists = legacyState.exists;
  if (!explicitDatabasePath && !configuredDatabase && preferredExists && legacyExists) {
    return { status: 'ambiguous', configStatus };
  }
  const databasePath = explicitDatabasePath
    ? path.resolve(explicitDatabasePath)
    : configuredDatabase || (preferredExists ? preferredPath : legacyExists ? legacyPath : preferredPath);
  return {
    status: 'resolved',
    databasePath,
    configStatus,
    explicitPath: Boolean(explicitDatabasePath || configuredDatabase),
  };
}

function parseEnvelope(value) {
  if (typeof value !== 'string' || !value.includes(':')) {
    return { kind: 'plain' };
  }

  const parts = value.split(':');
  if (parts.length !== 3) return { kind: 'malformed' };
  const [ivHex, encryptedHex, authTagHex] = parts;
  if (
    ivHex.length !== 24 ||
    authTagHex.length !== 32 ||
    encryptedHex.length === 0 ||
    encryptedHex.length % 2 !== 0 ||
    !HEX_PATTERN.test(ivHex) ||
    !HEX_PATTERN.test(encryptedHex) ||
    !HEX_PATTERN.test(authTagHex)
  ) {
    return { kind: 'malformed' };
  }

  return { kind: 'encrypted', ivHex, encryptedHex, authTagHex };
}

function authenticateEnvelope(envelope, keyBuffer) {
  let plaintextChunk;
  let plaintextFinal;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      keyBuffer,
      Buffer.from(envelope.ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(envelope.authTagHex, 'hex'));
    plaintextChunk = decipher.update(Buffer.from(envelope.encryptedHex, 'hex'));
    plaintextFinal = decipher.final();
    return true;
  } catch {
    return false;
  } finally {
    plaintextChunk?.fill(0);
    plaintextFinal?.fill(0);
  }
}

function validateCredentialRows(rows, candidateKey) {
  if (!KEY_PATTERN.test(String(candidateKey || ''))) {
    return {
      status: 'invalid_key',
      encryptedFields: 0,
      authenticatedFields: 0,
      failedFields: 0,
      malformedFields: 0,
      plainFields: 0,
    };
  }

  const keyBuffer = Buffer.from(candidateKey, 'hex');
  let encryptedFields = 0;
  let authenticatedFields = 0;
  let failedFields = 0;
  let malformedFields = 0;
  let plainFields = 0;

  try {
    for (const row of rows || []) {
      for (const field of CREDENTIAL_FIELDS) {
        const value = row?.[field];
        if (value === null || value === undefined || value === '') continue;

        const envelope = parseEnvelope(value);
        if (envelope.kind === 'plain') {
          plainFields += 1;
          continue;
        }
        if (envelope.kind === 'malformed') {
          malformedFields += 1;
          continue;
        }

        encryptedFields += 1;
        if (authenticateEnvelope(envelope, keyBuffer)) authenticatedFields += 1;
        else failedFields += 1;
      }
    }
  } finally {
    keyBuffer.fill(0);
  }

  let status;
  if (malformedFields > 0 || plainFields > 0) status = encryptedFields > 0 ? 'partial' : 'malformed';
  else if (encryptedFields === 0) status = 'empty';
  else if (failedFields === 0) status = 'match';
  else if (authenticatedFields === 0) status = 'mismatch';
  else status = 'partial';

  return {
    status,
    encryptedFields,
    authenticatedFields,
    failedFields,
    malformedFields,
    plainFields,
  };
}

function resolveDatabaseConstructor(override) {
  if (override) return override;
  const module = requireFromApp('better-sqlite3');
  return typeof module.default === 'function' ? module.default : module;
}

function validateCredentialKey(candidateKey, options = {}) {
  if (!KEY_PATTERN.test(String(candidateKey || ''))) {
    return emptyResult('invalid_key');
  }

  const auxiliary = validateAuxiliaryArtifacts(candidateKey, options);
  const auxiliaryDetails = {
    auxiliaryStatus: auxiliary.status,
    auxiliaryFields: auxiliary.total,
    authenticatedAuxiliaryFields: auxiliary.authenticated,
    failedAuxiliaryFields: auxiliary.failed,
  };
  const store = resolveCredentialStore(candidateKey, options);
  if (store.status === 'config_mismatch') {
    return emptyResult('config_mismatch', { configStatus: store.configStatus, ...auxiliaryDetails });
  }
  if (store.status === 'external') {
    const externalStatus = auxiliary.status === 'absent'
      ? 'config_match'
      : auxiliary.status === 'match'
        ? 'match'
        : auxiliary.status;
    return emptyResult(externalStatus, { configStatus: store.configStatus, ...auxiliaryDetails });
  }
  if (store.status === 'ambiguous') {
    return emptyResult('ambiguous', { configStatus: store.configStatus, ...auxiliaryDetails });
  }
  if (store.status !== 'resolved' || !store.databasePath) {
    return emptyResult('unavailable', { configStatus: store.configStatus, ...auxiliaryDetails });
  }
  const databaseState = inspectPath(store.databasePath);
  if (databaseState.unavailable || (databaseState.exists && !databaseState.isFile)) {
    return emptyResult('unavailable', { configStatus: store.configStatus, ...auxiliaryDetails });
  }
  if (!databaseState.exists) {
    const isUnconfiguredDefault = store.configStatus === 'absent' && !store.explicitPath;
    let status = 'missing';
    if (isUnconfiguredDefault) {
      if (auxiliary.status === 'absent') status = 'fresh';
      else if (auxiliary.status === 'match') status = 'match';
      else status = auxiliary.status;
    }
    return emptyResult(status, {
      configStatus: store.configStatus,
      ...auxiliaryDetails,
    });
  }

  const databasePath = store.databasePath;
  let database;
  try {
    const Database = resolveDatabaseConstructor(options.databaseCtor);
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    database.pragma('query_only = ON');
    const table = database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'vendor_credentials'")
      .get();
    if (!table) {
      return emptyResult('unavailable', { configStatus: store.configStatus, ...auxiliaryDetails });
    }
    const rows = database
      .prepare('SELECT username, password, id_number, identification_code FROM vendor_credentials')
      .all();
    const databaseResult = validateCredentialRows(rows, candidateKey);
    let status = databaseResult.status;
    if (auxiliary.status !== 'absent') {
      if (['unavailable', 'malformed', 'partial'].includes(auxiliary.status)) {
        status = databaseResult.status === 'empty' ? auxiliary.status : 'partial';
      } else if (auxiliary.status === 'match') {
        if (databaseResult.status === 'empty') status = 'match';
        else if (databaseResult.status !== 'match') status = 'partial';
      } else if (auxiliary.status === 'mismatch') {
        status = databaseResult.status === 'match' ? 'partial' : 'mismatch';
      }
    }
    return {
      ...databaseResult,
      status,
      configStatus: store.configStatus,
      ...auxiliaryDetails,
    };
  } catch {
    return emptyResult('unavailable', { configStatus: store.configStatus, ...auxiliaryDetails });
  } finally {
    try {
      database?.close();
    } catch {
      // Read-only validation cleanup is best-effort.
    }
  }
}

module.exports = {
  CREDENTIAL_FIELDS,
  decryptConfigWithCandidate,
  parseEnvelope,
  resolveCredentialStore,
  validateAuxiliaryArtifacts,
  validateCredentialKey,
  validateCredentialRows,
};
