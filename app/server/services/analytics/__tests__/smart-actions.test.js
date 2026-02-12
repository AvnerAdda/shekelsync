import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const forecastService = require('../../forecast.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const smartActionsService = require('../smart-actions.js');

function createClient(queryImpl) {
  return {
    query: vi.fn(queryImpl),
    release: vi.fn(),
  };
}

function setDatabaseClient(client) {
  smartActionsService.__setDatabase({
    getClient: vi.fn().mockResolvedValue(client),
  });
}

describe('analytics smart-actions service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-10T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    smartActionsService.__resetDatabase();
  });

  it('detects category anomalies using forecast baselines and tree stats', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SUM(ABS(t.price)) as current_total')) {
        return {
          rows: [{
            category_definition_id: 11,
            category_name: 'Groceries',
            category_name_en: 'Groceries',
            current_total: 1500,
          }],
        };
      }
      if (text.includes('AVG(ABS(price)) as avg_amount') && text.includes('transaction_count')) {
        return { rows: [{ avg_amount: 150, transaction_count: 9, total_amount: 450 }] };
      }
      if (text.includes('WITH RECURSIVE category_tree(id)') && text.includes('SUM(ABS(t.price)) as total_amount')) {
        return { rows: [{ total_amount: 900 }] };
      }
      if (text.includes('WITH RECURSIVE category_tree(id)') && text.includes('monthly_totals')) {
        return { rows: [{ avg_amount: 600, max_amount: 800 }] };
      }
      if (text.includes('SUM(ABS(t.price)) as total_amount')) {
        return { rows: [{ total_amount: 600 }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const anomalies = await smartActionsService.detectCategoryAnomalies({
      months: 1,
      locale: 'en',
      forecastData: {
        patterns: [{
          categoryDefinitionId: 11,
          categoryName: 'Groceries',
          categoryNameEn: 'Groceries',
          avgAmount: 250,
          avgOccurrencesPerMonth: 1,
          confidence: 0.8,
          patternType: 'monthly',
          monthsOfHistory: 6,
          isFixedRecurring: false,
        }],
        budgetOutlook: [],
        forecastByCategory: new Map(),
      },
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].action_type).toBe('anomaly');
    expect(anomalies[0].severity).toBe('high');
    expect(JSON.parse(anomalies[0].metadata).expected_monthly).toBe(800);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('returns an empty anomaly list when category anomaly detection fails', async () => {
    smartActionsService.__setDatabase({
      getClient: vi.fn().mockRejectedValue(new Error('db down')),
    });

    const anomalies = await smartActionsService.detectCategoryAnomalies({
      forecastData: { patterns: [], budgetOutlook: [], forecastByCategory: new Map() },
    });

    expect(anomalies).toEqual([]);
  });

  it('detects fixed category variations with min/max metadata', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('scm.variability_type = \'fixed\'')) {
        return {
          rows: [{
            category_definition_id: 22,
            category_name: 'Insurance',
            category_name_en: 'Insurance',
            current_count: 3,
            current_avg: 100,
            current_min: 70,
            current_max: 140,
            current_stddev_pop: 20,
          }],
        };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const variations = await smartActionsService.detectFixedCategoryVariations({ locale: 'en' });

    expect(variations).toHaveLength(1);
    expect(variations[0].action_type).toBe('fixed_variation');
    expect(variations[0].severity).toBe('medium');
    const metadata = JSON.parse(variations[0].metadata);
    expect(metadata.min_amount).toBe(70);
    expect(metadata.max_amount).toBe(140);
  });

  it('detects unusual purchases using z-score threshold', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('ORDER BY amount DESC') && text.includes('LIMIT 100')) {
        return {
          rows: [{
            identifier: 'txn-1',
            vendor: 'electronics-store',
            date: '2026-02-08',
            name: 'Laptop',
            amount: 1000,
            category_definition_id: 33,
            category_name: 'Shopping',
            category_name_en: 'Shopping',
          }],
        };
      }
      if (text.includes('AVG(ABS(price)) as avg_amount') && text.includes('transaction_count')) {
        return { rows: [{ avg_amount: 100, transaction_count: 8, total_amount: 800 }] };
      }
      if (text.includes('as std_dev')) {
        return { rows: [{ std_dev: 200 }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const purchases = await smartActionsService.detectUnusualPurchases({ locale: 'en' });

    expect(purchases).toHaveLength(1);
    expect(purchases[0].action_type).toBe('unusual_purchase');
    expect(purchases[0].severity).toBe('high');
    expect(JSON.parse(purchases[0].metadata).z_score).toBeGreaterThan(2);
  });

  it('generates smart actions with forecast-based budget and optimization breakdowns', async () => {
    const forecastData = {
      budgetOutlook: [
        {
          budgetId: 101,
          categoryDefinitionId: 44,
          categoryName: 'Dining',
          categoryNameEn: 'Dining',
          limit: 1000,
          utilization: 1.1,
          actualSpent: 1100,
          forecasted: 120,
          projectedTotal: 1220,
          status: 'exceeded',
          risk: 0.95,
          nextLikelyHitDate: '2026-02-12T00:00:00.000Z',
        },
        {
          budgetId: 202,
          categoryDefinitionId: 55,
          categoryName: 'Travel',
          categoryNameEn: 'Travel',
          limit: 2000,
          utilization: 0.3,
          actualSpent: 500,
          forecasted: 100,
          projectedTotal: 900,
          status: 'on_track',
          risk: 0.2,
        },
      ],
      patterns: [
        {
          categoryDefinitionId: 44,
          categoryName: 'Dining',
          categoryNameEn: 'Dining',
          monthsOfHistory: 5,
          coefficientOfVariation: 0.5,
          avgAmount: 280,
          minAmount: 130,
          maxAmount: 400,
          confidence: 0.4,
          patternType: 'weekly',
          avgOccurrencesPerMonth: 0.3,
          isFixedAmount: false,
          isFixedRecurring: false,
        },
        {
          categoryDefinitionId: 66,
          categoryName: 'Entertainment',
          categoryNameEn: 'Entertainment',
          monthsOfHistory: 6,
          coefficientOfVariation: 0.6,
          avgAmount: 300,
          minAmount: 100,
          maxAmount: 520,
          confidence: 0.7,
          patternType: 'weekly',
          avgOccurrencesPerMonth: 0.4,
          isFixedAmount: false,
          isFixedRecurring: false,
        },
      ],
    };

    vi.spyOn(forecastService, 'getForecast').mockResolvedValue(forecastData);

    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SUM(ABS(t.price)) as current_total')) {
        return { rows: [] };
      }
      if (text.includes('scm.variability_type = \'fixed\'')) {
        return { rows: [] };
      }
      if (text.includes('ORDER BY amount DESC') && text.includes('LIMIT 100')) {
        return { rows: [] };
      }
      if (text.includes('SELECT id FROM smart_action_items') && text.includes('recurrence_key')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    smartActionsService.__setDatabase({
      getClient: vi.fn().mockResolvedValue(client),
    });

    const result = await smartActionsService.generateSmartActions({ force: true, locale: 'en' });

    expect(result.success).toBe(true);
    expect(result.total_detected).toBeGreaterThan(0);
    expect(result.breakdown.budget_overruns).toBe(1);
    expect(result.breakdown.optimization_opportunities).toBeGreaterThanOrEqual(2);
  });

  it('generates quests across multiple quest types and inserts new rows', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('COUNT(*) as count') && text.includes('quest_%')) {
        return { rows: [{ count: 0 }] };
      }
      if (text.includes('FROM spending_category_mappings')) {
        return {
          rows: [
            { category_definition_id: 1, variability_type: 'variable', name: 'Dining', name_en: 'Dining' },
            { category_definition_id: 2, variability_type: 'fixed', name: 'Insurance', name_en: 'Insurance' },
            { category_definition_id: 3, variability_type: 'variable', name: 'Entertainment', name_en: 'Entertainment' },
            { category_definition_id: 4, variability_type: 'variable', name: 'Groceries', name_en: 'Groceries' },
          ],
        };
      }
      if (text.includes('SELECT id FROM smart_action_items') && text.includes('recurrence_key')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.generateQuests({
      locale: 'en',
      force: true,
      forecastData: {
        patterns: [
          {
            categoryDefinitionId: 1,
            categoryName: 'Dining',
            categoryNameEn: 'Dining',
            avgAmount: 450,
            minAmount: 180,
            maxAmount: 700,
            confidence: 0.8,
            monthsOfHistory: 5,
            coefficientOfVariation: 0.6,
            isFixedRecurring: false,
            isFixedAmount: false,
          },
          {
            categoryDefinitionId: 2,
            categoryName: 'Insurance',
            categoryNameEn: 'Insurance',
            avgAmount: 220,
            minAmount: 210,
            maxAmount: 240,
            confidence: 0.9,
            monthsOfHistory: 6,
            coefficientOfVariation: 0.1,
            isFixedRecurring: true,
            isFixedAmount: true,
          },
          {
            categoryDefinitionId: 3,
            categoryName: 'Entertainment',
            categoryNameEn: 'Entertainment',
            avgAmount: 320,
            minAmount: 90,
            maxAmount: 500,
            confidence: 0.75,
            monthsOfHistory: 4,
            coefficientOfVariation: 0.5,
            isFixedRecurring: false,
            isFixedAmount: false,
          },
        ],
        budgetOutlook: [
          {
            budgetId: 401,
            categoryDefinitionId: 4,
            categoryName: 'Groceries',
            categoryNameEn: 'Groceries',
            limit: 1000,
            actualSpent: 900,
            projectedTotal: 1200,
            status: 'at_risk',
            risk: 0.85,
          },
          {
            budgetId: 402,
            categoryDefinitionId: 3,
            categoryName: 'Entertainment',
            categoryNameEn: 'Entertainment',
            limit: 2000,
            actualSpent: 400,
            projectedTotal: 900,
            status: 'on_track',
            risk: 0.2,
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.total_generated).toBeGreaterThan(0);
    expect(result.created).toBe(result.total_generated);
    expect(result.active_count).toBe(result.created);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('accepts a quest and sets deadline + history', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        return {
          rows: [{
            id: 77,
            action_type: 'quest_reduce_spending',
            user_status: 'active',
            quest_duration_days: 7,
            points_reward: 90,
          }],
        };
      }
      if (text.includes('COUNT(*) as count') && text.includes('quest_%')) {
        return { rows: [{ count: 1 }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.acceptQuest(77);

    expect(result.success).toBe(true);
    expect(result.quest_id).toBe(77);
    expect(result.points_reward).toBe(90);
    expect(new Date(result.deadline).getTime()).toBeGreaterThan(new Date('2026-02-10T12:00:00.000Z').getTime());
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('verifies spending-limit quest completion and awards bonus points', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        return {
          rows: [{
            id: 91,
            action_type: 'quest_reduce_spending',
            user_status: 'accepted',
            points_reward: 100,
            accepted_at: '2026-02-01T00:00:00.000Z',
            deadline: '2026-02-15T00:00:00.000Z',
            completion_criteria: JSON.stringify({
              type: 'spending_limit',
              category_definition_id: 11,
              target_amount: 500,
            }),
          }],
        };
      }
      if (text.includes('total_spent')) {
        return { rows: [{ total_spent: 300 }] };
      }
      if (text.includes('SELECT total_points FROM user_quest_stats')) {
        return { rows: [{ total_points: 125 }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.verifyQuestCompletion(91);

    expect(result.success).toBe(true);
    expect(result.new_status).toBe('resolved');
    expect(result.points_earned).toBe(125);
    expect(result.achievement_pct).toBe(140);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('lists smart actions with localized names, parsed metadata, and summary totals', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM smart_action_items sai')) {
        return {
          rows: [
            {
              id: 1,
              action_type: 'budget_overrun',
              severity: 'high',
              user_status: 'active',
              title: 'Budget warning: דיור',
              description: 'דיור is above target',
              metadata: JSON.stringify({ budget_id: 1 }),
              potential_impact: -180,
              category_name: 'דיור',
              category_name_en: 'Housing',
              category_name_fr: 'Logement',
              parent_category_name: 'הוצאות',
              parent_category_name_en: 'Expenses',
              parent_category_name_fr: 'Depenses',
            },
            {
              id: 2,
              action_type: 'anomaly',
              severity: 'medium',
              user_status: 'active',
              title: 'Spike in מזון',
              description: 'מזון increased',
              metadata: null,
              potential_impact: -50,
              category_name: 'מזון',
              category_name_en: 'Food',
              category_name_fr: 'Nourriture',
              parent_category_name: 'הוצאות',
              parent_category_name_en: 'Expenses',
              parent_category_name_fr: 'Depenses',
            },
          ],
        };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.getSmartActions({ status: 'active', locale: 'en' });

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].category_name).toBe('Housing');
    expect(result.actions[0].title).toContain('Housing');
    expect(result.actions[0].metadata).toEqual({ budget_id: 1 });
    expect(result.summary.total).toBe(2);
    expect(result.summary.by_severity.high).toBe(1);
    expect(result.summary.by_type.budget_overrun).toBe(1);
    expect(result.summary.total_potential_impact).toBe(-230);
  });

  it('updates status and records history note; throws when action id is missing', async () => {
    const successClient = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('UPDATE smart_action_items') && text.includes('RETURNING *')) {
        return { rows: [{ id: 5, user_status: 'resolved' }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(successClient);

    const updated = await smartActionsService.updateSmartActionStatus(5, 'resolved', 'done');
    expect(updated.action.id).toBe(5);
    expect(successClient.release).toHaveBeenCalledTimes(1);

    const missingClient = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('UPDATE smart_action_items') && text.includes('RETURNING *')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    setDatabaseClient(missingClient);

    await expect(
      smartActionsService.updateSmartActionStatus(999, 'resolved'),
    ).rejects.toThrow('Smart action item not found');
    expect(missingClient.release).toHaveBeenCalledTimes(1);
  });

  it('lists active quests with computed progress and time remaining', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM smart_action_items sai') && text.includes('action_type LIKE \'quest_%\'')) {
        return {
          rows: [{
            id: 14,
            action_type: 'quest_reduce_spending',
            user_status: 'accepted',
            category_name: 'מזון',
            category_name_en: 'Food',
            accepted_at: '2026-02-01T00:00:00.000Z',
            deadline: '2026-02-20T00:00:00.000Z',
            completion_criteria: JSON.stringify({
              type: 'spending_limit',
              category_definition_id: 11,
              target_amount: 500,
            }),
            metadata: JSON.stringify({ quest_type: 'reduce_spending' }),
          }],
        };
      }
      if (text.includes('total_spent')) {
        return { rows: [{ total_spent: 200 }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.getActiveQuests({ locale: 'en' });

    expect(result.count).toBe(1);
    expect(result.quests[0].category_name).toBe('Food');
    expect(result.quests[0].progress.on_track).toBe(true);
    expect(result.quests[0].progress.percentage).toBe(40);
    expect(result.quests[0].metadata.quest_type).toBe('reduce_spending');
    expect(result.quests[0].time_remaining.days).toBeGreaterThan(0);
  });

  it('returns user quest stats with streak reset and level progress', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('INSERT OR IGNORE INTO user_quest_stats')) {
        return { rows: [] };
      }
      if (text.includes('SELECT * FROM user_quest_stats WHERE id = 1')) {
        return {
          rows: [{
            id: 1,
            total_points: 250,
            current_streak: 4,
            best_streak: 9,
            quests_completed: 10,
            quests_failed: 1,
            quests_declined: 2,
            level: 2,
            last_completed_at: '2025-12-20T00:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const stats = await smartActionsService.getUserQuestStats();

    expect(stats.streak_reset).toBe(true);
    expect(stats.current_streak).toBe(0);
    expect(stats.level_progress.current_level).toBe(2);
    expect(stats.level_progress.next_level).toBe(3);
    expect(stats.level_progress.points_needed).toBe(50);
  });

  it('checks deadlines without verification work when no accepted quests are expired', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('deadline < datetime(\'now\')')) {
        return { rows: [] };
      }
      if (text.includes('COUNT(*) as count') && text.includes('quest_%')) {
        return { rows: [{ count: 5 }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.checkQuestDeadlines();

    expect(result.checked).toBe(0);
    expect(result.active_quests).toBe(5);
    expect(result.new_quests_generated).toBe(0);
    expect(result.verified).toBe(0);
    expect(result.failed).toBe(0);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('detects fixed recurring amount changes, missing/late payments, upcoming reminders, and duplicates', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM transactions t') && text.includes('t.category_definition_id IN')) {
        return {
          rows: [
            { category_definition_id: 101, date: '2026-02-09', amount: 130, name: 'Gym Membership' },
            { category_definition_id: 104, date: '2026-02-02', amount: 60, name: 'Cloud Storage' },
            { category_definition_id: 104, date: '2026-02-07', amount: 60, name: 'Cloud Storage' },
          ],
        };
      }
      if (text.includes('SUM(ABS(t.price)) as current_total')) {
        return { rows: [] };
      }
      if (text.includes('scm.variability_type = \'fixed\'')) {
        return { rows: [] };
      }
      if (text.includes('ORDER BY amount DESC') && text.includes('LIMIT 100')) {
        return { rows: [] };
      }
      if (text.includes('SELECT id FROM smart_action_items') && text.includes('recurrence_key')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const forecastData = {
      budgetOutlook: [],
      patterns: [
        {
          categoryDefinitionId: 101,
          categoryName: 'Gym',
          categoryNameEn: 'Gym',
          patternType: 'monthly',
          monthsOfHistory: 6,
          avgOccurrencesPerMonth: 1,
          confidence: 0.9,
          isFixedAmount: true,
          isFixedRecurring: true,
          fixedAmount: 100,
          fixedDayOfMonth: 5,
          mostLikelyDaysOfMonth: [{ day: 5 }],
          coefficientOfVariation: 0.1,
          avgAmount: 100,
        },
        {
          categoryDefinitionId: 102,
          categoryName: 'Insurance',
          categoryNameEn: 'Insurance',
          patternType: 'monthly',
          monthsOfHistory: 6,
          avgOccurrencesPerMonth: 1,
          confidence: 0.8,
          isFixedAmount: true,
          isFixedRecurring: true,
          fixedAmount: 220,
          fixedDayOfMonth: 5,
          mostLikelyDaysOfMonth: [{ day: 5 }],
          avgAmount: 220,
        },
        {
          categoryDefinitionId: 103,
          categoryName: 'Internet',
          categoryNameEn: 'Internet',
          patternType: 'monthly',
          monthsOfHistory: 6,
          avgOccurrencesPerMonth: 1,
          confidence: 0.75,
          isFixedAmount: true,
          isFixedRecurring: true,
          fixedAmount: 140,
          fixedDayOfMonth: 12,
          mostLikelyDaysOfMonth: [{ day: 12 }],
          avgAmount: 140,
        },
        {
          categoryDefinitionId: 104,
          categoryName: 'Cloud',
          categoryNameEn: 'Cloud',
          patternType: 'monthly',
          monthsOfHistory: 6,
          avgOccurrencesPerMonth: 1,
          confidence: 0.85,
          isFixedAmount: true,
          isFixedRecurring: true,
          fixedAmount: 50,
          fixedDayOfMonth: 4,
          mostLikelyDaysOfMonth: [{ day: 4 }],
          avgAmount: 50,
        },
      ],
      forecastByCategory: new Map(),
    };

    vi.spyOn(forecastService, 'getForecast').mockResolvedValueOnce(forecastData);

    const result = await smartActionsService.generateSmartActions({ force: true, locale: 'en' });

    expect(result.success).toBe(true);
    expect(result.breakdown.fixed_recurring_anomalies).toBeGreaterThanOrEqual(4);
    expect(client.release).toHaveBeenCalled();
  });

  it('detects at-risk budget overruns and returns empty list when forecast fetch fails', async () => {
    const warnings = await smartActionsService.detectBudgetOverruns({
      locale: 'en',
      forecastData: {
        budgetOutlook: [
          {
            budgetId: 501,
            categoryDefinitionId: 77,
            categoryName: 'Fuel',
            categoryNameEn: 'Fuel',
            limit: 1000,
            utilization: 0.86,
            actualSpent: 860,
            forecasted: 180,
            projectedTotal: 1040,
            status: 'at_risk',
            risk: 0.72,
            alertThreshold: 0.8,
          },
        ],
      },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('high');
    expect(warnings[0].action_type).toBe('budget_overrun');

    vi.spyOn(forecastService, 'getForecast').mockRejectedValueOnce(new Error('forecast offline'));
    await expect(
      smartActionsService.detectBudgetOverruns({ locale: 'en' }),
    ).resolves.toEqual([]);
  });

  it('returns early from quest generation when active quest limit is reached and force is false', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('COUNT(*) as count') && text.includes('quest_%')) {
        return { rows: [{ count: 5 }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.generateQuests({ locale: 'en', force: false });
    expect(result.success).toBe(true);
    expect(result.created).toBe(0);
    expect(result.active_count).toBe(5);
    expect(result.message).toContain('Maximum active quests reached');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rejects acceptQuest for missing quests, non-quests, invalid statuses, and max active limits', async () => {
    const missingClient = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    setDatabaseClient(missingClient);
    await expect(smartActionsService.acceptQuest(1)).rejects.toThrow('Quest not found');

    const nonQuestClient = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        return { rows: [{ id: 2, action_type: 'anomaly', user_status: 'active' }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(nonQuestClient);
    await expect(smartActionsService.acceptQuest(2)).rejects.toThrow('not a quest');

    const invalidStatusClient = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        return { rows: [{ id: 3, action_type: 'quest_set_budget', user_status: 'dismissed' }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(invalidStatusClient);
    await expect(smartActionsService.acceptQuest(3)).rejects.toThrow('cannot be accepted');

    const maxedClient = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        return {
          rows: [{
            id: 4,
            action_type: 'quest_set_budget',
            user_status: 'active',
            quest_duration_days: 7,
            points_reward: 50,
          }],
        };
      }
      if (text.includes('COUNT(*) as count') && text.includes('quest_%')) {
        return { rows: [{ count: 5 }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(maxedClient);
    await expect(smartActionsService.acceptQuest(4)).rejects.toThrow('Maximum active quests reached');
  });

  it('declines quests and rejects invalid decline attempts', async () => {
    const successClient = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        return { rows: [{ id: 12, action_type: 'quest_budget_adherence', user_status: 'active' }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(successClient);
    await expect(smartActionsService.declineQuest(12)).resolves.toEqual({ success: true, quest_id: 12 });

    const nonQuestClient = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        return { rows: [{ id: 13, action_type: 'anomaly', user_status: 'active' }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(nonQuestClient);
    await expect(smartActionsService.declineQuest(13)).rejects.toThrow('not a quest');
  });

  it('verifies budget-adherence quests and grants full points without bonus', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        return {
          rows: [{
            id: 201,
            action_type: 'quest_budget_adherence',
            user_status: 'accepted',
            points_reward: 80,
            accepted_at: '2026-02-01T00:00:00.000Z',
            deadline: '2026-02-20T00:00:00.000Z',
            completion_criteria: JSON.stringify({
              type: 'budget_adherence',
              category_definition_id: 10,
              target_limit: 300,
            }),
          }],
        };
      }
      if (text.includes('total_spent')) {
        return { rows: [{ total_spent: 250 }] };
      }
      if (text.includes('SELECT total_points FROM user_quest_stats')) {
        return { rows: [{ total_points: 240 }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.verifyQuestCompletion(201);
    expect(result.success).toBe(true);
    expect(result.new_status).toBe('resolved');
    expect(result.points_earned).toBe(80);
  });

  it('verifies budget-exists quests and records failed progress when no budget is set', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        return {
          rows: [{
            id: 202,
            action_type: 'quest_set_budget',
            user_status: 'accepted',
            points_reward: 90,
            accepted_at: '2026-02-01T00:00:00.000Z',
            deadline: '2026-02-20T00:00:00.000Z',
            completion_criteria: JSON.stringify({
              type: 'budget_exists',
              category_definition_id: 88,
            }),
          }],
        };
      }
      if (text.includes('SELECT id FROM category_budgets')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.verifyQuestCompletion(202);
    expect(result.success).toBe(false);
    expect(result.new_status).toBe('failed');
    expect(result.points_earned).toBe(0);
    expect(
      client.query.mock.calls.some(([sql]) => String(sql).includes('quests_failed = quests_failed + 1')),
    ).toBe(true);
  });

  it('verifies fixed-cost reduction quests and grants bonus points for strong improvement', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        return {
          rows: [{
            id: 203,
            action_type: 'quest_reduce_fixed_cost',
            user_status: 'accepted',
            points_reward: 80,
            accepted_at: '2026-02-01T00:00:00.000Z',
            deadline: '2026-03-01T00:00:00.000Z',
            completion_criteria: JSON.stringify({
              type: 'fixed_cost_reduction',
              category_definition_id: 19,
              baseline_amount: 200,
            }),
          }],
        };
      }
      if (text.includes('AVG(ABS(price)) as avg_recent')) {
        return { rows: [{ avg_recent: 150 }] };
      }
      if (text.includes('SELECT total_points FROM user_quest_stats')) {
        return { rows: [{ total_points: 400 }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.verifyQuestCompletion(203);
    expect(result.success).toBe(true);
    expect(result.points_earned).toBe(100);
    expect(result.achievement_pct).toBe(125);
  });

  it('supports manual savings-transfer verification with partial credit and resolved status', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        return {
          rows: [{
            id: 204,
            action_type: 'quest_savings_target',
            user_status: 'accepted',
            points_reward: 120,
            accepted_at: '2026-02-01T00:00:00.000Z',
            deadline: '2026-02-28T00:00:00.000Z',
            completion_criteria: JSON.stringify({
              type: 'savings_transfer',
              target_amount: 500,
            }),
          }],
        };
      }
      if (text.includes('SELECT total_points FROM user_quest_stats')) {
        return { rows: [{ total_points: 700 }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.verifyQuestCompletion(204, { amount: 450 });
    expect(result.success).toBe(false);
    expect(result.new_status).toBe('resolved');
    expect(result.points_earned).toBe(60);
    expect(result.achievement_pct).toBe(90);
  });

  it('applies optional severity/actionType filters when listing smart actions', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM smart_action_items sai')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.getSmartActions({
      status: 'active',
      severity: 'high',
      actionType: 'budget_overrun',
      locale: 'en',
    });

    expect(result.actions).toEqual([]);
    const queryCall = client.query.mock.calls.find(([sql]) => String(sql).includes('FROM smart_action_items sai'));
    expect(String(queryCall[0])).toContain('AND sai.severity = $2');
    expect(String(queryCall[0])).toContain('AND sai.action_type = $3');
    expect(queryCall[1]).toEqual(['active', 'high', 'budget_overrun']);
  });

  it('updates dismissed and snoozed status fields for smart actions', async () => {
    const client = createClient(async (sql) => {
      const text = String(sql);
      if (text.includes('UPDATE smart_action_items') && text.includes('RETURNING *')) {
        return { rows: [{ id: 300, user_status: 'dismissed' }] };
      }
      return { rows: [] };
    });
    setDatabaseClient(client);

    await smartActionsService.updateSmartActionStatus(300, 'dismissed');
    await smartActionsService.updateSmartActionStatus(301, 'snoozed');

    const updateCalls = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE smart_action_items') && String(sql).includes('RETURNING *'),
    );
    expect(String(updateCalls[0][0])).toContain('dismissed_at = datetime(\'now\')');
    expect(String(updateCalls[1][0])).toContain('snoozed_until = datetime(\'now\', \'+7 days\')');
  });

  it('checks expired quest deadlines with verified, failed, and error outcomes', async () => {
    let activeCountQueryCalls = 0;
    const client = createClient(async (sql, params = []) => {
      const text = String(sql);

      if (text.includes('deadline < datetime(\'now\')')) {
        return { rows: [{ id: 701 }, { id: 702 }, { id: 703 }] };
      }

      if (text.includes('SELECT * FROM smart_action_items WHERE id = $1')) {
        const questId = params[0];
        if (questId === 701) {
          return {
            rows: [{
              id: 701,
              action_type: 'quest_reduce_spending',
              user_status: 'accepted',
              points_reward: 80,
              accepted_at: '2026-02-01T00:00:00.000Z',
              deadline: '2026-02-09T00:00:00.000Z',
              completion_criteria: JSON.stringify({
                type: 'spending_limit',
                category_definition_id: 11,
                target_amount: 500,
              }),
            }],
          };
        }
        if (questId === 702) {
          return {
            rows: [{
              id: 702,
              action_type: 'quest_set_budget',
              user_status: 'accepted',
              points_reward: 70,
              accepted_at: '2026-02-01T00:00:00.000Z',
              deadline: '2026-02-09T00:00:00.000Z',
              completion_criteria: JSON.stringify({
                type: 'budget_exists',
                category_definition_id: 44,
              }),
            }],
          };
        }
        return { rows: [] };
      }

      if (text.includes('COALESCE(SUM(ABS(price)), 0) as total_spent')) {
        return { rows: [{ total_spent: 300 }] };
      }

      if (text.includes('SELECT id FROM category_budgets')) {
        return { rows: [] };
      }

      if (text.includes('SELECT total_points FROM user_quest_stats')) {
        return { rows: [{ total_points: 300 }] };
      }

      if (text.includes('COUNT(*) as count') && text.includes('quest_%')) {
        activeCountQueryCalls += 1;
        if (activeCountQueryCalls === 1) return { rows: [{ count: 1 }] };
        return { rows: [{ count: 5 }] };
      }

      return { rows: [] };
    });
    setDatabaseClient(client);

    const result = await smartActionsService.checkQuestDeadlines();
    expect(result.checked).toBe(3);
    expect(result.verified).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].quest_id).toBe(703);
    expect(result.active_quests).toBe(1);
    expect(result.new_quests_generated).toBe(0);
  });
});
