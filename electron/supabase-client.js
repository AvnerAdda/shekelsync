/**
 * Supabase client singleton for Electron main process.
 *
 * Provides authenticated access to the Supabase licenses table
 * for license validation and registration.
 */

const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');
const { nodeModulesPath } = require('./paths');

let supabaseClient = null;
let createClient = null;

/**
 * Get all possible paths where @supabase/supabase-js might be located.
 */
function getSupabasePaths() {
  const paths = [];

  // 1. nodeModulesPath from paths.js
  paths.push(path.join(nodeModulesPath, '@supabase', 'supabase-js'));

  // 2. Relative to this file (electron folder) going up to app/node_modules
  paths.push(path.join(__dirname, '..', 'app', 'node_modules', '@supabase', 'supabase-js'));
  paths.push(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));

  // 3. For packaged apps - check various resource paths
  try {
    const { app } = require('electron');
    if (app) {
      const appPath = app.getAppPath();
      paths.push(path.join(appPath, 'node_modules', '@supabase', 'supabase-js'));
      paths.push(path.join(appPath, '..', 'node_modules', '@supabase', 'supabase-js'));

      // For ASAR unpacked
      if (appPath.includes('.asar')) {
        const unpackedPath = appPath.replace('.asar', '.asar.unpacked');
        paths.push(path.join(unpackedPath, 'node_modules', '@supabase', 'supabase-js'));
      }

      // Resources path
      const resourcesPath = process.resourcesPath;
      if (resourcesPath) {
        paths.push(path.join(resourcesPath, 'app', 'node_modules', '@supabase', 'supabase-js'));
        paths.push(path.join(resourcesPath, 'node_modules', '@supabase', 'supabase-js'));
      }
    }
  } catch {
    // Not in Electron context or app not ready
  }

  return paths;
}

/**
 * Lazy load the Supabase library to avoid module resolution issues
 * in packaged builds where module paths may not be set up yet.
 */
function loadSupabaseLib() {
  if (createClient) return true;

  // Try standard require first
  try {
    const supabase = require('@supabase/supabase-js');
    createClient = supabase.createClient;
    logger.info('Loaded @supabase/supabase-js via standard require');
    return true;
  } catch (standardError) {
    logger.debug('Standard require failed for @supabase/supabase-js', { error: standardError.message });
  }

  // Try explicit paths
  const possiblePaths = getSupabasePaths();
  for (const supabasePath of possiblePaths) {
    try {
      if (fs.existsSync(supabasePath)) {
        const supabase = require(supabasePath);
        createClient = supabase.createClient;
        logger.info('Loaded @supabase/supabase-js from explicit path', { path: supabasePath });
        return true;
      }
    } catch (pathError) {
      logger.debug('Failed to load from path', { path: supabasePath, error: pathError.message });
    }
  }

  logger.warn('Failed to load @supabase/supabase-js from any path', {
    triedPaths: possiblePaths,
    nodeModulesPath,
  });
  return false;
}

/**
 * Get or create the Supabase client singleton.
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    logger.warn('Supabase credentials not configured. License validation will work offline only.', {
      hasUrl: Boolean(supabaseUrl),
      hasKey: Boolean(supabaseAnonKey),
    });
    return null;
  }

  // Lazy load the Supabase library
  if (!loadSupabaseLib()) {
    logger.error('Supabase library not available');
    return null;
  }

  try {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          'X-Client-Info': 'shekelsync-electron',
        },
      },
    });
    logger.info('Supabase client initialized successfully');
    return supabaseClient;
  } catch (error) {
    logger.error('Failed to initialize Supabase client', { error: error.message });
    return null;
  }
}

/**
 * Check if Supabase is configured and available.
 * @returns {boolean}
 */
function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

/**
 * Test connection to Supabase.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function testConnection() {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase not configured' };
  }

  try {
    // Simple health check query
    const { error } = await client
      .from('licenses')
      .select('id')
      .limit(1);

    if (error) {
      logger.warn('Supabase connection test failed', { error: error.message });
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    logger.error('Supabase connection test error', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Reset the client (useful for testing or reconnection).
 */
function resetClient() {
  supabaseClient = null;
}

module.exports = {
  getSupabaseClient,
  isSupabaseConfigured,
  testConnection,
  resetClient,
};
