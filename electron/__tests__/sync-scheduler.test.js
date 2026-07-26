import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('sync-scheduler', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('reports only scheduled runs to the scheduled result callback', async () => {
    const bulkScrapeMock = vi.fn();
    const maybeRunAutoDetectionMock = vi.fn();
    bulkScrapeMock.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      totalProcessed: 1,
      totalTransactions: 12,
      message: 'Bulk sync completed',
    });

    const { createSyncScheduler } = await import('../sync-scheduler.js');
    const onScheduledResult = vi.fn();
    const scheduler = createSyncScheduler({
      getSettings: async () => ({
        backgroundSync: {
          enabled: true,
          intervalHours: 48,
          runOnStartup: false,
        },
      }),
      onScheduledResult,
      bulkScrapeImpl: bulkScrapeMock,
      autoDetectionImpl: maybeRunAutoDetectionMock,
      repairStateProvider: {},
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() },
    });

    await scheduler.runSync('manual');
    expect(onScheduledResult).not.toHaveBeenCalled();

    await scheduler.runSync('scheduled');
    expect(onScheduledResult).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'scheduled',
      success: true,
      message: 'Bulk sync completed',
    }));
    expect(maybeRunAutoDetectionMock).toHaveBeenCalled();
  });

  it('reports scheduled failures to the scheduled result callback', async () => {
    const bulkScrapeMock = vi.fn();
    bulkScrapeMock.mockRejectedValue(new Error('network down'));

    const { createSyncScheduler } = await import('../sync-scheduler.js');
    const onScheduledResult = vi.fn();
    const scheduler = createSyncScheduler({
      getSettings: async () => ({
        backgroundSync: {
          enabled: true,
          intervalHours: 48,
          runOnStartup: false,
        },
      }),
      onScheduledResult,
      bulkScrapeImpl: bulkScrapeMock,
      autoDetectionImpl: vi.fn(),
      repairStateProvider: {},
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() },
    });

    await scheduler.runSync('scheduled');
    expect(onScheduledResult).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'scheduled',
      success: false,
      message: 'network down',
    }));
  });

  it('waits for an active sync and does not reschedule it after stop', async () => {
    let finishScrape;
    const scrapeFinished = new Promise((resolve) => {
      finishScrape = resolve;
    });
    const bulkScrapeMock = vi.fn(() => scrapeFinished);

    const { createSyncScheduler } = await import('../sync-scheduler.js');
    const scheduler = createSyncScheduler({
      getSettings: async () => ({
        backgroundSync: {
          enabled: true,
          intervalHours: 48,
          runOnStartup: false,
        },
      }),
      bulkScrapeImpl: bulkScrapeMock,
      autoDetectionImpl: vi.fn(),
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() },
    });

    await scheduler.start();
    const runPromise = scheduler.runSync('manual');
    await vi.waitFor(() => expect(bulkScrapeMock).toHaveBeenCalledOnce());

    const stopPromise = scheduler.stop();
    let stopped = false;
    void stopPromise.then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);

    finishScrape({
      successCount: 1,
      failureCount: 0,
      totalProcessed: 1,
      totalTransactions: 1,
      message: 'done',
    });
    await runPromise;
    await stopPromise;

    expect(stopped).toBe(true);
  });
});
