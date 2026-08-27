import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const service = require('../financial-truth.js');

describe('Financial truth resolution', () => {
  it('normalizes merchant identity independently from account vendor', () => {
    expect(service.normalizeName('  Netflix.com / Plan ')).toBe('netflix_com_plan');
    expect(service.normalizeName('נטפליקס בע״מ')).toBe('נטפליקס_בע_מ');
  });

  it('detects cadence from separate completed dates', () => {
    expect(service.inferFrequency(['2026-01-05', '2026-02-05', '2026-03-05'])).toMatchObject({ frequency: 'monthly' });
    expect(service.inferFrequency(['2026-01-01', '2026-01-08', '2026-01-15'])).toMatchObject({ frequency: 'weekly' });
  });

  it('keeps user overrides authoritative and tracks skipped occurrences', () => {
    const resolved = service._internal.resolvePattern({
      id: 4,
      fingerprint: 'pattern:4',
      normalized_name: 'cloud',
      display_name: 'Cloud',
      direction: 'expense',
      detected_frequency: 'monthly',
      detected_amount: 40,
      amount_tolerance: 5,
      confidence: 0.8,
      next_expected_date: '2026-09-01',
      occurrence_count: 5,
      is_subscription: 1,
    }, [
      { id: 1, action: 'override_pattern', overrides_json: '{"amount":55,"frequency":"quarterly"}', status: 'active' },
      { id: 2, action: 'skip_occurrence', occurrence_id: 'pattern:4:2026-09-01', overrides_json: '{}', status: 'active' },
    ]);

    expect(resolved).toMatchObject({ amount: 55, frequency: 'quarterly', state: 'active' });
    expect(resolved.skippedOccurrences).toEqual(['pattern:4:2026-09-01']);
    expect(resolved.nextExpectedDate).toBe('2026-12-01');
  });

  it('limits category corrections to consumers that use category projections', () => {
    expect(service.affectedDomainsForCorrection({ action: 'set_category_expectation' }))
      .toEqual(expect.arrayContaining(['forecast', 'budget', 'notifications', 'money-review']));
    expect(service.affectedDomainsForCorrection({ action: 'set_category_expectation' }))
      .not.toContain('subscriptions');
  });

  it('emits stable occurrences and respects suppression/end state', () => {
    const basePattern = {
      id: 2,
      displayName: 'Rent',
      direction: 'expense',
      categoryDefinitionId: 9,
      frequency: 'monthly',
      amount: 4000,
      amountTolerance: 50,
      confidence: 0.95,
      lastSeenDate: '2026-07-01',
      nextExpectedDate: '2026-08-01',
      state: 'active',
      endedAt: null,
      skippedOccurrences: [],
    };
    const active = service.buildRecurringOccurrences({ patterns: [basePattern] }, '2026-08-01', '2026-10-01');
    expect(active.map((item: any) => item.occurrenceId)).toEqual([
      'pattern:2:2026-08-01',
      'pattern:2:2026-09-01',
      'pattern:2:2026-10-01',
    ]);
    expect(service.buildRecurringOccurrences({ patterns: [{ ...basePattern, state: 'suppressed' }] }, '2026-08-01', '2026-10-01')).toEqual([]);
    expect(service.buildRecurringOccurrences({ patterns: [{ ...basePattern, state: 'ended', endedAt: '2026-09-01' }] }, '2026-08-01', '2026-10-01')).toHaveLength(1);
  });

  it('validates category expectations and occurrence targets', () => {
    expect(() => service.validateDraft({ action: 'skip_occurrence', target: { kind: 'occurrence', patternId: 2 } })).toThrow('An occurrence is required');
    expect(service.validateDraft({
      action: 'set_category_expectation',
      scope: 'current_month',
      target: { kind: 'category', categoryDefinitionId: 6 },
      overrides: { monthlyAmount: 900 },
      source: { feature: 'dashboard' },
    })).toMatchObject({ categoryDefinitionId: 6, action: 'set_category_expectation' });
  });
});
