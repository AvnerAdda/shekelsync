/**
 * License Service for ShekelSync
 *
 * Legacy license registration utilities.
 *
 * ShekelSync now uses public, donation-supported access. The registration
 * helpers remain for backwards compatibility with existing installations,
 * but legacy license checks no longer restrict any feature.
 */

const crypto = require('crypto');
const os = require('os');
const { app } = require('electron');
const { v4: uuidv4 } = require('uuid');
const { dbManager } = require('./database');
const { getSupabaseClient, isSupabaseConfigured } = require('./supabase-client');
const { logger } = require('./logger');
const {
  PUBLIC_ACCESS_STATUS,
  getPublicAccessStatus,
  isPublicWriteAllowed,
} = require('./public-access-policy');

// Constants
const TRIAL_DAYS = 30;
const OFFLINE_GRACE_DAYS = 7;

let licenseSchemaChecked = false;
let licenseSchemaInfo = { emailAvailable: false, teudatZehutNullable: false };

function isMissingColumnError(error, columnName) {
  if (!error || !error.message) return false;
  const message = String(error.message).toLowerCase();
  const needle = columnName.toLowerCase();
  return (
    (message.includes(`column "${needle}"`) && message.includes('does not exist')) ||
    message.includes(`'${needle}' column`) ||
    message.includes(`"${needle}" column`) ||
    message.includes(`could not find the '${needle}' column`) ||
    message.includes(`could not find the "${needle}" column`)
  );
}

async function ensureEmailColumn() {
  if (licenseSchemaChecked) return licenseSchemaInfo;

  try {
    if (dbManager.mode === 'sqlite') {
      const result = await dbManager.query('PRAGMA table_info(license)');
      const columns = result.rows || [];
      const emailAvailable = columns.some((col) => col.name === 'email');
      const teudatZehutCol = columns.find((col) => col.name === 'teudat_zehut');
      const teudatZehutNullable = !teudatZehutCol || teudatZehutCol.notnull === 0;

      if (!emailAvailable) {
        await dbManager.query('ALTER TABLE license ADD COLUMN email TEXT');
        await dbManager.query('UPDATE license SET email = teudat_zehut WHERE email IS NULL');
        licenseSchemaInfo = { emailAvailable: true, teudatZehutNullable };
        logger.info('Added email column to license table (sqlite)');
      } else {
        licenseSchemaInfo = { emailAvailable, teudatZehutNullable };
      }
    } else {
      const result = await dbManager.query(
        "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'license'",
      );
      const columns = result.rows || [];
      const emailAvailable = columns.some((col) => col.column_name === 'email');
      const teudatZehutCol = columns.find((col) => col.column_name === 'teudat_zehut');
      const teudatZehutNullable = !teudatZehutCol || teudatZehutCol.is_nullable === 'YES';

      if (!emailAvailable) {
        await dbManager.query('ALTER TABLE license ADD COLUMN IF NOT EXISTS email TEXT');
        await dbManager.query('UPDATE license SET email = teudat_zehut WHERE email IS NULL');
        licenseSchemaInfo = { emailAvailable: true, teudatZehutNullable };
        logger.info('Added email column to license table (postgres)');
      } else {
        licenseSchemaInfo = { emailAvailable, teudatZehutNullable };
      }
    }
  } catch (error) {
    logger.warn('Failed to ensure email column for license table', { error: error.message });
  } finally {
    licenseSchemaChecked = true;
  }

  return licenseSchemaInfo;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function normalizeEmail(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

/**
 * Validate email for license registration.
 *
 * @param {string} email - User email
 * @returns {{valid: boolean, error?: string}}
 */
function validateEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { valid: false, error: 'Email is required' };
  }

  if (!EMAIL_REGEX.test(normalized)) {
    return { valid: false, error: 'Email must be a valid address' };
  }

  return { valid: true };
}

/**
 * Generate a unique device hash based on hardware identifiers.
 * Uses hostname, platform, CPU model, and total RAM.
 *
 * @returns {string} SHA-256 hash of device identifiers
 */
function generateDeviceHash() {
  const hostname = os.hostname();
  const platform = os.platform();
  const arch = os.arch();
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
  const totalMem = os.totalmem();

  const identifier = `${hostname}|${platform}|${arch}|${cpuModel}|${totalMem}`;
  return crypto.createHash('sha256').update(identifier).digest('hex');
}

/**
 * Get the device name for display purposes.
 *
 * @returns {string} Human-readable device name
 */
function getDeviceName() {
  const hostname = os.hostname();
  const platform = os.platform();
  const platformNames = {
    darwin: 'macOS',
    win32: 'Windows',
    linux: 'Linux',
  };
  return `${hostname} (${platformNames[platform] || platform})`;
}

/**
 * Get the local license record from SQLite.
 *
 * @returns {Promise<Object|null>} License record or null if not found
 */
async function getLocalLicense() {
  try {
    const result = await dbManager.query('SELECT * FROM license WHERE id = 1');
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    logger.error('Failed to get local license', { error: error.message });
    return null;
  }
}

/**
 * Register a new license with email.
 *
 * @param {string} email - User email
 * @returns {Promise<{success: boolean, error?: string, license?: Object}>}
 */
async function registerLicense(email) {
  // Validate the email
  const validation = validateEmail(email);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const cleanEmail = normalizeEmail(email);
  const schemaInfo = await ensureEmailColumn();
  const includeLegacyId = !schemaInfo.teudatZehutNullable;
  const deviceHash = generateDeviceHash();
  const uniqueId = uuidv4();
  const now = new Date().toISOString();
  const appVersion = app.getVersion();

  // Check if already registered locally
  const existingLicense = await getLocalLicense();
  if (existingLicense) {
    return {
      success: false,
      error: 'A license is already registered on this device',
    };
  }

  // Try to register with Supabase first (if configured)
  let syncedToCloud = false;
  let syncError = null;

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const basePayload = {
          unique_id: uniqueId,
          device_hash: deviceHash,
          device_name: getDeviceName(),
          installation_date: now,
          trial_start_date: now,
          license_status: 'trial',
          last_validated_at: now,
          app_version: appVersion,
          os_platform: os.platform(),
        };

        let { error } = await supabase.from('licenses').insert({
          ...basePayload,
          email: cleanEmail,
        });

        if (error && isMissingColumnError(error, 'email')) {
          const retry = await supabase.from('licenses').insert({
            ...basePayload,
            teudat_zehut: cleanEmail,
          });
          error = retry.error;
        }

        if (error) {
          // Check for single-device constraint violation
          if (error.message.includes('already registered')) {
            return {
              success: false,
              error: 'This email is already registered on another device. Each license is limited to a single device.',
            };
          }
          syncError = error.message;
          logger.warn('Failed to sync license to Supabase', { error: error.message });
        } else {
          syncedToCloud = true;
          logger.info('License registered in Supabase', { uniqueId });
        }
      } catch (error) {
        syncError = error.message;
        logger.error('Supabase registration error', { error: error.message });
      }
    }
  }

  // Save locally
  try {
    const insertColumns = includeLegacyId
      ? `id, unique_id, email, teudat_zehut, device_hash,
        installation_date, trial_start_date, license_type,
        last_online_validation, is_synced_to_cloud, sync_error_message,
        app_version, created_at, updated_at`
      : `id, unique_id, email, device_hash,
        installation_date, trial_start_date, license_type,
        last_online_validation, is_synced_to_cloud, sync_error_message,
        app_version, created_at, updated_at`;

    const insertValues = includeLegacyId
      ? [
          uniqueId,
          cleanEmail,
          cleanEmail,
          deviceHash,
          now,
          now,
          syncedToCloud ? now : null,
          syncedToCloud ? 1 : 0,
          syncError,
          appVersion,
          now,
          now,
        ]
      : [
          uniqueId,
          cleanEmail,
          deviceHash,
          now,
          now,
          syncedToCloud ? now : null,
          syncedToCloud ? 1 : 0,
          syncError,
          appVersion,
          now,
          now,
        ];

    const insertPlaceholders = includeLegacyId
      ? "1, ?, ?, ?, ?, ?, ?, 'trial', ?, ?, ?, ?, ?, ?"
      : "1, ?, ?, ?, ?, ?, 'trial', ?, ?, ?, ?, ?, ?";

    await dbManager.query(
      `INSERT INTO license (
        ${insertColumns}
      ) VALUES (${insertPlaceholders})`,
      insertValues,
    );

    const license = await getLocalLicense();
    logger.info('License registered locally', {
      uniqueId,
      syncedToCloud,
    });

    return {
      success: true,
      license: {
        ...license,
        trialDaysRemaining: TRIAL_DAYS,
        syncedToCloud,
      },
    };
  } catch (error) {
    logger.error('Failed to save license locally', { error: error.message });
    return { success: false, error: 'Failed to save license' };
  }
}

/**
 * Check the current license status.
 *
 * @returns {Promise<{
 *   registered: boolean,
 *   licenseType: 'trial'|'pro'|'expired'|'none',
 *   trialDaysRemaining?: number,
 *   isReadOnly: boolean,
 *   canWrite: boolean,
 *   offlineMode: boolean,
 *   offlineGraceDaysRemaining?: number,
 *   syncedToCloud: boolean,
 *   lastValidated?: string,
 *   email?: string
 * }>}
 */
async function checkLicenseStatus() {
  return getPublicAccessStatus();
}

/**
 * Validate license online with Supabase.
 *
 * @returns {Promise<{success: boolean, error?: string, status?: Object}>}
 */
async function validateOnline() {
  // Online validation is no longer required for public access.
  return {
    success: true,
    status: await checkLicenseStatus(),
  };
}

/**
 * Activate Pro license after payment.
 *
 * @param {string} paymentRef - Payment reference (optional)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function activateProLicense(paymentRef = null) {
  const license = await getLocalLicense();
  if (!license) {
    return { success: false, error: 'No license registered' };
  }

  const now = new Date().toISOString();

  // Update locally
  try {
    await dbManager.query(
      `UPDATE license SET
        license_type = 'pro',
        subscription_date = ?,
        updated_at = ?
      WHERE id = 1`,
      [now, now]
    );

    // Sync to cloud if available
    if (isSupabaseConfigured()) {
      const supabase = getSupabaseClient();
      if (supabase) {
        await supabase
          .from('licenses')
          .update({
            license_status: 'active',
            subscription_date: now,
            payment_reference: paymentRef,
            updated_at: now,
          })
          .eq('unique_id', license.unique_id);
      }
    }

    logger.info('Pro license activated', { paymentRef });
    return { success: true };
  } catch (error) {
    logger.error('Failed to activate Pro license', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Check if write operations are allowed.
 *
 * @returns {Promise<boolean>}
 */
async function isWriteOperationAllowed() {
  return isPublicWriteAllowed();
}

/**
 * Get full license info for diagnostics/debugging.
 *
 * @returns {Promise<Object>}
 */
async function getLicenseInfo() {
  const license = await getLocalLicense();
  const status = await checkLicenseStatus();
  return {
    ...status,
    deviceHash: generateDeviceHash().substring(0, 16) + '...',
    deviceName: getDeviceName(),
    supabaseConfigured: isSupabaseConfigured(),
    uniqueId: license?.unique_id?.substring(0, 8) + '...',
  };
}

module.exports = {
  validateEmail,
  generateDeviceHash,
  getDeviceName,
  registerLicense,
  checkLicenseStatus,
  validateOnline,
  activateProLicense,
  isWriteOperationAllowed,
  getLicenseInfo,
  getLocalLicense,
  // Constants for testing
  TRIAL_DAYS,
  OFFLINE_GRACE_DAYS,
  PUBLIC_ACCESS_STATUS,
};
