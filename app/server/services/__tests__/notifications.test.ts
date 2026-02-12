import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const database = require('../database.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const forecastService = require('../forecast.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notificationsService = require('../notifications.js');

function createMockClient(queryImplementation?: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>) {
  const query = vi.fn(queryImplementation || (async () => ({ rows: [] })));
  return {
    query,
    release: vi.fn(),
  };
}

describe('notifications service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-09T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('generates budget warning + exceeded alerts and respects sorting + limit', async () => {
    let spentCallCount = 0;
    const client = createMockClient(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM category_budgets')) {
        return {
          rows: [
            {
              id: 1,
              category_definition_id: 11,
              budget_limit: 1000,
              category_name: 'Groceries',
              parent_category_name: 'Expenses',
            },
            {
              id: 2,
              category_definition_id: 22,
              budget_limit: 1000,
              category_name: 'Transport',
              parent_category_name: 'Expenses',
            },
          ],
        };
      }

      if (text.includes('AS spent')) {
        spentCallCount += 1;
        return { rows: [{ spent: spentCallCount === 1 ? 1200 : 800 }] };
      }

      return { rows: [] };
    });

    vi.spyOn(database, 'getClient').mockResolvedValue(client);
    vi.spyOn(forecastService, 'generateDailyForecast').mockResolvedValue({
      generated: '2026-02-09T12:00:00.000Z',
      budgetOutlook: [],
    });

    const result = await notificationsService.getNotifications({
      type: 'budget_warning',
      limit: '1',
    });

    expect(result.success).toBe(true);
    expect(result.data.notifications).toHaveLength(1);
    expect(result.data.notifications[0].type).toBe('budget_exceeded');
    expect(result.data.notifications[0].severity).toBe('critical');
    expect(result.data.summary.by_type.budget_exceeded).toBe(1);
    expect(result.metadata.filters.limit).toBe(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('generates projected-budget alerts from forecast output', async () => {
    const client = createMockClient();
    vi.spyOn(database, 'getClient').mockResolvedValue(client);
    vi.spyOn(forecastService, 'generateDailyForecast').mockResolvedValue({
      generated: '2026-02-09T12:00:00.000Z',
      budgetOutlook: [
        {
          categoryDefinitionId: 7,
          categoryName: 'Dining',
          limit: 1000,
          actualSpent: 350,
          projectedTotal: 1300,
          nextLikelyHitDate: '2026-02-22',
          risk: 82,
        },
        {
          categoryDefinitionId: 8,
          categoryName: 'Rent',
          limit: 4000,
          actualSpent: 3600,
          projectedTotal: 4300,
          nextLikelyHitDate: '2026-02-28',
          risk: 95,
        },
      ],
    });

    const result = await notificationsService.getNotifications({
      type: 'budget_projected',
    });

    expect(result.success).toBe(true);
    expect(result.data.notifications).toHaveLength(1);
    expect(result.data.notifications[0]).toMatchObject({
      type: 'budget_projected',
      severity: 'warning',
    });
    expect(result.data.notifications[0].data.category_definition_id).toBe(7);
    expect(client.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('returns stale-sync critical alert when accounts are far behind', async () => {
    const client = createMockClient(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM vendor_credentials vc')) {
        return {
          rows: [
            {
              id: 1,
              vendor: 'isracard',
              nickname: 'Card One',
              last_success_event: null,
              last_event_time: '2026-01-29T08:00:00.000Z',
              last_event_status: 'error',
            },
            {
              id: 2,
              vendor: 'hapoalim',
              nickname: 'Bank One',
              last_success_event: null,
              last_event_time: '2026-01-28T08:00:00.000Z',
              last_event_status: 'error',
            },
          ],
        };
      }

      return { rows: [] };
    });

    vi.spyOn(database, 'getClient').mockResolvedValue(client);
    vi.spyOn(forecastService, 'generateDailyForecast').mockResolvedValue({
      generated: '2026-02-09T12:00:00.000Z',
      budgetOutlook: [],
    });

    const result = await notificationsService.getNotifications({ type: 'stale_sync' });
    const [alert] = result.data.notifications;

    expect(alert.type).toBe('stale_sync');
    expect(alert.severity).toBe('critical');
    expect(alert.data.stale_count).toBe(2);
    expect(alert.actions[0].action).toBe('bulk_refresh');
    expect(result.data.summary.by_type.stale_sync).toBe(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('returns sync-success alert when every account synced in last 24h', async () => {
    const client = createMockClient(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM vendor_credentials vc')) {
        return {
          rows: [
            {
              id: 1,
              vendor: 'isracard',
              nickname: 'Card One',
              last_success_event: '2026-02-09T11:20:00.000Z',
              last_event_time: '2026-02-09T11:20:00.000Z',
              last_event_status: 'success',
            },
            {
              id: 2,
              vendor: 'hapoalim',
              nickname: 'Bank One',
              last_success_event: '2026-02-09T10:30:00.000Z',
              last_event_time: '2026-02-09T10:30:00.000Z',
              last_event_status: 'success',
            },
          ],
        };
      }
      return { rows: [] };
    });

    vi.spyOn(database, 'getClient').mockResolvedValue(client);
    vi.spyOn(forecastService, 'generateDailyForecast').mockResolvedValue({
      generated: '2026-02-09T12:00:00.000Z',
      budgetOutlook: [],
    });

    const result = await notificationsService.getNotifications({ type: 'sync_success' });

    expect(result.data.notifications).toHaveLength(1);
    expect(result.data.notifications[0].type).toBe('sync_success');
    expect(result.data.notifications[0].actionable).toBe(false);
    expect(result.data.notifications[0].message).toContain('2 accounts up to date');
    expect(result.data.summary.by_type.sync_success).toBe(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('suppresses notifications when severity filter excludes generated alert level', async () => {
    const client = createMockClient(async (sql) => {
      const text = String(sql);
      if (text.includes('COUNT(*) as count')) {
        return {
          rows: [{ count: 12, total_amount: 4567 }],
        };
      }
      return { rows: [] };
    });

    vi.spyOn(database, 'getClient').mockResolvedValue(client);
    vi.spyOn(forecastService, 'generateDailyForecast').mockResolvedValue({
      generated: '2026-02-09T12:00:00.000Z',
      budgetOutlook: [],
    });

    const result = await notificationsService.getNotifications({
      type: 'uncategorized_transactions',
      severity: 'warning',
    });

    expect(result.success).toBe(true);
    expect(result.data.notifications).toEqual([]);
    expect(result.data.summary.total).toBe(0);
    expect(result.data.summary.by_severity.warning).toBe(0);
  });

  it('wraps query failures in standardized NOTIFICATION_ERROR', async () => {
    const client = createMockClient(async () => {
      throw new Error('db exploded');
    });

    vi.spyOn(database, 'getClient').mockResolvedValue(client);
    vi.spyOn(forecastService, 'generateDailyForecast').mockResolvedValue({
      generated: '2026-02-09T12:00:00.000Z',
      budgetOutlook: [],
    });

    await expect(
      notificationsService.getNotifications({ type: 'budget_warning' }),
    ).rejects.toMatchObject({
      success: false,
      error: {
        code: 'NOTIFICATION_ERROR',
        message: 'Failed to generate notifications',
        details: {
          message: 'db exploded',
        },
      },
    });

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('creates unusual-spending alerts for strong category outliers in the last week', async () => {
    const rows = [
      { identifier: 'n1', vendor: 'coffee', name: 'Coffee', date: '2026-01-20', amount: 100, resolved_category_id: 77, resolved_category_name: 'Food' },
      { identifier: 'n2', vendor: 'coffee', name: 'Coffee', date: '2026-01-21', amount: 100, resolved_category_id: 77, resolved_category_name: 'Food' },
      { identifier: 'n3', vendor: 'coffee', name: 'Coffee', date: '2026-01-22', amount: 100, resolved_category_id: 77, resolved_category_name: 'Food' },
      { identifier: 'n4', vendor: 'coffee', name: 'Coffee', date: '2026-01-23', amount: 100, resolved_category_id: 77, resolved_category_name: 'Food' },
      { identifier: 'n5', vendor: 'coffee', name: 'Coffee', date: '2026-01-24', amount: 100, resolved_category_id: 77, resolved_category_name: 'Food' },
      { identifier: 'n6', vendor: 'coffee', name: 'Coffee', date: '2026-01-25', amount: 100, resolved_category_id: 77, resolved_category_name: 'Food' },
      { identifier: 'n7', vendor: 'coffee', name: 'Coffee', date: '2026-01-26', amount: 100, resolved_category_id: 77, resolved_category_name: 'Food' },
      { identifier: 'n8', vendor: 'coffee', name: 'Coffee', date: '2026-02-08', amount: 1000, resolved_category_id: 77, resolved_category_name: 'Food' },
    ];

    const client = createMockClient(async (sql) => {
      const text = String(sql);
      if (text.includes('LIMIT 1000') && text.includes('resolved_category_name')) {
        return { rows };
      }
      return { rows: [] };
    });

    vi.spyOn(database, 'getClient').mockResolvedValue(client);
    vi.spyOn(forecastService, 'generateDailyForecast').mockResolvedValue({
      generated: '2026-02-09T12:00:00.000Z',
      budgetOutlook: [],
    });

    const result = await notificationsService.getNotifications({ type: 'unusual_spending' });

    expect(result.success).toBe(true);
    expect(result.data.notifications).toHaveLength(1);
    expect(result.data.notifications[0].type).toBe('unusual_spending');
    expect(result.data.notifications[0].data.transaction_id).toBe('n8');
    expect(result.data.notifications[0].actions[0].action).toBe('view_transaction');
  });

  it('creates high-transaction alerts using percentile threshold and recency window', async () => {
    const rows = [
      { identifier: 't1', vendor: 'shop', name: 'Txn 1', date: '2026-01-20', amount: 110, resolved_category_id: 55, resolved_category_name: 'Shopping' },
      { identifier: 't2', vendor: 'shop', name: 'Txn 2', date: '2026-01-21', amount: 120, resolved_category_id: 55, resolved_category_name: 'Shopping' },
      { identifier: 't3', vendor: 'shop', name: 'Txn 3', date: '2026-01-22', amount: 130, resolved_category_id: 55, resolved_category_name: 'Shopping' },
      { identifier: 't4', vendor: 'shop', name: 'Txn 4', date: '2026-01-23', amount: 140, resolved_category_id: 55, resolved_category_name: 'Shopping' },
      { identifier: 't5', vendor: 'shop', name: 'Txn 5', date: '2026-01-24', amount: 150, resolved_category_id: 55, resolved_category_name: 'Shopping' },
      { identifier: 't6', vendor: 'shop', name: 'Txn 6', date: '2026-01-25', amount: 160, resolved_category_id: 55, resolved_category_name: 'Shopping' },
      { identifier: 't7', vendor: 'shop', name: 'Txn 7', date: '2026-01-26', amount: 170, resolved_category_id: 55, resolved_category_name: 'Shopping' },
      { identifier: 't8', vendor: 'shop', name: 'Txn 8', date: '2026-01-27', amount: 180, resolved_category_id: 55, resolved_category_name: 'Shopping' },
      { identifier: 't9', vendor: 'shop', name: 'Txn 9', date: '2026-01-28', amount: 200, resolved_category_id: 55, resolved_category_name: 'Shopping' },
      { identifier: 't10', vendor: 'electronics', name: 'Laptop', date: '2026-02-08', amount: 1000, resolved_category_id: 55, resolved_category_name: 'Shopping' },
    ];

    const client = createMockClient(async (sql) => {
      const text = String(sql);
      if (text.includes('LIMIT 1000') && text.includes('resolved_category_name')) {
        return { rows };
      }
      return { rows: [] };
    });

    vi.spyOn(database, 'getClient').mockResolvedValue(client);
    vi.spyOn(forecastService, 'generateDailyForecast').mockResolvedValue({
      generated: '2026-02-09T12:00:00.000Z',
      budgetOutlook: [],
    });

    const result = await notificationsService.getNotifications({ type: 'high_transaction' });

    expect(result.success).toBe(true);
    expect(result.data.notifications).toHaveLength(1);
    expect(result.data.notifications[0].type).toBe('high_transaction');
    expect(result.data.notifications[0].data.transaction_id).toBe('t10');
  });

  it('creates new vendor and cash flow alerts from aggregate queries', async () => {
    const newVendorClient = createMockClient(async (sql) => {
      const text = String(sql);
      if (text.includes('GROUP BY t.vendor')) {
        return {
          rows: [
            {
              vendor: 'New Grocery',
              first_transaction: '2026-02-08',
              transaction_count: 3,
              total_amount: 640,
            },
          ],
        };
      }
      return { rows: [] };
    });

    vi.spyOn(database, 'getClient').mockResolvedValueOnce(newVendorClient);
    vi.spyOn(forecastService, 'generateDailyForecast').mockResolvedValue({
      generated: '2026-02-09T12:00:00.000Z',
      budgetOutlook: [],
    });

    const vendorResult = await notificationsService.getNotifications({ type: 'new_vendor' });
    expect(vendorResult.data.notifications).toHaveLength(1);
    expect(vendorResult.data.notifications[0].type).toBe('new_vendor');
    expect(vendorResult.data.notifications[0].actions[1].action).toBe('create_rule');

    const cashFlowClient = createMockClient(async (sql) => {
      const text = String(sql);
      if (text.includes('WITH monthly_flow AS')) {
        return {
          rows: [{
            income: 10000,
            expenses: 9200,
            avg_daily_spending: 120,
          }],
        };
      }
      return { rows: [] };
    });

    vi.spyOn(database, 'getClient').mockResolvedValueOnce(cashFlowClient);

    const cashFlowResult = await notificationsService.getNotifications({ type: 'cash_flow_alert' });
    expect(cashFlowResult.data.notifications).toHaveLength(1);
    expect(cashFlowResult.data.notifications[0].type).toBe('cash_flow_alert');
    expect(cashFlowResult.data.notifications[0].severity).toBe('warning');
    expect(cashFlowResult.data.notifications[0].data.days_remaining).toBeLessThan(10);
  });

  it('marks uncategorized notifications as warning when count is high', async () => {
    const client = createMockClient(async (sql) => {
      const text = String(sql);
      if (text.includes('COUNT(*) as count')) {
        return { rows: [{ count: 25, total_amount: 9876 }] };
      }
      return { rows: [] };
    });

    vi.spyOn(database, 'getClient').mockResolvedValue(client);
    vi.spyOn(forecastService, 'generateDailyForecast').mockResolvedValue({
      generated: '2026-02-09T12:00:00.000Z',
      budgetOutlook: [],
    });

    const result = await notificationsService.getNotifications({ type: 'uncategorized_transactions' });

    expect(result.data.notifications).toHaveLength(1);
    expect(result.data.notifications[0].severity).toBe('warning');
    expect(result.data.notifications[0].data.count).toBe(25);
  });

  it('does not fail notifications when forecast generation fails for budget projected type', async () => {
    const client = createMockClient();
    vi.spyOn(database, 'getClient').mockResolvedValue(client);
    vi.spyOn(forecastService, 'generateDailyForecast').mockRejectedValue(new Error('forecast unavailable'));

    const result = await notificationsService.getNotifications({ type: 'budget_projected' });

    expect(result.success).toBe(true);
    expect(result.data.notifications).toEqual([]);
    expect(result.data.summary.total).toBe(0);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('creates stale-sync warning when oldest account is stale but not critical', async () => {
    const client = createMockClient(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM vendor_credentials vc')) {
        return {
          rows: [
            {
              id: 1,
              vendor: 'isracard',
              nickname: 'Card One',
              last_success_event: null,
              last_event_time: '2026-02-07T10:00:00.000Z',
              last_event_status: 'error',
            },
          ],
        };
      }
      return { rows: [] };
    });

    vi.spyOn(database, 'getClient').mockResolvedValue(client);
    vi.spyOn(forecastService, 'generateDailyForecast').mockResolvedValue({
      generated: '2026-02-09T12:00:00.000Z',
      budgetOutlook: [],
    });

    const result = await notificationsService.getNotifications({ type: 'stale_sync' });

    expect(result.data.notifications).toHaveLength(1);
    expect(result.data.notifications[0].severity).toBe('warning');
    expect(result.data.notifications[0].type).toBe('stale_sync');
    expect(result.data.notifications[0].data.days_since_sync).toBeLessThanOrEqual(7);
  });
});
