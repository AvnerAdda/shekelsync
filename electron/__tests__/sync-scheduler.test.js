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
});
