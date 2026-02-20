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

    it('updates the dominant cluster when a later cluster has more charges', () => {
      const charges = [
        { amount: 10, date: '2026-01-01' },
        { amount: 100, date: '2026-01-05' },
        { amount: 101, date: '2026-02-05' },
      ];

      const result = analyzer.selectDominantCluster(charges, { tolerancePct: 0.01, minTolerance: 0 });
      expect(result.charges.length).toBe(2);
      expect(result.mean).toBeCloseTo(100.5, 1);
    });

    it('breaks equal-size and equal-recency ties by total amount', () => {
      const charges = [
        { amount: 10, date: '2026-01-01' },
        { amount: 12, date: '2026-03-01' },
        { amount: 30, date: '2026-02-01' },
        { amount: 32, date: '2026-03-01' },
      ];

      const result = analyzer.selectDominantCluster(charges, { minTolerance: 3 });
      expect(result.total).toBe(62);
      expect(result.mean).toBeCloseTo(31, 1);
    });

    it('returns zero variation when the dominant mean is zero', () => {
      const charges = [
        { amount: 0, date: '2026-01-01' },
        { amount: 0, date: '2026-02-01' },
      ];

      const result = analyzer.selectDominantCluster(charges);
      expect(result.coefficientOfVariation).toBe(0);
    });
  });

  describe('analyzeRecurringPatterns', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      databaseMock.query.mockReset();
      databaseMock.getClient.mockReset();
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

    it('excludes variable patterns when detected amount is below minVariableAmount', async () => {
      const transactions = [
        { name: 'Odd Bill', date: '2025-01-01', price: -10 },
        { name: 'Odd Bill', date: '2025-01-02', price: -10 },
        { name: 'Odd Bill', date: '2025-04-12', price: -10 },
      ];

      const { patterns, meta } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 2,
        minConsistency: 0.4,
        minVariableAmount: 50,
      });

      expect(patterns).toEqual([]);
      expect(meta.excluded_amount).toBe(1);
    });

    it('excludes non-variable patterns below minAmount', async () => {
      const transactions = [
        { name: 'Low Subscription', date: '2025-01-01', price: -30 },
        { name: 'Low Subscription', date: '2025-02-01', price: -30 },
        { name: 'Low Subscription', date: '2025-03-01', price: -30 },
      ];

      const { patterns, meta } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 2,
        minConsistency: 0.3,
        minAmount: 40,
        minVariableAmount: 0,
      });

      expect(patterns).toEqual([]);
      expect(meta.excluded_amount).toBe(1);
    });

    it('falls back to full-charge average when dominant cluster is below minOccurrences', async () => {
      const transactions = [
        {
          name: 'Gym Membership',
          date: '2025-01-01',
          price: -10,
          category_definition_id: 1,
          category_name: 'Fitness',
        },
        {
          name: 'gym membership',
          date: '2025-02-01',
          price: -200,
          category_definition_id: 2,
          category_name: 'Wellness',
        },
        {
          name: 'Gym Membership',
          date: '2025-03-01',
          price: -400,
          category_definition_id: 2,
          category_name: 'Wellness',
        },
      ];

      const { patterns } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 3,
        minConsistency: 0.1,
        minVariableAmount: 0,
      });

      expect(patterns).toHaveLength(1);
      expect(patterns[0].display_name).toBe('Gym Membership');
      expect(patterns[0].detected_amount).toBeCloseTo(203.33, 2);
      expect(patterns[0].category_definition_id).toBe(2);
      expect(patterns[0].category_name).toBe('Wellness');
      expect(patterns[0].amount_stddev).toBeGreaterThan(0);
    });

    it('loads transactions from database when transactions are not provided', async () => {
      databaseMock.query.mockResolvedValueOnce({
        rows: [
          { name: 'Spotify', date: '2025-01-01', price: -50, category_type: 'expense', status: 'completed' },
          { name: 'Spotify', date: '2025-02-01', price: -50, category_type: 'expense', status: 'completed' },
        ],
      });

      const { patterns } = await analyzer.analyzeRecurringPatterns({
        client: databaseMock,
        monthsBack: 2,
        minOccurrences: 2,
        minConsistency: 0.2,
        excludePairingExclusions: true,
        excludeCreditCardRepayments: true,
      });

      expect(databaseMock.query).toHaveBeenCalledTimes(1);
      const [sql] = databaseMock.query.mock.calls[0];
      expect(String(sql)).toContain('transaction_pairing_exclusions');
      expect(String(sql)).toContain('tpe.transaction_identifier IS NULL');
      expect(patterns).toHaveLength(1);
    });

    it('handles missing rows payload when loading transactions', async () => {
      databaseMock.query.mockResolvedValueOnce({});

      const { patterns } = await analyzer.analyzeRecurringPatterns({
        client: databaseMock,
        monthsBack: 2,
        minOccurrences: 2,
        minConsistency: 0.2,
        excludePairingExclusions: false,
        excludeCreditCardRepayments: false,
      });

      expect(databaseMock.query).toHaveBeenCalledTimes(1);
      const [sql] = databaseMock.query.mock.calls[0];
      expect(String(sql)).not.toContain('transaction_pairing_exclusions');
      expect(String(sql)).not.toContain('tpe.transaction_identifier IS NULL');
      expect(String(sql)).not.toContain('AND (cd.id IS NULL OR NOT');
      expect(patterns).toEqual([]);
    });

    it('skips credit-card repayment rows when exclusion is enabled', async () => {
      const transactions = [
        { name: 'Card Settlement', date: '2025-01-01', price: -400, category_name_en: 'Credit Card Repayment' },
        { name: 'Card Settlement', date: '2025-02-01', price: -400, category_name_en: 'Credit Card Repayment' },
        { name: 'Internet', date: '2025-01-05', price: -80 },
        { name: 'Internet', date: '2025-02-05', price: -80 },
      ];

      const { patterns } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 2,
        minConsistency: 0.2,
        excludeCreditCardRepayments: true,
      });

      expect(patterns.some((pattern) => pattern.pattern_key.includes('card'))).toBe(false);
      expect(patterns.some((pattern) => pattern.display_name === 'Internet')).toBe(true);
    });

    it('skips invalid normalized rows and rows without charge date', async () => {
      const transactions = [
        { name: '   ', vendor: '   ', date: '2025-01-01', price: -40 },
        { name: '!!!', date: '2025-01-01', price: -40 },
        { name: 'Vendor Plan', date: null, price: -40 },
        { name: '', vendor: 'Vendor Plan', date: '2025-01-01', price: -40 },
        { name: 'Vendor Plan', date: '2025-02-01', price: -40 },
        { name: 'Vendor Plan', date: '2025-03-01', amount: '-40' },
        { name: 'Vendor Plan', date: '2025-03-15' },
        { name: 'Vendor Plan', date: '2025-04-01', amount: 'not-a-number' },
      ];

      const { patterns } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 2,
        minConsistency: 0.1,
      });

      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern_key).toBe('vendor_plan');
    });

    it('aggregates charges that share the same date when aggregateBy is day', async () => {
      const transactions = [
        { name: 'Lunch Box', date: '2025-01-01', price: -10 },
        { name: 'Lunch Box', date: '2025-01-01', price: -15 },
        { name: 'Lunch Box', date: '2025-02-01', price: -20 },
      ];

      const { patterns } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 2,
        minConsistency: 0.2,
      });

      expect(patterns).toHaveLength(1);
      expect(patterns[0].occurrence_count).toBe(2);
      expect(patterns[0].total_spent).toBe(45);
    });

    it('handles duplicate transaction dates when aggregateBy is not day', async () => {
      const transactions = [
        { name: 'Coin Jar', date: '2025-01-01', price: -60 },
        { name: 'Coin Jar', date: '2025-01-01', price: -60 },
      ];

      const { patterns, meta } = await analyzer.analyzeRecurringPatterns({
        transactions,
        aggregateBy: 'transaction',
        minOccurrences: 2,
        minConsistency: 0.4,
        minVariableAmount: 0,
      });

      expect(patterns).toEqual([]);
      expect(meta.excluded_consistency).toBe(1);
    });

    it('supports single-occurrence patterns when minOccurrences is one', async () => {
      const transactions = [
        { name: 'One Shot', date: '2025-01-01', price: -75 },
      ];

      const { patterns } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 1,
        minConsistency: 0,
        minVariableAmount: 0,
      });

      expect(patterns).toHaveLength(1);
      expect(patterns[0].occurrence_count).toBe(1);
      expect(patterns[0].amount_stddev).toBe(0);
    });

    it('drops candidates when amount fields are missing or invalid', async () => {
      const transactions = [
        { name: 'Missing Amount', date: '2025-01-01' },
        { name: 'Invalid Amount', date: '2025-02-01', amount: 'not-a-number' },
      ];

      const { patterns, meta } = await analyzer.analyzeRecurringPatterns({
        transactions,
        minOccurrences: 1,
        minConsistency: 0,
        minVariableAmount: 0,
      });

      expect(patterns).toEqual([]);
      expect(meta.excluded_occurrences).toBe(0);
    });
  });
});
