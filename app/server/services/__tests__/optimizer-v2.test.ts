import { afterEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const optimizerV2 = require('../optimizer-v2.js');

describe('optimizer v2 deterministic contracts', () => {
  afterEach(() => {
    optimizerV2.__resetDatabase();
    optimizerV2.__resetOpenAI();
    delete process.env.OPTIMIZER_V2_ENABLED;
  });

  it('derives the recurring baseline from Salary-category transactions and stable recurring sources', () => {
    const rows = [
      ['2026-01', 'Employer January 9381', 10, 'Salary', 24_000],
      ['2026-02', 'Employer February 1052', 10, 'Salary', 24_500],
      ['2026-03', 'Employer March 7744', 10, 'Salary', 23_500],
      ['2026-01', 'Recurring reimbursement', 12, 'Other income', 120],
      ['2026-02', 'Recurring reimbursement', 12, 'Other income', 110],
      ['2026-03', 'Recurring reimbursement', 12, 'Other income', 115],
      ['2026-03', 'One-time sale', 12, 'Other income', 100_000],
    ].map(([month_key, source_name, category_definition_id, category_name_en, amount]) => ({
      month_key,
      source_name,
      category_definition_id,
      category_name: category_name_en,
      category_name_en,
      parent_name: 'Income',
      parent_name_en: 'Income',
      amount,
    }));

    const result = optimizerV2.utils.deriveRecurringIncome(rows, ['2026-01', '2026-02', '2026-03']);

    expect(result.salaryMonthlyAverage).toBe(24_000);
    expect(result.otherRecurringMonthlyAverage).toBeCloseTo(115);
    expect(result.recurringMonthlyAverage).toBeCloseTo(24_115);
    expect(result.confidence).toBe('medium');
    expect(JSON.stringify(result)).not.toContain('Employer');
    expect(JSON.stringify(result)).not.toContain('One-time sale');
  });

  it('never selects reported profile income while building the five review groups', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM user_profile')) {
          return { rows: [{ id: 1, age: 40, marital_status: 'married', employment_status: 'employed', household_size: 2, children_count: 0, home_ownership: 'rent' }] };
        }
        return { rows: [] };
      },
    };

    const snapshot = await optimizerV2.utils.buildReviewSnapshot(client, new Date('2026-08-20T00:00:00Z'));

    expect(snapshot.groups).toHaveLength(5);
    expect(snapshot.groups.map((group: { key: string }) => group.key)).toEqual(['household', 'cash_flow', 'banking', 'investments', 'real_estate']);
    expect(statements.join('\n')).not.toMatch(/monthly_income/i);
    expect(statements.join('\n')).not.toMatch(/spouse_profile[\s\S]*monthly_income/i);
  });

  it('links every review group to a route and tab that exists in the renderer', () => {
    expect(optimizerV2.utils.GROUPS.map((group: { key: string; sourceRoute: unknown }) => ({
      key: group.key,
      sourceRoute: group.sourceRoute,
    }))).toEqual([
      { key: 'household', sourceRoute: { path: '/settings', hash: '#profile' } },
      { key: 'cash_flow', sourceRoute: { path: '/analysis', search: '?tab=spending' } },
      { key: 'banking', sourceRoute: { path: '/settings', hash: '#sync' } },
      { key: 'investments', sourceRoute: { path: '/investments', search: '?tab=holdings' } },
      { key: 'real_estate', sourceRoute: { path: '/investments', search: '?tab=real-estate' } },
    ]);
  });

  it('uses a stable score and keeps possible matches below matched offers', () => {
    const source = { url: 'https://www.gov.il/he/service/example', title: 'Official', domain: 'gov.il', trustTier: 'regulator' };
    const base = {
      benefits: { oneTime: { low: 0, high: 1000 }, monthly: { low: 0, high: 50 }, annual: { low: 0, high: 0 } },
      sources: [source], scope: 'banking_cards', effort: 'low', changeLevel: 'negotiate', lockupMonths: 0,
    };
    const scope = { primary: 'banking_cards', extras: [], effort: 'low', change: 'negotiate_only', liquidity: 'no_lockup' };
    const matched = { ...base, actionId: 'matched', eligibility: { status: 'matched' } };
    const possible = { ...base, actionId: 'possible', eligibility: { status: 'possible' } };
    matched.score = optimizerV2.utils.scoreCandidate(matched, scope);
    possible.score = optimizerV2.utils.scoreCandidate(possible, scope);

    const ranked = optimizerV2.utils.capAndRankCandidates([possible, matched]);

    expect(optimizerV2.utils.scoreCandidate(matched, scope)).toBe(matched.score);
    expect(ranked.find((item: { actionId: string }) => item.actionId === 'possible').score)
      .toBeLessThan(ranked.find((item: { actionId: string }) => item.actionId === 'matched').score);
  });

  it('rejects unsafe and unsupported sources and redacts artifacts', () => {
    expect(optimizerV2.utils.normalizeSource({ url: 'http://example.com', trustTier: 'provider' })).toBeNull();
    expect(optimizerV2.utils.normalizeSource({ url: 'https://127.0.0.1/private', trustTier: 'provider' })).toBeNull();
    expect(optimizerV2.utils.normalizeSource({ url: 'https://www.gov.il/he/service/test', trustTier: 'lead' }).trustTier).toBe('regulator');

    const redacted = optimizerV2.utils.redactRunArtifact({
      timings: { total: 20 },
      scopes: ['banking_cards'],
      sourceMetadata: [{ url: 'https://boi.org.il' }],
      actions: [{ actionId: 'a1', score: 82, exactBalance: 999_999 }],
      feedbackCodes: ['useful'],
      errors: [],
      salary: 25_000,
      transactions: [{ merchant: 'private' }],
    });

    expect(redacted).toEqual({
      timings: { total: 20 },
      scopes: ['banking_cards'],
      sourceMetadata: [{ url: 'https://boi.org.il' }],
      actions: [{ actionId: 'a1', score: 82 }],
      feedbackCodes: ['useful'],
      errors: [],
    });
  });

  it('enforces the optimizerV2 feature flag', async () => {
    process.env.OPTIMIZER_V2_ENABLED = 'false';
    await expect(optimizerV2.getOptimizerV2Status()).rejects.toMatchObject({ status: 404, code: 'OPTIMIZER_V2_DISABLED' });
  });
});
