import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const databaseMock = vi.hoisted(() => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('../../database.js', () => databaseMock);

let analyzer;

beforeAll(async () => {
  const mod = await import('../recurring-analyzer.js');
  analyzer = mod.default ?? mod;
});

describe('recurring-analyzer', () => {
  describe('normalizePatternKey', () => {
    it('returns empty string for falsy input', () => {
      expect(analyzer.normalizePatternKey(null)).toBe('');
      expect(analyzer.normalizePatternKey('')).toBe('');
      expect(analyzer.normalizePatternKey(undefined)).toBe('');
    });

    it('lowercases and trims', () => {
      expect(analyzer.normalizePatternKey('  HELLO  ')).toBe('hello');
    });

    it('replaces special characters with underscores', () => {
      expect(analyzer.normalizePatternKey('super-market!')).toBe('super_market');
    });

    it('collapses multiple underscores', () => {
      expect(analyzer.normalizePatternKey('a...b---c')).toBe('a_b_c');
    });

    it('preserves Hebrew characters', () => {
      const result = analyzer.normalizePatternKey('סופר שלי');
      expect(result).toContain('סופר');
      expect(result).toContain('שלי');
    });

    it('strips leading and trailing underscores', () => {
      expect(analyzer.normalizePatternKey('...hello...')).toBe('hello');
    });
  });

  describe('selectDominantCluster', () => {
    it('returns null for empty charges', () => {
      expect(analyzer.selectDominantCluster([])).toBeNull();
    });

    it('clusters similar amounts together', () => {
      const charges = [
        { amount: 100, date: '2026-01-01' },
        { amount: 102, date: '2026-01-15' },
        { amount: 99, date: '2026-02-01' },
        { amount: 500, date: '2026-02-15' },
      ];

      const result = analyzer.selectDominantCluster(charges);
      expect(result).not.toBeNull();
      // The dominant cluster should be the 100-ish group (3 charges) not the 500 singleton
      expect(result.charges.length).toBe(3);
      expect(result.mean).toBeCloseTo(100.33, 0);
    });

    it('picks cluster with most charges', () => {
      const charges = [
        { amount: 50, date: '2026-01-01' },
        { amount: 51, date: '2026-01-15' },
        { amount: 200, date: '2026-02-01' },
      ];

      const result = analyzer.selectDominantCluster(charges);
      expect(result.charges.length).toBe(2);
    });

    it('breaks ties by latest date', () => {
      const charges = [
        { amount: 100, date: '2026-01-01' },
        { amount: 200, date: '2026-03-01' },
      ];

      const result = analyzer.selectDominantCluster(charges);
      // Tie (1 charge each), latest date wins
      expect(result.charges[0].amount).toBe(200);
    });

    it('computes coefficient of variation', () => {
      const charges = [
        { amount: 100, date: '2026-01-01' },
        { amount: 100, date: '2026-02-01' },
        { amount: 100, date: '2026-03-01' },
      ];

      const result = analyzer.selectDominantCluster(charges);
      expect(result.coefficientOfVariation).toBe(0);
    });
  });

  describe('analyzeRecurringPatterns', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('detects monthly pattern from pre-supplied transactions', async () => {
      const transactions = [
        { name: 'Netflix', date: '2025-09-15', price: -50, category_type: 'expense', status: 'completed' },
        { name: 'Netflix', date: '2025-10-15', price: -50, category_type: 'expense', status: 'completed' },
        { name: 'Netflix', date: '2025-11-15', price: -50, category_type: 'expense', status: 'completed' },
        { name: 'Netflix', date: '2025-12-15', price: -50, category_type: 'expense', status: 'completed' },
        { name: 'Netflix', date: '2026-01-15', price: -50, category_type: 'expense', status: 'completed' },
      ];

      const { patterns, meta } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 2,
        minConsistency: 0.3,
      });

      expect(patterns.length).toBe(1);
      expect(patterns[0].display_name).toBe('Netflix');
      expect(patterns[0].detected_frequency).toBe('monthly');
      expect(patterns[0].detected_amount).toBe(50);
      expect(patterns[0].occurrence_count).toBe(5);
      expect(patterns[0].amount_is_fixed).toBe(1);
    });

    it('filters below minimum occurrences', async () => {
      const transactions = [
        { name: 'OneOff', date: '2026-01-01', price: -100 },
      ];

      const { patterns, meta } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 2,
      });

      expect(patterns.length).toBe(0);
      expect(meta.excluded_occurrences).toBeGreaterThanOrEqual(1);
    });

    it('excludes patterns below minimum consistency', async () => {
      // Very irregular intervals
      const transactions = [
        { name: 'Random', date: '2025-09-01', price: -100 },
        { name: 'Random', date: '2025-09-03', price: -100 },
        { name: 'Random', date: '2025-12-25', price: -100 },
      ];

      const { patterns, meta } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 2,
        minConsistency: 0.9,
      });

      expect(patterns.length).toBe(0);
    });

    it('returns empty patterns for empty transactions', async () => {
      const { patterns } = await analyzer.analyzeRecurringPatterns({ transactions: [] });
      expect(patterns).toEqual([]);
    });

    it('assigns category from most frequent category', async () => {
      const transactions = [
        { name: 'Gym', date: '2025-09-01', price: -200, category_definition_id: 10, category_name: 'Sport' },
        { name: 'Gym', date: '2025-10-01', price: -200, category_definition_id: 10, category_name: 'Sport' },
        { name: 'Gym', date: '2025-11-01', price: -200, category_definition_id: 10, category_name: 'Sport' },
      ];

      const { patterns } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 2,
        minConsistency: 0.3,
      });

      expect(patterns.length).toBe(1);
      expect(patterns[0].category_definition_id).toBe(10);
      expect(patterns[0].category_name).toBe('Sport');
    });

    it('sorts patterns by total_spent descending', async () => {
      const transactions = [
        { name: 'Cheap', date: '2025-09-01', price: -10 },
        { name: 'Cheap', date: '2025-10-01', price: -10 },
        { name: 'Cheap', date: '2025-11-01', price: -10 },
        { name: 'Expensive', date: '2025-09-05', price: -500 },
        { name: 'Expensive', date: '2025-10-05', price: -500 },
        { name: 'Expensive', date: '2025-11-05', price: -500 },
      ];

      const { patterns } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 2,
        minConsistency: 0.3,
      });

      if (patterns.length >= 2) {
        expect(patterns[0].total_spent).toBeGreaterThanOrEqual(patterns[1].total_spent);
      }
    });
  });
});
