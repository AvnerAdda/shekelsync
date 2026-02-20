const crypto = require('crypto');
const os = require('os');
const path = require('path');

const database = require('./database.js');

const DEFAULT_DONATION_URL = 'https://buymeacoffee.com/shekelsync';

const DONATION_THRESHOLDS = Object.freeze({
  bronze: 50,
  silver: 150,
  gold: 500,
});

const SUPPORTER_TIER_VALUES = Object.freeze([
  'none',
  'one_time',
  'bronze',
  'silver',
  'gold',
  'lifetime',
]);

const PLAN_VALUES = Object.freeze([
  'one_time',
  'bronze',
  'silver',
  'gold',
  'lifetime',
]);

const SUPPORT_VERIFICATION_VALUES = Object.freeze([
  'none',
  'pending',
  'verified',
  'rejected',
]);

const SUPPORTER_PLANS = Object.freeze([
  {
    key: 'bronze',
    tier: 'bronze',
    title: 'Bronze Level',
    trialLabel: '7 days free trial',
    priceLabel: '$5 per month',
    billingCycle: 'monthly',
    amountUsd: 5,
    rewards: [
      'Access to AI Agent',
      'Support me on a monthly basis',
      'Unlock exclusive posts and messages',
      'Work in progress updates',
      'Early access',
    ],
    aiAccessLevel: 'standard',
  },
  {
    key: 'silver',
    tier: 'silver',
    title: 'Silver Level',
    trialLabel: '7 days free trial',
    priceLabel: '$10 per month',
    billingCycle: 'monthly',
    amountUsd: 10,
    rewards: [
      'Prioritary Feature Development',
      'Extended Access to AI Agent',
      'Support me on a monthly basis',
      'Unlock exclusive posts and messages',
      'Work in progress updates',
      'Early access',
    ],
    aiAccessLevel: 'extended',
  },
  {
    key: 'gold',
    tier: 'gold',
    title: 'Gold Level',
    trialLabel: '7 days free trial',
    priceLabel: '$20 per month',
    billingCycle: 'monthly',
    amountUsd: 20,
    rewards: [
      'Unlimited access to AI Agent',
      'Prioritary Feature Development',
      'Support me on a monthly basis',
      'Unlock exclusive posts and messages',
      'Early access',
      'Work in progress updates',
    ],
    aiAccessLevel: 'unlimited',
  },
  {
    key: 'lifetime',
    tier: 'lifetime',
    title: 'Lifetime Access',
    trialLabel: null,
    priceLabel: 'Lifetime access',
    billingCycle: 'lifetime',
    amountUsd: null,
    rewards: [
      'Prioritary Feature Development',
      'Unlimited access to AI Agent',
      'Lifetime discount on shop items',
      'Lifetime access to exclusive content',
      'Early access',
      'Work in progress updates',
    ],
    aiAccessLevel: 'unlimited',
  },
  {
    key: 'one_time',
    tier: 'one_time',
    title: 'One-Time Support',
    trialLabel: null,
    priceLabel: 'One-time payment',
    billingCycle: 'one_time',
    amountUsd: null,
    rewards: [
      'Support development with a one-time payment',
      'Thank-you mention in supporter status',
    ],
    aiAccessLevel: 'none',
  },
]);

const PLAN_LOOKUP = new Map(SUPPORTER_PLANS.map((plan) => [plan.key, plan]));

let databaseRef = database;
let donationSchemaEnsured = false;
let supabaseCreateClient = null;
let supabaseAdminClient = null;
let supabaseAuthClient = null;

function __setDatabase(db) {
  databaseRef = db || database;
  donationSchemaEnsured = false;
}

function __resetDatabase() {
  databaseRef = database;
  donationSchemaEnsured = false;
  supabaseAdminClient = null;
  supabaseAuthClient = null;
}

function __setSupabaseClients({ adminClient, authClient, createClient } = {}) {
  if (adminClient !== undefined) {
    supabaseAdminClient = adminClient;
  }
  if (authClient !== undefined) {
    supabaseAuthClient = authClient;
  }
  if (createClient !== undefined) {
    supabaseCreateClient = createClient;
  }
}

function getDatabase() {
  return databaseRef || database;
}

function createServiceError(message, status = 500, code) {
  const error = new Error(message);
  error.status = status;
  if (code) {
    error.code = code;
  }
  return error;
}

function normalizeText(value, maxLen = 1024) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLen);
}

function normalizeEmail(value) {
  const normalized = normalizeText(value, 320);
  return normalized ? normalized.toLowerCase() : null;
}

function isMissingSupabaseTableError(message, tableName) {
  const normalized = String(message || '').toLowerCase();
  if (!normalized) {
    return false;
  }

  const normalizedTable = String(tableName || '').toLowerCase();
  const hasTableHint = normalizedTable
    ? normalized.includes(normalizedTable) || normalized.includes(`public.${normalizedTable}`)
    : true;

  return hasTableHint && (
    normalized.includes('could not find the table')
    || normalized.includes('schema cache')
    || normalized.includes('does not exist')
    || normalized.includes('42p01')
  );
}

function resolveDonationUrl(planKey = null) {
  const configured = typeof process.env.DONATION_URL === 'string' ? process.env.DONATION_URL.trim() : '';
  const baseUrl = configured || DEFAULT_DONATION_URL;

  try {
    const parsed = new URL(baseUrl);
    parsed.searchParams.set('utm_source', 'shekelsync');
    parsed.searchParams.set('utm_medium', 'desktop_app');
    if (planKey && PLAN_LOOKUP.has(planKey)) {
      parsed.searchParams.set('plan', planKey);
    }
    return parsed.toString();
  } catch {
    return DEFAULT_DONATION_URL;
  }
}

function getCurrentMonthKey(inputDate = new Date()) {
  const year = inputDate.getFullYear();
  const month = String(inputDate.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function normalizeMonthKey(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return getCurrentMonthKey();
  }

  if (typeof rawValue !== 'string') {
    throw createServiceError('monthKey must be a string in YYYY-MM format', 400);
  }

  const monthKey = rawValue.trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    throw createServiceError('monthKey must be in YYYY-MM format', 400);
  }

  return monthKey;
}

function normalizeAmount(rawValue) {
  const parsed = typeof rawValue === 'string' ? Number(rawValue.trim()) : Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createServiceError('Donation amount must be a positive number', 400);
  }
  return Math.round(parsed * 100) / 100;
}

function normalizePlanKey(rawValue) {
  if (typeof rawValue !== 'string') {
    throw createServiceError('planKey is required', 400);
  }

  const normalized = rawValue.trim().toLowerCase();
  if (!PLAN_VALUES.includes(normalized)) {
    throw createServiceError('planKey must be one of: one_time, bronze, silver, gold, lifetime', 400);
  }

  return normalized;
}

function normalizeDonationTier(rawValue) {
  if (typeof rawValue !== 'string') {
    return 'none';
  }
  const normalized = rawValue.trim().toLowerCase();
  return SUPPORTER_TIER_VALUES.includes(normalized) ? normalized : 'none';
}

function normalizeSupportStatus(rawValue) {
  if (typeof rawValue !== 'string') {
    return 'none';
  }

  const normalized = rawValue.trim().toLowerCase();
  if (SUPPORT_VERIFICATION_VALUES.includes(normalized)) {
    return normalized;
  }
  if (normalized === 'active') {
    return 'verified';
  }
  if (normalized === 'declined') {
    return 'rejected';
  }
  if (normalized === 'clicked') {
    return 'pending';
  }

  return 'none';
}

function normalizeBillingCycle(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'monthly' || normalized === 'one_time' || normalized === 'lifetime') {
    return normalized;
  }
  return null;
}

function getDonationTier(totalAmountIls) {
  if (totalAmountIls >= DONATION_THRESHOLDS.gold) return 'gold';
  if (totalAmountIls >= DONATION_THRESHOLDS.silver) return 'silver';
  if (totalAmountIls >= DONATION_THRESHOLDS.bronze) return 'bronze';
  return 'none';
}

function getAiAccessLevelFromTier(tier, supportStatus = 'none') {
  if (supportStatus !== 'verified') {
    return 'none';
  }

  switch (tier) {
    case 'gold':
    case 'lifetime':
      return 'unlimited';
    case 'silver':
      return 'extended';
    case 'bronze':
      return 'standard';
    default:
      return 'none';
  }
}

function hasAiAccess(tier, supportStatus = 'none') {
  if (supportStatus !== 'verified') {
    return false;
  }
  return tier === 'bronze' || tier === 'silver' || tier === 'gold' || tier === 'lifetime';
}

function isAnonymizedSqliteDatabase() {
  const dbPath = normalizeText(process.env.SQLITE_DB_PATH, 2048);
  if (!dbPath) {
    return false;
  }
  return path.basename(String(dbPath)).toLowerCase().includes('anonymized');
}

function applyDemoAiAccessOverride(status) {
  if (!status || !isAnonymizedSqliteDatabase() || status.canAccessAiAgent) {
    return status;
  }

  const bronzePlan = PLAN_LOOKUP.get('bronze');
  const defaultAmountUsd = Number(bronzePlan?.amountUsd || 5);
  const totalAmountUsd = Number.isFinite(status.totalAmountUsd)
    ? Number(status.totalAmountUsd)
    : defaultAmountUsd;

  return {
    ...status,
    hasDonated: true,
    tier: 'bronze',
    supportStatus: 'verified',
    totalAmountUsd: Math.max(0, Math.round(totalAmountUsd * 100) / 100),
    currentPlanKey: 'bronze',
    hasPendingVerification: false,
    pendingPlanKey: null,
    billingCycle: bronzePlan?.billingCycle || 'monthly',
    canAccessAiAgent: true,
    aiAgentAccessLevel: bronzePlan?.aiAccessLevel || 'standard',
  };
}

function getEntitlementsTableName() {
  const value = normalizeText(process.env.SUPABASE_SUPPORTER_ENTITLEMENTS_TABLE, 128);
  return value && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) ? value : 'supporter_entitlements';
}

function getIntentsTableName() {
  const value = normalizeText(process.env.SUPABASE_SUPPORTER_INTENTS_TABLE, 128);
  return value && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) ? value : 'supporter_intents';
}

function loadSupabaseCreateClient() {
  if (supabaseCreateClient) {
    return supabaseCreateClient;
  }

  try {
    // eslint-disable-next-line global-require
    const supabase = require('@supabase/supabase-js');
    supabaseCreateClient = supabase.createClient;
    return supabaseCreateClient;
  } catch {
    return null;
  }
}

function createSupabaseClientOrNull(key) {
  const url = normalizeText(process.env.SUPABASE_URL, 2048);
  if (!url || !key) {
    return null;
  }

  const createClient = loadSupabaseCreateClient();
  if (!createClient) {
    return null;
  }

  try {
    return createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          'X-Client-Info': 'shekelsync-donations-service',
        },
      },
    });
  } catch {
    return null;
  }
}

function getSupabaseAdminClient() {
  if (supabaseAdminClient) {
    return supabaseAdminClient;
  }

  const serviceKey = normalizeText(process.env.SUPABASE_SERVICE_ROLE_KEY, 4096);
  const anonKey = normalizeText(process.env.SUPABASE_ANON_KEY, 4096);
  const client = createSupabaseClientOrNull(serviceKey || anonKey);
  supabaseAdminClient = client;
  return client;
}

function getSupabaseAuthClient() {
  if (supabaseAuthClient) {
    return supabaseAuthClient;
  }

  const anonKey = normalizeText(process.env.SUPABASE_ANON_KEY, 4096);
  const serviceKey = normalizeText(process.env.SUPABASE_SERVICE_ROLE_KEY, 4096);
  const client = createSupabaseClientOrNull(anonKey || serviceKey);
  supabaseAuthClient = client;
  return client;
}

function normalizeSupportContext(context = {}) {
  const accessToken = normalizeText(context.accessToken, 4096);
  const userId = normalizeText(context.userId, 255);
  const email = normalizeEmail(context.email);
  const name = normalizeText(context.name, 255);

  return {
    accessToken,
    userId,
    email,
    name,
  };
}

function isTruthy(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function shouldRequireAuthenticatedSupportIdentity() {
  return isTruthy(process.env.SUPPORTER_REQUIRE_AUTH);
}

function buildAnonymousIdentity(context = {}) {
  const explicitUserId = normalizeText(process.env.SUPPORTER_ANONYMOUS_ID, 255);
  const fallbackSeed = [
    normalizeText(process.env.SQLITE_DB_PATH, 1024) || '',
    normalizeText(os.hostname(), 255) || '',
    normalizeText(process.cwd(), 1024) || '',
  ].join('|');

  const digest = crypto
    .createHash('sha256')
    .update(explicitUserId || fallbackSeed || 'shekelsync-anonymous-support')
    .digest('hex')
    .slice(0, 24);

  return {
    userId: explicitUserId || `anon-${digest}`,
    email: normalizeEmail(context.email),
    name: normalizeText(context.name, 255) || 'Anonymous Supporter',
    verifiedByToken: false,
    isAnonymous: true,
  };
}

async function resolveRequesterIdentity(context = {}, options = {}) {
  const normalizedContext = normalizeSupportContext(context);

  if (normalizedContext.accessToken) {
    const authClient = getSupabaseAuthClient();
    if (authClient?.auth?.getUser) {
      try {
        const { data, error } = await authClient.auth.getUser(normalizedContext.accessToken);
        if (!error && data?.user) {
          const user = data.user;
          return {
            userId: normalizeText(user.id, 255) || normalizedContext.userId,
            email: normalizeEmail(user.email) || normalizedContext.email,
            name: normalizeText(user.user_metadata?.full_name || user.user_metadata?.name || normalizedContext.name, 255),
            verifiedByToken: true,
          };
        }
      } catch {
        // Ignore token verification failures and fallback to session headers.
      }
    }
  }

  if (normalizedContext.userId || normalizedContext.email) {
    return {
      userId: normalizedContext.userId || normalizedContext.email,
      email: normalizedContext.email,
      name: normalizedContext.name,
      verifiedByToken: false,
      isAnonymous: false,
    };
  }

  const allowAnonymous = options.allowAnonymous !== false;
  if (allowAnonymous && !shouldRequireAuthenticatedSupportIdentity()) {
    return buildAnonymousIdentity(normalizedContext);
  }

  return null;
}

async function ensureDonationSchema(client) {
  if (donationSchemaEnsured) {
    return;
  }

  await client.query(
    `CREATE TABLE IF NOT EXISTS donation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_ils REAL NOT NULL CHECK (amount_ils > 0),
      donated_at TEXT NOT NULL,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    )`,
  );

  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_donation_events_donated_at
       ON donation_events (donated_at DESC)`,
  );

  await client.query(
    `CREATE TABLE IF NOT EXISTS donation_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_reminder_month_key TEXT,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    )`,
  );

  await client.query(
    `INSERT INTO donation_meta (id, last_reminder_month_key, created_at, updated_at)
     VALUES (1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO NOTHING`,
  );

  donationSchemaEnsured = true;
}

async function withClient(run) {
  const client = await getDatabase().getClient();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

async function getReminderState(client) {
  const currentMonthKey = getCurrentMonthKey();

  const reminderResult = await client.query(
    `SELECT last_reminder_month_key
       FROM donation_meta
      WHERE id = 1
      LIMIT 1`,
  );

  const reminderMonthKey = reminderResult.rows[0]?.last_reminder_month_key || null;
  const reminderShownThisMonth = reminderMonthKey === currentMonthKey;

  return {
    currentMonthKey,
    reminderShownThisMonth,
  };
}

async function getLegacyDonationSnapshot(client) {
  const totalResult = await client.query(
    `SELECT COALESCE(SUM(amount_ils), 0) AS total_amount_ils
       FROM donation_events`,
  );

  const totalAmountRaw = Number.parseFloat(totalResult.rows[0]?.total_amount_ils || 0);
  const totalAmountIls = Number.isFinite(totalAmountRaw)
    ? Math.round(totalAmountRaw * 100) / 100
    : 0;

  if (totalAmountIls <= 0) {
    return {
      hasDonated: false,
      tier: 'none',
      supportStatus: 'none',
      totalAmountUsd: 0,
      currentPlanKey: null,
      hasPendingVerification: false,
      pendingPlanKey: null,
      lastVerifiedAt: null,
      billingCycle: null,
      canAccessAiAgent: false,
      aiAgentAccessLevel: 'none',
    };
  }

  return {
    hasDonated: true,
    tier: 'one_time',
    supportStatus: 'verified',
    totalAmountUsd: totalAmountIls,
    currentPlanKey: 'one_time',
    hasPendingVerification: false,
    pendingPlanKey: null,
    lastVerifiedAt: null,
    billingCycle: 'one_time',
    canAccessAiAgent: false,
    aiAgentAccessLevel: 'none',
  };
}

async function fetchLatestEntitlement(identity) {
  const client = getSupabaseAdminClient();
  if (!client || !identity || (!identity.userId && !identity.email)) {
    return null;
  }

  const tableName = getEntitlementsTableName();

  if (identity.userId) {
    const userIdResult = await client
      .from(tableName)
      .select('*')
      .eq('user_id', identity.userId)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (userIdResult.error) {
      throw createServiceError(`Supabase entitlement lookup failed: ${userIdResult.error.message}`, 502, 'SUPABASE_QUERY_FAILED');
    }

    if (Array.isArray(userIdResult.data) && userIdResult.data.length > 0) {
      return userIdResult.data[0];
    }
  }

  if (identity.email) {
    const emailResult = await client
      .from(tableName)
      .select('*')
      .eq('email', identity.email)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (emailResult.error) {
      throw createServiceError(`Supabase entitlement lookup failed: ${emailResult.error.message}`, 502, 'SUPABASE_QUERY_FAILED');
    }

    if (Array.isArray(emailResult.data) && emailResult.data.length > 0) {
      return emailResult.data[0];
    }
  }

  return null;
}

async function fetchLatestPendingIntent(identity) {
  const client = getSupabaseAdminClient();
  if (!client || !identity || (!identity.userId && !identity.email)) {
    return null;
  }

  const tableName = getIntentsTableName();

  const fetchByColumn = async (column, value) => {
    const result = await client
      .from(tableName)
      .select('*')
      .eq(column, value)
      .in('status', ['clicked', 'pending'])
      .order('updated_at', { ascending: false })
      .limit(1);

    if (result.error) {
      throw createServiceError(`Supabase intent lookup failed: ${result.error.message}`, 502, 'SUPABASE_QUERY_FAILED');
    }

    return Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;
  };

  if (identity.userId) {
    const pendingByUser = await fetchByColumn('user_id', identity.userId);
    if (pendingByUser) {
      return pendingByUser;
    }
  }

  if (identity.email) {
    const pendingByEmail = await fetchByColumn('email', identity.email);
    if (pendingByEmail) {
      return pendingByEmail;
    }
  }

  return null;
}

function normalizeEntitlementSnapshot(entitlement, pendingIntent) {
  const normalizedTier = normalizeDonationTier(entitlement?.tier);
  const normalizedPlanKey = PLAN_VALUES.includes(entitlement?.plan_key)
    ? entitlement.plan_key
    : PLAN_VALUES.includes(entitlement?.plan)
      ? entitlement.plan
      : PLAN_VALUES.includes(pendingIntent?.plan_key)
        ? pendingIntent.plan_key
        : null;

  const normalizedStatus = normalizeSupportStatus(entitlement?.status || entitlement?.verification_status);
  const hasVerified = normalizedStatus === 'verified' && normalizedTier !== 'none';

  const planForTier = normalizedPlanKey && PLAN_LOOKUP.has(normalizedPlanKey)
    ? PLAN_LOOKUP.get(normalizedPlanKey)
    : SUPPORTER_PLANS.find((plan) => plan.tier === normalizedTier) || null;

  const pendingPlanKey = PLAN_VALUES.includes(pendingIntent?.plan_key)
    ? pendingIntent.plan_key
    : null;

  const hasPendingVerification = !hasVerified && (normalizedStatus === 'pending' || Boolean(pendingPlanKey));

  const supportStatus = hasVerified
    ? 'verified'
    : hasPendingVerification
      ? 'pending'
      : normalizedStatus === 'rejected'
        ? 'rejected'
        : 'none';

  const selectedTier = hasVerified ? normalizedTier : 'none';
  const billingCycle = normalizeBillingCycle(entitlement?.billing_cycle) || planForTier?.billingCycle || null;

  let totalAmountUsd = Number.parseFloat(entitlement?.amount_usd || entitlement?.amount || 0);
  if (!Number.isFinite(totalAmountUsd) || totalAmountUsd < 0) {
    totalAmountUsd = 0;
  }
  if (totalAmountUsd === 0 && hasVerified && planForTier && Number.isFinite(planForTier.amountUsd || NaN)) {
    totalAmountUsd = Number(planForTier.amountUsd);
  }

  const aiAgentAccessLevel = getAiAccessLevelFromTier(selectedTier, supportStatus);

  return {
    hasDonated: hasVerified,
    tier: selectedTier,
    supportStatus,
    totalAmountUsd: Math.round(totalAmountUsd * 100) / 100,
    currentPlanKey: hasVerified
      ? (PLAN_VALUES.includes(normalizedPlanKey) ? normalizedPlanKey : planForTier?.key || null)
      : null,
    hasPendingVerification,
    pendingPlanKey,
    lastVerifiedAt: hasVerified
      ? normalizeText(entitlement?.verified_at || entitlement?.updated_at || entitlement?.created_at, 64)
      : null,
    billingCycle,
    canAccessAiAgent: hasAiAccess(selectedTier, supportStatus),
    aiAgentAccessLevel,
  };
}

async function getSupportStatusSnapshot(client, context = {}) {
  const identity = await resolveRequesterIdentity(context, { allowAnonymous: true });

  if (!getSupabaseAdminClient() || !identity) {
    const legacySnapshot = await getLegacyDonationSnapshot(client);
    return applyDemoAiAccessOverride(legacySnapshot);
  }

  let entitlement = null;
  let pendingIntent = null;

  try {
    entitlement = await fetchLatestEntitlement(identity);
    pendingIntent = await fetchLatestPendingIntent(identity);
  } catch (error) {
    // If Supabase tables are unavailable, fall back to local legacy data.
    if (error?.code === 'SUPABASE_QUERY_FAILED') {
      const legacySnapshot = await getLegacyDonationSnapshot(client);
      return applyDemoAiAccessOverride(legacySnapshot);
    }
    throw error;
  }

  const normalized = normalizeEntitlementSnapshot(entitlement, pendingIntent);
  const withRequester = {
    ...normalized,
    requester: {
      userId: identity.userId || null,
      email: identity.email || null,
      verifiedByToken: Boolean(identity.verifiedByToken),
    },
  };
  return applyDemoAiAccessOverride(withRequester);
}

function buildStatusPayload({
  reminder,
  support,
}) {
  const shouldShowMonthlyReminder = (support.supportStatus === 'none' || support.supportStatus === 'rejected')
    && !support.hasPendingVerification
    && !reminder.reminderShownThisMonth;

  return {
    hasDonated: Boolean(support.hasDonated),
    tier: normalizeDonationTier(support.tier),
    supportStatus: normalizeSupportStatus(support.supportStatus),
    totalAmountUsd: Number.isFinite(support.totalAmountUsd) ? support.totalAmountUsd : 0,
    currentPlanKey: support.currentPlanKey || null,
    pendingPlanKey: support.pendingPlanKey || null,
    hasPendingVerification: Boolean(support.hasPendingVerification),
    lastVerifiedAt: support.lastVerifiedAt || null,
    billingCycle: support.billingCycle || null,
    canAccessAiAgent: Boolean(support.canAccessAiAgent),
    aiAgentAccessLevel: support.aiAgentAccessLevel || 'none',
    plans: SUPPORTER_PLANS,
    currentMonthKey: reminder.currentMonthKey,
    reminderShownThisMonth: reminder.reminderShownThisMonth,
    shouldShowMonthlyReminder,
    donationUrl: resolveDonationUrl(support.currentPlanKey || support.pendingPlanKey || null),
  };
}

async function getDonationStatusFromClient(client, context = {}) {
  await ensureDonationSchema(client);

  const reminder = await getReminderState(client);
  const support = await getSupportStatusSnapshot(client, context);

  return buildStatusPayload({
    reminder,
    support,
  });
}

async function getDonationStatus(context = {}) {
  return withClient((client) => getDonationStatusFromClient(client, context));
}

async function createSupportIntent(payload = {}, context = {}) {
  const planKey = normalizePlanKey(payload.planKey);
  const note = normalizeText(payload.note, 1000);
  const source = normalizeText(payload.source, 64) || 'app_click';

  const identity = await resolveRequesterIdentity(context, { allowAnonymous: true });
  if (!identity) {
    throw createServiceError('Please sign in before selecting a support plan.', 401, 'AUTH_REQUIRED');
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw createServiceError(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to record support intents.',
      503,
      'SUPABASE_NOT_CONFIGURED',
    );
  }

  const tableName = getIntentsTableName();
  const now = new Date().toISOString();

  const { error } = await supabase.from(tableName).insert({
    user_id: identity.userId || identity.email,
    email: identity.email || null,
    plan_key: planKey,
    status: 'pending',
    provider: 'buy_me_a_coffee',
    source,
    note,
    created_at: now,
    updated_at: now,
  });

  if (error) {
    if (isMissingSupabaseTableError(error.message, tableName)) {
      throw createServiceError(
        `Missing Supabase table "${tableName}". Run SQL setup from docs/supabase-supporter-program.md and refresh the Supabase schema cache.`,
        503,
        'SUPABASE_SCHEMA_MISSING',
      );
    }
    throw createServiceError(`Failed to record support intent: ${error.message}`, 502, 'SUPABASE_WRITE_FAILED');
  }

  const status = await getDonationStatus(context);
  return {
    ...status,
    checkoutUrl: resolveDonationUrl(planKey),
  };
}

async function addDonationEvent(payload = {}, context = {}) {
  // Legacy compatibility path: manual amount recording when used by older clients/tests.
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'planKey')) {
    return createSupportIntent(payload, context);
  }

  const amount = normalizeAmount(payload.amount);
  const donatedAt = normalizeText(payload.donatedAt, 64) || new Date().toISOString();
  const note = normalizeText(payload.note, 1000);

  return withClient(async (client) => {
    await ensureDonationSchema(client);

    await client.query(
      `INSERT INTO donation_events (amount_ils, donated_at, note, source, created_at)
       VALUES ($1, $2, $3, 'manual', CURRENT_TIMESTAMP)`,
      [amount, donatedAt, note],
    );

    return getDonationStatusFromClient(client, context);
  });
}

async function markMonthlyReminderShown(payload = {}, context = {}) {
  const monthKey = normalizeMonthKey(payload.monthKey);

  return withClient(async (client) => {
    await ensureDonationSchema(client);

    await client.query(
      `INSERT INTO donation_meta (id, last_reminder_month_key, created_at, updated_at)
       VALUES (1, $1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE
       SET last_reminder_month_key = EXCLUDED.last_reminder_month_key,
           updated_at = CURRENT_TIMESTAMP`,
      [monthKey],
    );

    return getDonationStatusFromClient(client, context);
  });
}

module.exports = {
  getDonationStatus,
  createSupportIntent,
  addDonationEvent,
  markMonthlyReminderShown,
  __setDatabase,
  __resetDatabase,
  __setSupabaseClients,
  getDonationTier,
  getCurrentMonthKey,
  DONATION_THRESHOLDS,
  DEFAULT_DONATION_URL,
  SUPPORTER_PLANS,
};
module.exports.default = module.exports;
