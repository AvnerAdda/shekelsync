const { resolveAppPath } = require('./paths');
const licenseService = require('./license-service');

const { SCRAPE_RATE_LIMIT_MS } = require(resolveAppPath('utils', 'constants.js'));
const { bulkScrape } = require(resolveAppPath('server', 'services', 'scraping', 'bulk.js'));
const { maybeRunAutoDetection } = require(resolveAppPath(
  'server',
  'services',
  'analytics',
  'subscriptions.js',
));

const INTERVAL_CHOICES = new Set([48, 168, 720]);
const IMMEDIATE_DELAY_MS = 60 * 1000;

const defaultBackgroundSync = () => ({
  enabled: false,
  intervalHours: 48,
  runOnStartup: true,
  keepRunningInTray: true,
  headless: true,
  lastRunAt: undefined,
  lastResult: undefined,
});

function normalizeIntervalHours(value) {
  const parsed = Number(value);
  return INTERVAL_CHOICES.has(parsed) ? parsed : 48;
}

function normalizeBackgroundSettings(raw = {}) {
  const defaults = defaultBackgroundSync();
  const settings = { ...defaults, ...(raw || {}) };
  return {
    ...settings,
    enabled: Boolean(settings.enabled),
    intervalHours: normalizeIntervalHours(settings.intervalHours),
    runOnStartup: settings.runOnStartup !== false,
    keepRunningInTray: settings.keepRunningInTray !== false,
    headless: settings.headless !== false,
  };
}

function toTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function createScrapeLogger(vendor, baseLogger = console) {
  const prefix = vendor ? `[Sync:${vendor}]` : '[Sync]';
  return {
    log: (...args) => baseLogger.log?.(prefix, ...args),
    info: (...args) => baseLogger.info?.(prefix, ...args),
    warn: (...args) => baseLogger.warn?.(prefix, ...args),
    error: (...args) => baseLogger.error?.(prefix, ...args),
  };
}

function createSyncScheduler({
  getSettings,
  updateSettings,
  emitProgress,
  logger = console,
} = {}) {
  let timer = null;
  let running = false;
  let started = false;
  let currentBackground = normalizeBackgroundSettings();

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function loadSettings() {
    const settings = typeof getSettings === 'function' ? await getSettings() : {};
    currentBackground = normalizeBackgroundSettings(settings?.backgroundSync || {});
    return currentBackground;
  }

  function emit(payload) {
    if (typeof emitProgress === 'function') {
      emitProgress(payload);
    }
  }

  function scheduleNext({ immediateIfOverdue = false } = {}) {
    clearTimer();
    if (!currentBackground.enabled) {
      return;
    }

    const now = Date.now();
    const intervalMs = currentBackground.intervalHours * 60 * 60 * 1000;
    const lastRunAtMs = toTimestamp(currentBackground.lastRunAt);
    let nextRunAt = lastRunAtMs ? lastRunAtMs + intervalMs : now + intervalMs;

    if (immediateIfOverdue && (!lastRunAtMs || nextRunAt <= now)) {
      nextRunAt = now + IMMEDIATE_DELAY_MS;
    }

    const delay = Math.max(30 * 1000, nextRunAt - now);
    timer = setTimeout(() => {
      runSync('scheduled').catch((error) => {
        logger.error('[SyncScheduler] Scheduled sync failed', { error: error.message });
      });
    }, delay);
  }

  async function recordResult(result) {
    if (typeof updateSettings !== 'function') {
      return;
    }
    await updateSettings({
      backgroundSync: {
        lastRunAt: new Date().toISOString(),
        lastResult: result,
      },
    });
  }

  async function runSync(reason = 'manual') {
    if (running) {
      return { success: false, status: 'skipped', message: 'Sync already running' };
    }

    await loadSettings();

    if (!currentBackground.enabled && reason === 'scheduled') {
      return { success: false, status: 'skipped', message: 'Auto-sync disabled' };
    }

    running = true;
    const headless = currentBackground.headless;
    const intervalMs = currentBackground.intervalHours * 60 * 60 * 1000;

    try {
      const canWrite = await licenseService.isWriteOperationAllowed();
      if (!canWrite) {
        const result = { status: 'blocked', message: 'License is in read-only mode' };
        await recordResult(result);
        return { success: false, ...result };
      }

      emit({
        vendor: 'bulk',
        status: 'starting',
        progress: 0,
        message: 'Scheduled bulk sync initiated',
      });

      const bulkResult = await bulkScrape({
        thresholdMs: intervalMs,
        rateLimitMs: SCRAPE_RATE_LIMIT_MS,
        logger: createScrapeLogger('bulk', logger),
        showBrowser: !headless,
        onAccountStart: ({ account, index, total }) => {
          emit({
            vendor: account.vendor,
            status: 'starting',
            progress: Math.round((index / Math.max(total, 1)) * 100),
            message: `Syncing ${account.vendor} (${index + 1}/${total})`,
          });
        },
        onAccountComplete: ({ account, index, total, result: summary }) => {
          emit({
            vendor: account.vendor,
            status: summary.success ? 'completed' : 'failed',
            progress: Math.round(((index + 1) / Math.max(total, 1)) * 100),
            message: summary.message,
            transactions: summary.transactionCount,
          });
        },
        createLogger: (vendor) => createScrapeLogger(`bulk:${vendor}`, logger),
      });

      const totals = {
        totalProcessed: bulkResult.totalProcessed || 0,
        successCount: bulkResult.successCount || 0,
        failureCount: bulkResult.failureCount || 0,
        totalTransactions: bulkResult.totalTransactions || 0,
      };

      emit({
        vendor: 'bulk',
        status: 'completed',
        progress: 100,
        message: bulkResult.message || 'Bulk sync completed',
        totals,
      });

      await recordResult({
        status: 'success',
        message: bulkResult.message,
        totals,
      });

      await maybeRunAutoDetection({ defaultStatus: 'review' });

      return { success: true, ...bulkResult };
    } catch (error) {
      emit({
        vendor: 'bulk',
        status: 'failed',
        progress: 100,
        message: error?.message || 'Bulk sync failed',
        error: error?.message,
      });

      await recordResult({
        status: 'failed',
        message: error?.message || 'Bulk sync failed',
      });

      return { success: false, status: 'failed', message: error?.message || 'Bulk sync failed' };
    } finally {
      running = false;
      await loadSettings();
      scheduleNext({ immediateIfOverdue: false });
    }
  }

  async function start() {
    if (started) return;
    started = true;
    await loadSettings();
    scheduleNext({ immediateIfOverdue: currentBackground.runOnStartup });
  }

  function stop() {
    clearTimer();
    started = false;
  }

  async function update(nextSettings) {
    currentBackground = normalizeBackgroundSettings(nextSettings?.backgroundSync || {});
    scheduleNext({ immediateIfOverdue: currentBackground.runOnStartup });
  }

  return {
    start,
    stop,
    runSync,
    updateSettings: update,
    getCurrentSettings: () => currentBackground,
  };
}

module.exports = {
  createSyncScheduler,
  normalizeBackgroundSettings,
  defaultBackgroundSync,
};
