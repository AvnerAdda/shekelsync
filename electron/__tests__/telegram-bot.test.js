import { beforeEach, describe, expect, it, vi } from 'vitest';

const getNotificationsMock = vi.fn();
const getInsightsMock = vi.fn();
const getInvestmentSummaryMock = vi.fn();

function okResult(result) {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      result,
    }),
  };
}

function createMemoryStore(initialState = {}) {
  let state = { ...initialState };
  return {
    load: vi.fn(async () => ({ ...state })),
    save: vi.fn(async (nextState) => {
      state = { ...nextState };
      return { ...state };
    }),
    update: vi.fn(async (patch) => {
      state = { ...state, ...patch };
      return { ...state };
    }),
    clear: vi.fn(async () => {
      state = {};
    }),
    getState: () => ({ ...state }),
  };
}

function createSettingsHarness(initialSettings = {}) {
  let settings = {
    appLocale: 'en',
    backgroundSync: {
      enabled: true,
      keepRunningInTray: true,
      lastRunAt: '2026-03-24T10:00:00.000Z',
      lastResult: { status: 'success', message: 'Bulk sync completed' },
    },
    telegram: {
      enabled: true,
      deliveryMode: 'both',
      pushOnScheduledSync: true,
      localeMode: 'app',
    },
    ...initialSettings,
  };

  return {
    getSettings: vi.fn(async () => ({ ...settings })),
    updateSettings: vi.fn(async (patch = {}) => {
      settings = {
        ...settings,
        ...patch,
        telegram: {
          ...(settings.telegram || {}),
          ...(patch.telegram || {}),
        },
      };
      return { ...settings };
    }),
    read: () => ({ ...settings }),
  };
}

describe('telegram-bot', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.SHEKELSYNC_TEST_LOCALE = 'en';
    process.env.SHEKELSYNC_TEST_USER_DATA = '/tmp';
  });

  it('parses slash commands with optional bot mentions', async () => {
    const { parseCommandText } = await import('../telegram-bot.js');
    expect(parseCommandText('/status')).toEqual({ command: '/status', args: [] });
    expect(parseCommandText('/alerts@shekelsync_bot now')).toEqual({
      command: '/alerts',
      args: ['now'],
    });
    expect(parseCommandText('hello')).toEqual({ command: null, args: [] });
  });

  it('validates and stores the Telegram bot token securely', async () => {
    const store = createMemoryStore();
    const settings = createSettingsHarness();
    const fetchImpl = vi.fn(async (url) => {
      expect(url).toContain('/getMe');
      return okResult({ id: 1, username: 'shekelsync_bot' });
    });

    const { createTelegramBotService } = await import('../telegram-bot.js');
    const service = createTelegramBotService({
      getSettings: settings.getSettings,
      updateSettings: settings.updateSettings,
      store,
      services: {
        notificationsService: { getNotifications: getNotificationsMock },
        insightsService: { getInsights: getInsightsMock },
        investmentSummaryService: { getInvestmentSummary: getInvestmentSummaryMock },
      },
      fetchImpl,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), log: vi.fn() },
    });

    const status = await service.saveBotToken('123456:token');
    expect(status.configured).toBe(true);
    expect(status.paired).toBe(false);
    expect(store.getState()).toMatchObject({
      botToken: '123456:token',
      botUsername: 'shekelsync_bot',
      chatId: null,
    });
  });

  it('sends a test message to the paired Telegram chat', async () => {
    const sentMessages = [];
    const store = createMemoryStore({
      botToken: '123456:token',
      botUsername: 'shekelsync_bot',
      chatId: 55,
      chatUsername: 'alice',
    });
    const settings = createSettingsHarness();
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes('/sendMessage')) {
        sentMessages.push(JSON.parse(init.body));
        return okResult({ message_id: 1 });
      }
      throw new Error(`Unexpected Telegram method: ${url}`);
    });

    const { createTelegramBotService } = await import('../telegram-bot.js');
    const service = createTelegramBotService({
      getSettings: settings.getSettings,
      updateSettings: settings.updateSettings,
      store,
      services: {
        notificationsService: { getNotifications: getNotificationsMock },
        insightsService: { getInsights: getInsightsMock },
        investmentSummaryService: { getInvestmentSummary: getInvestmentSummaryMock },
      },
      fetchImpl,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), log: vi.fn() },
    });

    await service.sendTestMessage();
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      chat_id: 55,
    });
    expect(sentMessages[0].text).toContain('ShekelSync Telegram test message.');
  });

  it('sends a scheduled digest only when warning or critical alerts exist', async () => {
    const sentMessages = [];
    const store = createMemoryStore({
      botToken: '123456:token',
      botUsername: 'shekelsync_bot',
      chatId: 55,
      chatUsername: 'alice',
    });
    const settings = createSettingsHarness();
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes('/sendMessage')) {
        sentMessages.push(JSON.parse(init.body));
        return okResult({ message_id: 1 });
      }
      throw new Error(`Unexpected Telegram method: ${url}`);
    });

    getNotificationsMock.mockResolvedValue({
      success: true,
      data: {
        notifications: [
          {
            severity: 'warning',
            title: 'Budget warning',
            message: 'Housing is over plan.',
          },
        ],
      },
    });
    getInsightsMock.mockResolvedValue({
      monthly: {
        spentThisMonth: 1200,
        projectedMonthEnd: 1800,
        budgetsAtRisk: 1,
      },
    });
    getInvestmentSummaryMock.mockResolvedValue({
      summary: {
        totalAccounts: 1,
        totalPortfolioValue: 30000,
        unrealizedGainLoss: 1200,
        roi: 4,
      },
    });

    const { createTelegramBotService } = await import('../telegram-bot.js');
    const service = createTelegramBotService({
      getSettings: settings.getSettings,
      updateSettings: settings.updateSettings,
      store,
      services: {
        notificationsService: { getNotifications: getNotificationsMock },
        insightsService: { getInsights: getInsightsMock },
        investmentSummaryService: { getInvestmentSummary: getInvestmentSummaryMock },
      },
      fetchImpl,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), log: vi.fn() },
    });

    const result = await service.notifyScheduledSyncResult({
      success: true,
      message: 'Bulk sync completed',
    });

    expect(result.status).toBe('sent');
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain('Scheduled sync digest:');
    expect(sentMessages[0].text).toContain('Budget warning');
    expect(settings.read().telegram.lastDigestResult).toMatchObject({
      status: 'sent',
    });
  });

  it('skips success digests when there are no warning or critical alerts', async () => {
    const store = createMemoryStore({
      botToken: '123456:token',
      botUsername: 'shekelsync_bot',
      chatId: 55,
      chatUsername: 'alice',
    });
    const settings = createSettingsHarness();
    const fetchImpl = vi.fn();

    getNotificationsMock.mockResolvedValue({
      success: true,
      data: {
        notifications: [
          {
            severity: 'info',
            title: 'Sync complete',
            message: 'No issues found.',
          },
        ],
      },
    });
    getInsightsMock.mockResolvedValue({ monthly: {} });
    getInvestmentSummaryMock.mockResolvedValue({ summary: { totalAccounts: 0 } });

    const { createTelegramBotService } = await import('../telegram-bot.js');
    const service = createTelegramBotService({
      getSettings: settings.getSettings,
      updateSettings: settings.updateSettings,
      store,
      services: {
        notificationsService: { getNotifications: getNotificationsMock },
        insightsService: { getInsights: getInsightsMock },
        investmentSummaryService: { getInvestmentSummary: getInvestmentSummaryMock },
      },
      fetchImpl,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), log: vi.fn() },
    });

    const result = await service.notifyScheduledSyncResult({
      success: true,
      message: 'Bulk sync completed',
    });

    expect(result.status).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(settings.read().telegram.lastDigestResult).toMatchObject({
      status: 'skipped',
    });
  });

  it('processes commands only for the paired chat during polling', async () => {
    const sentMessages = [];
    const store = createMemoryStore({
      botToken: '123456:token',
      botUsername: 'shekelsync_bot',
      chatId: 55,
      chatUsername: 'alice',
      lastUpdateId: 100,
    });
    const settings = createSettingsHarness();
    let getUpdatesCalls = 0;

    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes('/getUpdates')) {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return okResult([
            {
              update_id: 101,
              message: {
                text: '/status',
                chat: { id: 55, type: 'private', username: 'alice' },
              },
            },
            {
              update_id: 102,
              message: {
                text: '/status',
                chat: { id: 99, type: 'private', username: 'mallory' },
              },
            },
          ]);
        }
        return okResult([]);
      }

      if (String(url).includes('/sendMessage')) {
        sentMessages.push(JSON.parse(init.body));
        return okResult({ message_id: sentMessages.length });
      }

      throw new Error(`Unexpected Telegram method: ${url}`);
    });

    const { createTelegramBotService } = await import('../telegram-bot.js');
    const service = createTelegramBotService({
      getSettings: settings.getSettings,
      updateSettings: settings.updateSettings,
      store,
      services: {
        notificationsService: { getNotifications: getNotificationsMock },
        insightsService: { getInsights: getInsightsMock },
        investmentSummaryService: { getInvestmentSummary: getInvestmentSummaryMock },
      },
      fetchImpl,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), log: vi.fn() },
    });

    await service.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await service.stop();

    expect(sentMessages.some((message) => message.chat_id === 55 && message.text.includes('ShekelSync status:'))).toBe(true);
    expect(sentMessages.some((message) => message.chat_id === 99 && message.text.includes('not authorized'))).toBe(true);
  });
});
