/**
 * Supabase client singleton for Electron main process.
 *
 * Provides authenticated access to the Supabase licenses table
 * for license validation and registration.
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('./logger');

let supabaseClient = null;

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
