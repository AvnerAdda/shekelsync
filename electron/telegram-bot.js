const { randomBytes } = require('node:crypto');
const { resolveAppPath } = require('./paths');
const { createTelegramClient } = require('./telegram-client.js');
const defaultTelegramStore = require('./telegram-store.js');

let app;
try {
  ({ app } = require('electron'));
} catch {
  app = {
    getLocale: () => process.env.SHEKELSYNC_TEST_LOCALE || 'en',
    getPath: () => process.env.SHEKELSYNC_TEST_USER_DATA || process.cwd(),
  };
}

const POLL_TIMEOUT_SECONDS = 10;
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
const PAIRING_WINDOW_MS = 5 * 60 * 1000;

let cachedServices = null;

function getServices() {
  if (!cachedServices) {
    cachedServices = {
      notificationsService: require(resolveAppPath('server', 'services', 'notifications.js')),
      insightsService: require(resolveAppPath('server', 'services', 'analytics', 'insights.js')),
      investmentSummaryService: require(resolveAppPath('server', 'services', 'investments', 'summary.js')),
    };
  }
  return cachedServices;
}

function defaultTelegramSettings() {
  return {
    enabled: false,
    deliveryMode: 'both',
    pushOnScheduledSync: true,
    localeMode: 'app',
    lastDigestAt: undefined,
    lastDigestResult: undefined,
  };
}

function normalizeTelegramSettings(raw = {}) {
  const defaults = defaultTelegramSettings();
  const deliveryMode = raw?.deliveryMode === 'both' ? 'both' : 'both';
  const localeMode = raw?.localeMode === 'app' ? 'app' : 'app';

  return {
    ...defaults,
    ...raw,
    enabled: Boolean(raw?.enabled),
    deliveryMode,
    pushOnScheduledSync: raw?.pushOnScheduledSync !== false,
    localeMode,
  };
}

function normalizeLocale(value) {
  const normalized = String(value || '').trim().toLowerCase().split('-')[0];
  if (normalized === 'he' || normalized === 'fr') {
    return normalized;
  }
  return 'en';
}

function resolveMessageLocale(settings = {}) {
  if (settings?.telegram?.localeMode === 'app' || settings?.localeMode === 'app') {
    return normalizeLocale(settings?.appLocale || app.getLocale?.());
  }
  return 'en';
}

function formatCurrency(amount, locale = 'en') {
  const numeric = Number(amount || 0);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(numeric);
}

function formatSignedCurrency(amount, locale = 'en') {
  const numeric = Number(amount || 0);
  const base = formatCurrency(Math.abs(numeric), locale);
  if (numeric > 0) {
    return `+${base}`;
  }
  if (numeric < 0) {
    return `-${base}`;
  }
  return base;
}

function formatPercent(value) {
  const numeric = Number(value || 0);
  return `${numeric.toFixed(1)}%`;
}

function formatDateTime(value, locale = 'en') {
  if (!value) return 'never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'never';
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function generatePairingCode() {
  return randomBytes(3).toString('hex').toUpperCase();
}

function parseCommandText(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('/')) {
    return { command: null, args: [] };
  }

  const [rawCommand, ...args] = trimmed.split(/\s+/);
  const baseCommand = rawCommand.split('@')[0].toLowerCase();
  return {
    command: baseCommand,
    args,
  };
}

function isPrivateChat(chat) {
  return chat?.type === 'private';
}

function buildHelpText() {
  return [
    'ShekelSync is connected to this chat.',
    '',
    'Available commands:',
    '/status - connection and sync status',
    '/alerts - active warnings and critical alerts',
    '/spending - weekly and monthly spending snapshot',
    '/investments - portfolio summary',
    '/insights - combined finance highlights',
    '',
    'This Telegram integration works only while the desktop app is running.',
  ].join('\n');
}

function buildPairingSuccessText() {
  return [
    'ShekelSync is now connected to this chat.',
    '',
    'Try /help to see available commands.',
    'This bot works only while the desktop app is running.',
  ].join('\n');
}

function buildPairingExpiredText() {
  return 'That pairing code is invalid or expired. Start a new pairing session from ShekelSync Settings.';
}

function buildUnauthorizedChatText() {
  return 'This chat is not authorized for this ShekelSync desktop profile.';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeAlerts(notifications = []) {
  return notifications
    .filter((item) => item?.severity === 'critical' || item?.severity === 'warning')
    .slice(0, 3);
}

async function buildAlertsText({ locale = 'en', services = getServices() } = {}) {
  const { notificationsService } = services;
  const result = await notificationsService.getNotifications({
    limit: 5,
    severity: 'all',
    include_dismissed: false,
  });

  const notifications = Array.isArray(result?.data?.notifications) ? result.data.notifications : [];
  if (notifications.length === 0) {
    return 'No active alerts right now.';
  }

  const lines = ['Active alerts:'];
  notifications.slice(0, 5).forEach((item) => {
    lines.push(`- ${item.title}: ${item.message}`);
  });
  lines.push('');
  lines.push(`Generated ${formatDateTime(result?.metadata?.generated_at, locale)}.`);
  return lines.join('\n');
}

async function buildSpendingText({ locale = 'en', services = getServices() } = {}) {
  const { insightsService } = services;
  const [weekly, monthly] = await Promise.all([
    insightsService.getInsights({ period: 'weekly' }),
    insightsService.getInsights({ period: 'monthly' }),
  ]);

  const weeklyData = weekly?.weekly || {};
  const monthlyData = monthly?.monthly || {};
  const weekChange = Number(weeklyData.weekOverWeekChange || 0);

  const lines = [
    'Spending snapshot:',
    `- This week: ${formatCurrency(weeklyData.spentThisWeek || 0, locale)} (${weekChange >= 0 ? '+' : ''}${weekChange}% vs last week)`,
    `- This month: ${formatCurrency(monthlyData.spentThisMonth || 0, locale)}`,
    `- Projected month end: ${formatCurrency(monthlyData.projectedMonthEnd || 0, locale)}`,
    `- Savings rate: ${Math.round(Number(monthlyData.savingsRate || 0))}%`,
    `- Budgets at risk: ${Number(monthlyData.budgetsAtRisk || 0)}`,
  ];

  return lines.join('\n');
}

async function buildInvestmentsText({ locale = 'en', services = getServices() } = {}) {
  const { investmentSummaryService } = services;
  const result = await investmentSummaryService.getInvestmentSummary({ historyMonths: 6 });
  const summary = result?.summary || {};

  if (!summary.totalAccounts) {
    return 'No investment accounts are configured yet.';
  }

  const lines = [
    'Portfolio summary:',
    `- Portfolio value: ${formatCurrency(summary.totalPortfolioValue || 0, locale)}`,
    `- Unrealized gain/loss: ${formatSignedCurrency(summary.unrealizedGainLoss || 0, locale)}`,
    `- ROI: ${formatPercent(summary.roi || 0)}`,
    `- Accounts: ${Number(summary.totalAccounts || 0)}`,
    `- Last valuation: ${formatDateTime(summary.newestUpdateDate, locale)}`,
  ];
  return lines.join('\n');
}

async function buildInsightsText({ locale = 'en', services = getServices() } = {}) {
  const { insightsService } = services;
  const result = await insightsService.getInsights({ period: 'all' });
  const weekly = result?.weekly || {};
  const monthly = result?.monthly || {};
  const topCategory = weekly?.topCategories?.[0];

  const lines = ['Finance highlights:'];
  if (topCategory?.name) {
    lines.push(`- Top weekly category: ${topCategory.name} (${formatCurrency(topCategory.amount || 0, locale)})`);
  }
  lines.push(`- Weekly spend: ${formatCurrency(weekly.spentThisWeek || 0, locale)}`);
  lines.push(`- Monthly spend: ${formatCurrency(monthly.spentThisMonth || 0, locale)}`);
  lines.push(`- Projected month end: ${formatCurrency(monthly.projectedMonthEnd || 0, locale)}`);
  lines.push(`- Budgets at risk: ${Number(monthly.budgetsAtRisk || 0)}`);
  return lines.join('\n');
}

function buildStatusText({ locale = 'en', settings = {}, status = {} } = {}) {
  const backgroundSync = settings?.backgroundSync || {};
  const telegram = settings?.telegram || {};
  const lines = [
    'ShekelSync status:',
    '- App runtime: active',
    `- Telegram bot: ${status.runtimeActive ? 'connected' : 'idle'}`,
    `- Bound chat: ${status.chatTitle || status.chatUsername || 'not paired'}`,
    `- Last sync: ${formatDateTime(backgroundSync.lastRunAt, locale)}`,
    `- Last sync result: ${backgroundSync.lastResult?.status || 'unknown'}`,
    `- Last digest: ${formatDateTime(telegram.lastDigestAt, locale)}`,
    `- Last digest result: ${telegram.lastDigestResult?.status || 'none'}`,
  ];
  if (telegram.lastDigestResult?.message) {
    lines.push(`- Digest detail: ${telegram.lastDigestResult.message}`);
  }
  return lines.join('\n');
}

async function buildScheduledSyncDigest({ locale = 'en', services = getServices() } = {}) {
  const { notificationsService, insightsService, investmentSummaryService } = services;
  const [notificationsResult, monthlyInsights, investmentSummary] = await Promise.all([
    notificationsService.getNotifications({
      limit: 5,
      severity: 'all',
      include_dismissed: false,
    }),
    insightsService.getInsights({ period: 'monthly' }),
    investmentSummaryService.getInvestmentSummary({ historyMonths: 6 }),
  ]);

  const notifications = Array.isArray(notificationsResult?.data?.notifications)
    ? notificationsResult.data.notifications
    : [];
  const highlightedAlerts = summarizeAlerts(notifications);
  if (highlightedAlerts.length === 0) {
    return null;
  }

  const monthly = monthlyInsights?.monthly || {};
  const portfolio = investmentSummary?.summary || {};
  const lines = [
    'Scheduled sync digest:',
    ...highlightedAlerts.map((item) => `- ${item.title}: ${item.message}`),
    '',
    `Spending: ${formatCurrency(monthly.spentThisMonth || 0, locale)} this month, projected ${formatCurrency(monthly.projectedMonthEnd || 0, locale)}.`,
    `Budgets at risk: ${Number(monthly.budgetsAtRisk || 0)}.`,
  ];

  if (Number(portfolio.totalAccounts || 0) > 0) {
    lines.push(
      `Investments: ${formatCurrency(portfolio.totalPortfolioValue || 0, locale)} total, ${formatSignedCurrency(portfolio.unrealizedGainLoss || 0, locale)} unrealized (${formatPercent(portfolio.roi || 0)} ROI).`,
    );
  }

  return lines.join('\n');
}

function buildScheduledSyncFailureMessage(message) {
  const detail = typeof message === 'string' && message.trim().length > 0
    ? message.trim()
    : 'Scheduled sync failed.';
  return `Scheduled sync failed: ${detail}`;
}

function createTelegramBotService({
  getSettings,
  updateSettings,
  getSyncStatus,
  store = defaultTelegramStore,
  services,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  const state = {
    initialized: false,
    appSettings: {},
    telegramSettings: defaultTelegramSettings(),
    secrets: {},
    running: false,
    loopPromise: null,
    pairingSession: null,
    backoffMs: MIN_BACKOFF_MS,
    lastPollAt: null,
    lastMessageAt: null,
    lastError: null,
  };

  function resolveServices() {
    return services || getServices();
  }

  async function refreshSettingsCache(nextSettings) {
    const fullSettings = nextSettings || (typeof getSettings === 'function' ? await getSettings() : {});
    state.appSettings = fullSettings || {};
    state.telegramSettings = normalizeTelegramSettings(state.appSettings?.telegram || {});
    return state.appSettings;
  }

  async function loadSecrets() {
    state.secrets = await store.load();
    return state.secrets;
  }

  async function ensureInitialized() {
    if (state.initialized) {
      return;
    }
    await refreshSettingsCache();
    await loadSecrets();
    state.initialized = true;
  }

  function getClient() {
    if (!state.secrets?.botToken) {
      throw new Error('Telegram bot token is not configured');
    }
    return createTelegramClient({
      token: state.secrets.botToken,
      fetchImpl,
    });
  }

  function isPairingActive() {
    return Boolean(
      state.pairingSession
      && new Date(state.pairingSession.expiresAt).getTime() > Date.now(),
    );
  }

  function shouldPoll() {
    return Boolean(
      state.secrets?.botToken
      && (
        isPairingActive()
        || (state.telegramSettings.enabled && state.secrets?.chatId)
      ),
    );
  }

  async function updateTelegramSettingsPatch(patch = {}) {
    const mergedPatch = normalizeTelegramSettings({
      ...state.telegramSettings,
      ...patch,
    });

    if (typeof updateSettings === 'function') {
      const fullSettings = await updateSettings({ telegram: mergedPatch });
      await refreshSettingsCache(fullSettings);
      return state.telegramSettings;
    }

    state.telegramSettings = mergedPatch;
    state.appSettings = {
      ...state.appSettings,
      telegram: mergedPatch,
    };
    return state.telegramSettings;
  }

  async function persistLastUpdateId(lastUpdateId) {
    state.secrets = await store.update({ lastUpdateId });
  }

  async function advancePastBacklogIfNeeded() {
    if (typeof state.secrets?.lastUpdateId === 'number') {
      return;
    }
    const client = getClient();
    const updates = await client.getUpdates({ limit: 1, timeout: 0 });
    if (updates.length > 0) {
      const lastUpdateId = Number(updates[updates.length - 1]?.update_id);
      if (Number.isFinite(lastUpdateId)) {
        await persistLastUpdateId(lastUpdateId);
      }
    }
  }

  async function sendMessage(text, { disableNotification = false } = {}) {
    if (!state.secrets?.chatId) {
      throw new Error('Telegram chat is not paired');
    }
    const client = getClient();
    await client.sendMessage(state.secrets.chatId, text, { disableNotification });
    state.lastMessageAt = new Date().toISOString();
  }

  async function handlePairingMessage(update) {
    const message = update?.message;
    const chat = message?.chat;
    if (!isPrivateChat(chat)) {
      return false;
    }

    const { command, args } = parseCommandText(message?.text);
    if (command !== '/start') {
      return false;
    }

    const submittedCode = String(args[0] || '').trim().toUpperCase();
    const pairingCode = state.pairingSession?.code;
    if (!pairingCode || submittedCode !== pairingCode) {
      await getClient().sendMessage(chat.id, buildPairingExpiredText());
      return true;
    }

    state.secrets = await store.update({
      chatId: chat.id,
      chatType: chat.type,
      chatTitle: chat.title || null,
      chatUsername: chat.username || null,
      pairedAt: new Date().toISOString(),
      lastUpdateId: Number(update.update_id),
    });
    state.pairingSession = null;
    await updateTelegramSettingsPatch({ enabled: true });
    await getClient().sendMessage(chat.id, buildPairingSuccessText());
    return true;
  }

  async function handleCommandMessage(update) {
    const message = update?.message;
    const chat = message?.chat;
    if (!chat || String(chat.id) !== String(state.secrets?.chatId)) {
      if (chat && message?.text?.trim().startsWith('/')) {
        try {
          await getClient().sendMessage(chat.id, buildUnauthorizedChatText());
        } catch {
          // Ignore outbound failures to unauthorized chats.
        }
      }
      return;
    }

    const locale = resolveMessageLocale(state.appSettings);
    const { command } = parseCommandText(message?.text);
    let responseText = null;

    switch (command) {
      case '/help':
      case '/start':
        responseText = buildHelpText();
        break;
      case '/status': {
        const status = await getStatus();
        responseText = buildStatusText({
          locale,
          settings: state.appSettings,
          status,
        });
        break;
      }
      case '/alerts':
        responseText = await buildAlertsText({ locale, services: resolveServices() });
        break;
      case '/spending':
        responseText = await buildSpendingText({ locale, services: resolveServices() });
        break;
      case '/investments':
        responseText = await buildInvestmentsText({ locale, services: resolveServices() });
        break;
      case '/insights':
        responseText = await buildInsightsText({ locale, services: resolveServices() });
        break;
      default:
        responseText = 'Unknown command. Use /help to see available commands.';
        break;
    }

    if (responseText) {
      await getClient().sendMessage(chat.id, responseText);
      state.lastMessageAt = new Date().toISOString();
    }
  }

  async function processUpdate(update) {
    const updateId = Number(update?.update_id);
    if (Number.isFinite(updateId)) {
      await persistLastUpdateId(updateId);
    }

    if (isPairingActive()) {
      const paired = await handlePairingMessage(update);
      if (paired) {
        return;
      }
    }

    if (state.telegramSettings.enabled && state.secrets?.chatId) {
      await handleCommandMessage(update);
    }
  }

  async function pollOnce() {
    const client = getClient();
    const offset = typeof state.secrets?.lastUpdateId === 'number'
      ? state.secrets.lastUpdateId + 1
      : undefined;
    const updates = await client.getUpdates({
      offset,
      timeout: POLL_TIMEOUT_SECONDS,
      limit: 20,
    });
    state.lastPollAt = new Date().toISOString();

    if (!Array.isArray(updates) || updates.length === 0) {
      return false;
    }

    for (const update of updates) {
      await processUpdate(update);
    }
    return true;
  }

  async function ensurePollingLoop() {
    if (state.loopPromise || !shouldPoll()) {
      return state.loopPromise;
    }

    state.running = true;
    state.loopPromise = (async () => {
      if (state.telegramSettings.enabled && state.secrets?.chatId) {
        await advancePastBacklogIfNeeded();
      }

      while (state.running && shouldPoll()) {
        if (!isPairingActive() && !state.telegramSettings.enabled) {
          break;
        }
        if (state.pairingSession && !isPairingActive()) {
          state.pairingSession = null;
          if (!state.telegramSettings.enabled || !state.secrets?.chatId) {
            break;
          }
        }

        try {
          const hadUpdates = await pollOnce();
          state.backoffMs = MIN_BACKOFF_MS;
          state.lastError = null;
          if (!hadUpdates) {
            await sleep(250);
          }
        } catch (error) {
          state.lastError = error instanceof Error ? error.message : String(error);
          logger.warn?.('[Telegram] Polling error', { error: state.lastError });
          await sleep(state.backoffMs);
          state.backoffMs = Math.min(state.backoffMs * 2, MAX_BACKOFF_MS);
        }
      }
    })().finally(() => {
      state.loopPromise = null;
      state.running = false;
    });

    return state.loopPromise;
  }

  async function stop() {
    await ensureInitialized();
    state.running = false;
    state.pairingSession = null;
    return { success: true };
  }

  async function start() {
    await ensureInitialized();
    ensurePollingLoop();
    return getStatus();
  }

  async function refreshSettings(nextSettings) {
    await ensureInitialized();
    await refreshSettingsCache(nextSettings);
    if (shouldPoll()) {
      ensurePollingLoop();
    } else {
      state.running = false;
    }
    return getStatus();
  }

  async function saveBotToken(token) {
    await ensureInitialized();
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new Error('Telegram bot token is required');
    }

    const client = createTelegramClient({
      token,
      fetchImpl,
    });
    const me = await client.getMe();

    state.secrets = await store.save({
      botToken: token.trim(),
      botUsername: me?.username || null,
      chatId: null,
      chatType: null,
      chatTitle: null,
      chatUsername: null,
      pairedAt: null,
      lastUpdateId: undefined,
    });
    state.pairingSession = null;
    state.running = false;
    state.lastError = null;
    await updateTelegramSettingsPatch({
      enabled: false,
    });

    return getStatus();
  }

  async function beginPairing() {
    await ensureInitialized();
    if (!state.secrets?.botToken) {
      throw new Error('Save a Telegram bot token before pairing');
    }

    const client = getClient();
    const me = await client.getMe();
    if (!me?.username) {
      throw new Error('Unable to resolve Telegram bot username');
    }

    const now = Date.now();
    state.secrets = await store.update({
      botUsername: me.username,
    });
    state.pairingSession = {
      code: generatePairingCode(),
      expiresAt: new Date(now + PAIRING_WINDOW_MS).toISOString(),
    };

    ensurePollingLoop();
    return {
      success: true,
      pairingCode: state.pairingSession.code,
      expiresAt: state.pairingSession.expiresAt,
      botUsername: me.username,
      status: await getStatus(),
    };
  }

  async function disconnect() {
    await ensureInitialized();
    state.running = false;
    state.pairingSession = null;
    state.lastError = null;
    state.lastMessageAt = null;
    state.lastPollAt = null;
    await store.clear();
    state.secrets = {};
    await updateTelegramSettingsPatch({
      enabled: false,
      lastDigestAt: undefined,
      lastDigestResult: undefined,
    });
    return getStatus();
  }

  async function sendTestMessage() {
    await ensureInitialized();
    if (!state.secrets?.chatId) {
      throw new Error('Telegram chat is not paired');
    }

    const locale = resolveMessageLocale(state.appSettings);
    const message = [
      'ShekelSync Telegram test message.',
      '',
      await buildStatusText({
        locale,
        settings: state.appSettings,
        status: await getStatus(),
      }),
    ].join('\n');

    await sendMessage(message);
    return getStatus();
  }

  async function updateDigestResult(nextResult) {
    const patch = {
      lastDigestResult: nextResult,
      ...(nextResult?.status === 'sent' ? { lastDigestAt: new Date().toISOString() } : {}),
    };
    await updateTelegramSettingsPatch(patch);
  }

  async function notifyScheduledSyncResult({ success, message } = {}) {
    await ensureInitialized();
    if (!state.telegramSettings.enabled || !state.telegramSettings.pushOnScheduledSync || !state.secrets?.chatId) {
      return { success: false, status: 'skipped', message: 'Telegram push disabled or not configured' };
    }

    if (!success) {
      const text = buildScheduledSyncFailureMessage(message);
      try {
        await sendMessage(text);
        await updateDigestResult({
          status: 'sent',
          message: 'Sent scheduled sync failure alert',
        });
        return { success: true, status: 'sent' };
      } catch (error) {
        await updateDigestResult({
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    const locale = resolveMessageLocale(state.appSettings);
    const digestText = await buildScheduledSyncDigest({ locale, services: resolveServices() });
    if (!digestText) {
      await updateDigestResult({
        status: 'skipped',
        message: 'No warning or critical alerts after scheduled sync',
      });
      return { success: false, status: 'skipped' };
    }

    try {
      await sendMessage(digestText, { disableNotification: false });
      await updateDigestResult({
        status: 'sent',
        message: 'Sent scheduled sync digest',
      });
      return { success: true, status: 'sent' };
    } catch (error) {
      await updateDigestResult({
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async function getStatus() {
    await ensureInitialized();
    const syncStatus = typeof getSyncStatus === 'function'
      ? await getSyncStatus()
      : {};

    return {
      enabled: state.telegramSettings.enabled,
      deliveryMode: state.telegramSettings.deliveryMode,
      pushOnScheduledSync: state.telegramSettings.pushOnScheduledSync,
      configured: Boolean(state.secrets?.botToken),
      paired: Boolean(state.secrets?.chatId),
      botUsername: state.secrets?.botUsername || null,
      chatTitle: state.secrets?.chatTitle || null,
      chatUsername: state.secrets?.chatUsername || null,
      pairingCode: state.pairingSession?.code || null,
      pairingExpiresAt: state.pairingSession?.expiresAt || null,
      runtimeActive: Boolean(state.loopPromise),
      lastPollAt: state.lastPollAt,
      lastMessageAt: state.lastMessageAt,
      lastError: state.lastError,
      localOnly: true,
      syncStatus,
    };
  }

  async function getDiagnostics() {
    const status = await getStatus();
    return {
      configured: status.configured,
      paired: status.paired,
      enabled: status.enabled,
      runtimeActive: status.runtimeActive,
      botUsername: status.botUsername,
      chatTitle: status.chatTitle,
      lastPollAt: status.lastPollAt,
      lastMessageAt: status.lastMessageAt,
      lastError: status.lastError,
      pairingExpiresAt: status.pairingExpiresAt,
    };
  }

  return {
    start,
    stop,
    refreshSettings,
    saveBotToken,
    beginPairing,
    disconnect,
    sendTestMessage,
    notifyScheduledSyncResult,
    getStatus,
    getDiagnostics,
  };
}

module.exports = {
  createTelegramBotService,
  defaultTelegramSettings,
  normalizeTelegramSettings,
  parseCommandText,
  buildScheduledSyncDigest,
  buildScheduledSyncFailureMessage,
};
