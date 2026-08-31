import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const service = require('../financial-truth.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { initializeSqliteDatabase } = require(path.join(process.cwd(), '..', 'scripts', 'init_sqlite_db.js'));

class TestSqliteDatabase {
  private readonly database: DatabaseSync;
  private transactionDepth = 0;

  constructor(filename: string) {
    this.database = new DatabaseSync(filename);
  }

  get inTransaction() {
    return this.transactionDepth > 0;
  }

  pragma(statement: string) {
    return this.database.prepare(`PRAGMA ${statement}`).all();
  }

  exec(statement: string) {
    return this.database.exec(statement);
  }

  prepare(statement: string) {
    return this.database.prepare(statement);
  }

  transaction<TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) {
    return (...args: TArgs) => {
      if (this.transactionDepth > 0) return callback(...args);
      this.database.exec('BEGIN');
      this.transactionDepth += 1;
      try {
        const result = callback(...args);
        this.database.exec('COMMIT');
        return result;
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      } finally {
        this.transactionDepth -= 1;
      }
    };
  }

  close() {
    return this.database.close();
  }
}

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
      { id: 1, action: 'override_pattern', overrides_json: '{"amount":55,"frequency":"quarterly","isSubscription":false}', status: 'active' },
      { id: 2, action: 'skip_occurrence', occurrence_id: 'pattern:4:2026-09-01', overrides_json: '{}', status: 'active' },
    ]);

    expect(resolved).toMatchObject({
      amount: 55,
      frequency: 'quarterly',
      isSubscription: false,
      state: 'active',
    });
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

  it('covers calendar, amount-clustering, and cadence edge cases', () => {
    const { addFrequency, clusterAmounts, formatDate, monthlyAmount, parseDate } = service._internal;

    expect(service.normalizeName()).toBe('');
    expect(formatDate(addFrequency(parseDate('2025-01-31'), 'monthly'))).toBe('2025-02-28');
    expect(formatDate(addFrequency(parseDate('2025-01-31'), 'bimonthly'))).toBe('2025-03-31');
    expect(formatDate(addFrequency(parseDate('2025-01-31'), 'quarterly'))).toBe('2025-04-30');
    expect(formatDate(addFrequency(parseDate('2024-02-29'), 'yearly'))).toBe('2025-02-28');
    expect(formatDate(addFrequency(parseDate('2026-01-01'), 'weekly'))).toBe('2026-01-08');
    expect(formatDate(addFrequency(parseDate('2026-01-01'), 'unknown'))).toBe('2026-01-31');
    expect(formatDate(addFrequency(parseDate('2026-01-31'), 'monthly', 15))).toBe('2026-02-15');

    expect(clusterAmounts([])).toEqual([]);
    const clusters = clusterAmounts([
      { amount: 100, id: 'a' },
      { amount: 108, id: 'b' },
      { amount: 400, id: 'c' },
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].rows).toHaveLength(2);
    expect(clusters[0].mean).toBe(104);

    expect(service.inferFrequency([])).toEqual({ frequency: 'variable', confidence: 0 });
    expect(service.inferFrequency(['2026-01-01'])).toEqual({ frequency: 'variable', confidence: 0 });
    expect(service.inferFrequency(['2026-01-01', '2026-01-02', '2026-01-29']))
      .toMatchObject({ frequency: 'variable' });
    expect(service.inferFrequency(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']))
      .toMatchObject({ frequency: 'daily', confidence: 0.98 });

    expect(monthlyAmount({ amount: 10, frequency: 'daily' })).toBe(300);
    expect(monthlyAmount({ amount: 10, frequency: 'weekly' })).toBeCloseTo(43.45);
    expect(monthlyAmount({ amount: 10, frequency: 'biweekly' })).toBeCloseTo(21.725);
    expect(monthlyAmount({ amount: 10, frequency: 'monthly' })).toBe(10);
    expect(monthlyAmount({ amount: 10, frequency: 'bimonthly' })).toBe(5);
    expect(monthlyAmount({ amount: 12, frequency: 'quarterly' })).toBe(4);
    expect(monthlyAmount({ amount: 12, frequency: 'yearly' })).toBe(1);
    expect(monthlyAmount({ amount: 10, frequency: 'variable' })).toBe(10);
  });

  it('resolves every correction field while retaining safe detected fallbacks', () => {
    const base = {
      id: 7,
      fingerprint: 'pattern:7',
      normalized_name: 'gym',
      display_name: 'Gym',
      direction: 'expense',
      category_definition_id: null,
      detected_frequency: 'daily',
      detected_amount: null,
      amount_tolerance: null,
      confidence: null,
      first_seen_date: null,
      last_seen_date: null,
      next_expected_date: '2026-01-01',
      occurrence_count: null,
      is_subscription: 0,
    };
    const skipped = Array.from({ length: 25 }, (_, index) => ({
      action: 'skip_occurrence',
      occurrence_id: `pattern:7:2026-01-${String(index + 1).padStart(2, '0')}`,
      overrides_json: '{}',
    }));
    const resolved = service._internal.resolvePattern(base, [
      { action: 'suppress_pattern', overrides_json: '{}' },
      { action: 'pause_pattern', overrides_json: '{}' },
      { action: 'end_pattern', effective_date: null, created_at: '2026-01-09T12:00:00Z', overrides_json: '{}' },
      { action: 'override_pattern', overrides_json: '{"amount":-2,"frequency":"nonsense","billingDay":"bad","confirmed":false}' },
      { action: 'override_pattern', overrides_json: '{"amount":0,"frequency":"variable","nextExpectedDate":"2026-01-01T08:00:00Z","billingDay":12,"confirmed":true}' },
      { action: 'skip_occurrence', occurrence_id: null, overrides_json: '{}' },
      ...skipped,
    ]);

    expect(resolved).toMatchObject({
      amount: 0,
      amountTolerance: 0,
      confidence: 0,
      frequency: 'variable',
      categoryDefinitionId: null,
      firstSeenDate: null,
      lastSeenDate: null,
      occurrenceCount: 0,
      isSubscription: false,
      state: 'ended',
      endedAt: '2026-01-09',
      billingDay: 12,
      confirmed: true,
    });
    expect(resolved.nextExpectedDate).toBe('2026-01-01');

    const daily = service._internal.resolvePattern(
      { ...base, detected_amount: 20, detected_frequency: 'daily' },
      skipped,
    );
    expect(daily.nextExpectedDate).toBe('2026-01-25');
    expect(service._internal.resolvePattern({ ...base, next_expected_date: null }, []))
      .toMatchObject({ state: 'active', nextExpectedDate: null, billingDay: null, confirmed: false });
  });

  it('builds safe recurring occurrences for fallback, income, paused, skipped, and ended patterns', () => {
    const pattern = {
      id: 8,
      displayName: 'Salary',
      direction: 'income',
      categoryDefinitionId: null,
      frequency: 'monthly',
      amount: 3,
      amountTolerance: 5,
      confidence: 0.1,
      lastSeenDate: null,
      nextExpectedDate: null,
      billingDay: 31,
      state: 'active',
      endedAt: null,
      skippedOccurrences: [],
    };
    const fallback = service.buildRecurringOccurrences({ patterns: [pattern] }, '2026-01-31', '2026-03-31');
    expect(fallback).toHaveLength(2);
    expect(fallback[0]).toMatchObject({
      occurrenceId: 'pattern:8:2026-02-28',
      predictionKind: 'recurring_income',
      categoryType: 'income',
      probability: 0.45,
      amountRange: { low: 0, high: 8 },
    });

    expect(service.buildRecurringOccurrences({ patterns: [{ ...pattern, frequency: 'variable' }] }, '2026-01-01', '2026-02-01')).toEqual([]);
    expect(service.buildRecurringOccurrences({ patterns: [{ ...pattern, state: 'paused' }] }, '2026-01-01', '2026-02-01')).toEqual([]);
    expect(service.buildRecurringOccurrences({ patterns: [{ ...pattern, state: 'ended', endedAt: null }] }, '2026-01-31', '2026-02-28')).toHaveLength(1);
    expect(service.buildRecurringOccurrences({ patterns: [{
      ...pattern,
      direction: 'expense',
      nextExpectedDate: '2026-02-28',
      skippedOccurrences: ['pattern:8:2026-02-28'],
    }] }, '2026-02-01', '2026-02-28')).toEqual([]);
  });

  it('rejects malformed drafts and normalizes complete correction metadata', () => {
    const invalid = [
      {},
      { action: 'suppress_pattern', scope: 'never', target: { kind: 'pattern', patternId: 1 } },
      { action: 'suppress_pattern', target: {} },
      { action: 'suppress_pattern', target: { kind: 'pattern', patternId: 0 } },
      { action: 'suppress_pattern', target: { kind: 'category', categoryDefinitionId: 0 } },
      { action: 'skip_occurrence', target: { kind: 'occurrence', patternId: 2, occurrenceId: 'pattern:3:2026-01-01' } },
      { action: 'set_category_expectation', target: { kind: 'pattern', patternId: 2 }, overrides: { monthlyAmount: 1 } },
      { action: 'suppress_pattern', target: { kind: 'category', categoryDefinitionId: 2 } },
      { action: 'set_category_expectation', target: { kind: 'category', categoryDefinitionId: 2 }, overrides: {} },
      { action: 'set_category_expectation', scope: 'occurrence', target: { kind: 'category', categoryDefinitionId: 2 }, overrides: { monthlyAmount: 1 } },
      { action: 'override_pattern', target: { kind: 'pattern', patternId: 2 }, overrides: {} },
      { action: 'override_pattern', target: { kind: 'pattern', patternId: 2 }, overrides: { amount: -1 } },
      { action: 'override_pattern', target: { kind: 'pattern', patternId: 2 }, overrides: { frequency: 'sometimes' } },
      { action: 'override_pattern', target: { kind: 'pattern', patternId: 2 }, overrides: { billingDay: 0 } },
      { action: 'override_pattern', target: { kind: 'pattern', patternId: 2 }, overrides: { billingDay: 32 } },
      { action: 'override_pattern', target: { kind: 'pattern', patternId: 2 }, overrides: { billingDay: 2.5 } },
    ];
    invalid.forEach((draft) => expect(() => service.validateDraft(draft)).toThrow());

    const skipped = service.validateDraft({
      requestId: 'request-one',
      action: 'skip_occurrence',
      target: { patternId: 2, occurrenceId: 'pattern:2:2026-01-01' },
      effectiveDate: '2026-01-01T10:00:00Z',
      effectiveEndDate: '2026-02-01T10:00:00Z',
      reasonCode: 'not_this_time',
      sourceFeature: 'forecast',
      sourceKey: 'prediction:one',
      overrides: 'ignored',
    });
    expect(skipped).toMatchObject({
      requestId: 'request-one',
      targetKind: 'pattern',
      patternId: 2,
      action: 'skip_occurrence',
      scope: 'occurrence',
      effectiveDate: '2026-01-01',
      effectiveEndDate: '2026-02-01',
      reasonCode: 'not_this_time',
      sourceFeature: 'forecast',
      sourceKey: 'prediction:one',
      overrides: {},
    });

    expect(service.validateDraft({
      action: 'override_pattern',
      target: { kind: 'pattern', patternId: 2 },
      overrides: { nextExpectedDate: '2026-05-01' },
      source: { feature: 'subscriptions', sourceKey: 'subscription:2' },
    })).toMatchObject({ sourceFeature: 'subscriptions', sourceKey: 'subscription:2' });
    expect(service.validateDraft({
      action: 'override_pattern',
      target: { kind: 'pattern', patternId: 2 },
      overrides: { confirmed: true },
    })).toMatchObject({ action: 'override_pattern', sourceFeature: 'unknown' });
    expect(service.affectedDomainsForCorrection()).toEqual(service.AFFECTED_DOMAINS);
  });

  it('persists, supersedes, restores, and shares corrections through a real local profile', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'financial-truth-service-'));
    const dbPath = path.join(tempDir, 'truth.sqlite');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    initializeSqliteDatabase({ output: dbPath, force: true, databaseCtor: TestSqliteDatabase });
    consoleLog.mockRestore();
    const db = new TestSqliteDatabase(dbPath);
    db.pragma('foreign_keys = ON');

    try {
      const categoryId = Number(db.prepare("SELECT id FROM category_definitions WHERE category_type = 'expense' ORDER BY id LIMIT 1").get().id);
      const insertTransaction = db.prepare(`
        INSERT INTO transactions (
          identifier, vendor, date, name, price, type, status, merchant_name,
          category_definition_id, category_type
        ) VALUES (?, ?, ?, ?, ?, 'normal', 'completed', ?, ?, ?)
      `);
      [
        ['gym-1', 'bank-a', '2026-01-05', 'Gym Plus', -100, 'Gym Plus', categoryId, 'expense'],
        ['gym-2', 'card-b', '2026-02-05', 'Gym Plus', -102, 'Gym Plus', categoryId, 'expense'],
        ['gym-3', 'bank-a', '2026-03-05', 'Gym Plus', -98, 'Gym Plus', categoryId, 'expense'],
        ['salary-1', 'bank-a', '2026-01-10', 'Employer', 10000, 'Employer', null, 'income'],
        ['salary-2', 'bank-a', '2026-02-10', 'Employer', 10000, 'Employer', null, 'income'],
        ['food-1', 'card-b', '2026-01-15', 'Groceries', -400, 'Groceries', categoryId, 'expense'],
        ['food-2', 'card-b', '2026-02-15', 'Groceries', -500, 'Groceries', categoryId, 'expense'],
      ].forEach((row) => insertTransaction.run(...row));

      expect(service.materializePatterns(db, { force: true })).toMatchObject({ changed: true });
      expect(service.materializePatterns(db)).toMatchObject({ changed: false });
      const snapshot = service.getProjectionSnapshotFromDb(db, { materialize: false });
      const gym = snapshot.patterns.find((pattern: any) => pattern.normalizedName === 'gym_plus');
      expect(gym).toMatchObject({ direction: 'expense', frequency: 'monthly', isSubscription: true });
      expect(snapshot.excludedTransactionKeys.has('gym-1\u0000bank-a')).toBe(true);

      expect(() => service.previewCorrection({
        action: 'suppress_pattern',
        target: { kind: 'pattern', patternId: 99999 },
      }, { db })).toThrow('Financial pattern not found');
      expect(service.previewCorrection({
        action: 'skip_occurrence',
        target: { kind: 'occurrence', patternId: gym.id, occurrenceId: `pattern:${gym.id}:2026-04-05` },
      }, { db }).impact).toMatchObject({ monthlyDelta: -100, sixMonthDelta: -100 });
      expect(service.previewCorrection({
        action: 'override_pattern',
        target: { kind: 'pattern', patternId: gym.id },
        overrides: { amount: 120, frequency: 'quarterly' },
      }, { db }).impact.monthlyDelta).toBe(-60);
      expect(service.previewCorrection({
        action: 'pause_pattern',
        target: { kind: 'pattern', patternId: gym.id },
      }, { db }).impact.sixMonthDelta).toBe(-600);
      expect(service.previewCorrection({
        action: 'set_category_expectation',
        scope: 'current_month',
        target: { kind: 'category', categoryDefinitionId: categoryId },
        overrides: { monthlyAmount: 1000 },
      }, { db }).impact).toMatchObject({ monthlyDelta: 600, sixMonthDelta: 600 });

      db.prepare(`
        INSERT INTO subscriptions (
          pattern_key, display_name, detected_frequency, detected_amount,
          status, financial_pattern_id
        ) VALUES ('gym_plus', 'Gym Plus', 'monthly', 100, 'active', ?)
      `).run(gym.id);
      const smartAction = db.prepare(`
        INSERT INTO smart_action_items (
          action_type, title, user_status, metadata, recurrence_key
        ) VALUES ('fixed_recurring_change', 'Review gym', 'active', ?, ?)
        RETURNING id
      `).get(JSON.stringify({ patternId: gym.id }), `financial_pattern:${gym.id}`);

      const suppressed = service.createCorrection({
        requestId: 'suppress-gym',
        action: 'suppress_pattern',
        target: { kind: 'pattern', patternId: gym.id },
        source: { feature: 'dashboard_forecast', sourceKey: 'prediction:gym' },
      }, { db });
      expect(suppressed.correction).toMatchObject({ action: 'suppress_pattern', status: 'active' });
      expect(service.createCorrection({
        requestId: 'suppress-gym',
        action: 'suppress_pattern',
        target: { kind: 'pattern', patternId: gym.id },
      }, { db }).correction.id).toBe(suppressed.correction.id);
      expect(db.prepare('SELECT user_status FROM smart_action_items WHERE id = ?').get(smartAction.id).user_status).toBe('dismissed');
      expect(db.prepare('SELECT action FROM action_item_history WHERE smart_action_item_id = ?').get(smartAction.id).action).toBe('dismissed');
      expect(db.prepare('SELECT status FROM subscriptions WHERE financial_pattern_id = ?').get(gym.id).status).toBe('cancelled');

      const ended = service.createCorrection({
        requestId: 'end-gym',
        action: 'end_pattern',
        scope: 'from_date',
        effectiveDate: '2026-08-01',
        target: { kind: 'pattern', patternId: gym.id },
      }, { db });
      expect(ended.correction.action).toBe('end_pattern');
      expect(db.prepare('SELECT status FROM financial_corrections WHERE id = ?').get(suppressed.correction.id).status).toBe('superseded');

      service.createCorrection({
        requestId: 'override-gym-one',
        action: 'override_pattern',
        target: { kind: 'pattern', patternId: gym.id },
        overrides: { amount: 115, frequency: 'quarterly', billingDay: 17 },
      }, { db });
      const override = service.createCorrection({
        requestId: 'override-gym-two',
        action: 'override_pattern',
        target: { kind: 'pattern', patternId: gym.id },
        overrides: { amount: 125, frequency: 'monthly', confirmed: true },
      }, { db });
      expect(db.prepare('SELECT user_amount, user_frequency FROM subscriptions WHERE financial_pattern_id = ?').get(gym.id))
        .toMatchObject({ user_amount: 125, user_frequency: 'monthly' });

      const occurrenceId = `pattern:${gym.id}:2026-09-05`;
      const skipped = service.createCorrection({
        requestId: 'skip-gym-one',
        action: 'skip_occurrence',
        target: { kind: 'occurrence', patternId: gym.id, occurrenceId },
      }, { db });
      expect(service.createCorrection({
        requestId: 'skip-gym-two',
        action: 'skip_occurrence',
        target: { kind: 'occurrence', patternId: gym.id, occurrenceId },
      }, { db }).correction.id).toBe(skipped.correction.id);

      service.createCorrection({
        requestId: 'category-one',
        action: 'set_category_expectation',
        scope: 'ongoing',
        target: { kind: 'category', categoryDefinitionId: categoryId },
        overrides: { monthlyAmount: 800 },
      }, { db });
      const categoryCorrection = service.createCorrection({
        requestId: 'category-two',
        action: 'set_category_expectation',
        scope: 'ongoing',
        target: { kind: 'category', categoryDefinitionId: categoryId },
        overrides: { monthlyAmount: 900 },
      }, { db });
      expect(service.getProjectionSnapshotFromDb(db, { materialize: false }).categoryExpectations[0])
        .toMatchObject({ categoryDefinitionId: categoryId, categoryName: expect.any(String) });
      expect(service.listCorrections({ status: 'superseded' }, { db }).corrections.length).toBeGreaterThan(0);
      expect(service.listCorrections({ status: 'invalid' }, { db }).corrections.every((item: any) => item.status === 'active')).toBe(true);

      expect(() => service.revertCorrection(0, { db })).toThrow('Invalid correction ID');
      expect(() => service.revertCorrection(99999, { db })).toThrow('Correction not found');
      expect(service.revertCorrection(categoryCorrection.correction.id, { db }).correction.status).toBe('reverted');
      expect(service.revertCorrection(categoryCorrection.correction.id, { db }).correction.status).toBe('reverted');
      expect(service.revertCorrection(override.correction.id, { db }).correction.status).toBe('reverted');

      expect(() => service.setPresentationDismissal('', {}, { db })).toThrow('A source key is required');
      expect(service.setPresentationDismissal('notification:gym', {}, { db })).toMatchObject({ hidden: true });
      expect(service.getHiddenSourceKeys({ db }).has('notification:gym')).toBe(true);
      expect(service.listPresentationDismissals({ db }).sourceKeys).toContain('notification:gym');
      expect(service.setPresentationDismissal('notification:gym', { hidden: false, sourceType: 'money_review' }, { db }))
        .toMatchObject({ hidden: false });

      expect(service.upsertManualSubscriptionPattern(0, { db })).toBeNull();
      expect(service.upsertManualSubscriptionPattern(99999, { db })).toBeNull();
      const blankSubscription = db.prepare(`
        INSERT INTO subscriptions (pattern_key, display_name, detected_frequency, detected_amount, is_manual)
        VALUES ('', '', 'monthly', 10, 1) RETURNING id
      `).get();
      expect(service.upsertManualSubscriptionPattern(blankSubscription.id, { db })).toBeNull();
      const manualSubscription = db.prepare(`
        INSERT INTO subscriptions (
          pattern_key, display_name, detected_frequency, detected_amount,
          next_expected_date, is_manual
        ) VALUES ('manual_cloud', 'Manual Cloud', 'monthly', 40, '2026-09-20', 1)
        RETURNING id
      `).get();
      const manualPatternId = service.upsertManualSubscriptionPattern(manualSubscription.id, { db });
      expect(manualPatternId).toEqual(expect.any(Number));
      expect(service.restorePatternState(0, {}, { db })).toBeNull();
      expect(service.restorePatternState(manualPatternId, {}, { db })).toMatchObject({ changed: false });
      expect(service.applySubscriptionUpdate(99999, {}, { db })).toBeNull();
      expect(service.applySubscriptionUpdate(manualSubscription.id, { status: 'paused' }, { db })).toMatchObject({ patternId: manualPatternId });
      expect(service.applySubscriptionUpdate(manualSubscription.id, { status: 'cancelled' }, { db })).toMatchObject({ patternId: manualPatternId });
      expect(service.applySubscriptionUpdate(manualSubscription.id, {
        status: 'keep',
        user_amount: 45,
        user_frequency: 'quarterly',
        billing_day: 20,
      }, { db })).toMatchObject({ patternId: manualPatternId });
      expect(service.restorePatternState(manualPatternId, { sourceFeature: 'money-review', sourceKey: 'returned:manual' }, { db }))
        .toMatchObject({ success: true, sourceFeature: 'money-review', sourceKey: 'returned:manual' });

      expect(() => service.createCorrection({
        requestId: 'missing-pattern',
        action: 'suppress_pattern',
        target: { kind: 'pattern', patternId: 99999 },
      }, { db })).toThrow('Financial pattern not found');
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
