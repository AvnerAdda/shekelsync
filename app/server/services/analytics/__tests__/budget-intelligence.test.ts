import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as budgetIntelligence from '../budget-intelligence.js';

describe('budget intelligence service', () => {
  afterEach(() => {
    budgetIntelligence.__resetDatabase();
    vi.restoreAllMocks();
  });

  describe('calculateBudgetStats', () => {
    it('returns null when no data or zero mean', () => {
      expect(budgetIntelligence.calculateBudgetStats([])).toBeNull();
      expect(budgetIntelligence.calculateBudgetStats([0, 0, 0])).toBeNull();
    });

    it('computes confidence bands and suggested limit', () => {
      const stats = budgetIntelligence.calculateBudgetStats([100, 110, 90, 105]);

      expect(stats).toMatchObject({
        basedOnMonths: 4,
        mean: expect.closeTo(101.25, 2),
        median: 105,
        min: 90,
        max: 110,
        suggestedLimit: expect.closeTo(111.38, 2), // mean + 10%
      });
      expect(stats.confidence).toBeGreaterThan(0.8); // low variability -> high confidence
    });
  });

  describe('ensureBaselineBudgets', () => {
    const clientA = { query: vi.fn(), release: vi.fn() };
    const clientB = { query: vi.fn(), release: vi.fn() };
    const getClient = vi.fn();

    beforeEach(() => {
      vi.clearAllMocks();
      getClient.mockResolvedValue(clientA);
      budgetIntelligence.__setDatabase({ getClient });
    });

    it('skips activation when active budgets already exist', async () => {
      clientA.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });
      const generateSpy = vi
        .spyOn(budgetIntelligence, 'generateBudgetSuggestions')
        .mockResolvedValue({ success: true, total_suggestions: 0 });

      const result = await budgetIntelligence.ensureBaselineBudgets({ periodType: 'monthly' });

      expect(result).toEqual({ activated: 0 });
      expect(generateSpy).not.toHaveBeenCalled();
      expect(clientA.release).toHaveBeenCalledTimes(1);
    });

    it('activates new suggestions when none exist', async () => {
      getClient.mockReset();
      getClient.mockResolvedValueOnce(clientA).mockResolvedValueOnce(clientB).mockResolvedValue(clientB);
      budgetIntelligence.__setDatabase({ getClient });
      // First client: active budget count query
      clientA.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      clientA.release.mockResolvedValue();
      // Second client: passed to fetchBudgetSuggestions
      clientB.query.mockResolvedValue({
        rows: [
          {
            id: 1,
            category_definition_id: 10,
            period_type: 'monthly',
            suggested_limit: 100,
            confidence_score: 0.9,
            variability_coefficient: 0.1,
            based_on_months: 3,
            historical_data: null,
            calculation_metadata: null,
            active_budget_id: null,
          },
          {
            id: 2,
            category_definition_id: 11,
            period_type: 'monthly',
            suggested_limit: 120,
            confidence_score: 0.8,
            variability_coefficient: 0.2,
            based_on_months: 4,
            historical_data: null,
            calculation_metadata: null,
            active_budget_id: null,
          },
        ],
      });
      getClient.mockResolvedValueOnce(clientA).mockResolvedValueOnce(clientB);

      vi.spyOn(budgetIntelligence, 'generateBudgetSuggestions').mockResolvedValue({ success: true });
      vi.spyOn(budgetIntelligence, 'fetchBudgetSuggestions').mockResolvedValue([
        {
          id: 1,
          category_definition_id: 10,
          period_type: 'monthly',
          suggested_limit: 100,
          confidence_score: 0.9,
          has_active_budget: false,
        },
        {
          id: 2,
          category_definition_id: 11,
          period_type: 'monthly',
          suggested_limit: 120,
          confidence_score: 0.8,
          has_active_budget: false,
        },
      ]);
      const activateSpy = vi
        .spyOn(budgetIntelligence, 'activateBudgetSuggestion')
        .mockResolvedValue({ success: true });

      const result = await budgetIntelligence.ensureBaselineBudgets({ maxBudgets: 2, minConfidence: 0.5 });

      expect(result).toEqual({ activated: 2 });
      expect(activateSpy).toHaveBeenCalledTimes(2);
      expect(clientB.release).toHaveBeenCalledTimes(1);
    });
  });
});
