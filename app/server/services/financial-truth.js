const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ALLOWED_ACTIONS = new Set([
  'skip_occurrence',
  'suppress_pattern',
  'end_pattern',
  'pause_pattern',
  'override_pattern',
  'set_category_expectation',
]);
const ALLOWED_SCOPES = new Set(['occurrence', 'from_date', 'current_month', 'ongoing']);
const FREQUENCY_DAYS = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  bimonthly: 60,
  quarterly: 91,
  yearly: 365,
};
const AFFECTED_DOMAINS = [
  'forecast',
  'subscriptions',
  'budget',
  'notifications',
  'money-review',
  'optimizer',
  'quests',
  'chat',
];
let recalculationTimer = null;
let scheduledRevision = 0;

function affectedDomainsForCorrection(correction = {}) {
  if (correction.action === 'set_category_expectation') {
    return AFFECTED_DOMAINS.filter((domain) => domain !== 'subscriptions');
  }
  return [...AFFECTED_DOMAINS];
}

function resolveDbPath() {
  if (process.env.SQLITE_DB_PATH) return process.env.SQLITE_DB_PATH;
  const preferred = path.join(__dirname, '../../dist/shekelsync.sqlite');
  const legacy = path.join(__dirname, '../../dist/clarify.sqlite');
  return fs.existsSync(preferred) ? preferred : fs.existsSync(legacy) ? legacy : preferred;
}

function openDb(options = {}) {
  const db = new Database(resolveDbPath(), options);
  db.pragma('foreign_keys = ON');
  return db;
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .normalize('NFKC')
    .replace(/[\u05f3\u05f4]/g, '_')
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toDateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function parseDate(value) {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addFrequency(date, frequency, billingDay = null) {
  const next = new Date(date);
  if (frequency === 'monthly' || frequency === 'bimonthly' || frequency === 'quarterly' || frequency === 'yearly') {
    const months = frequency === 'monthly' ? 1 : frequency === 'bimonthly' ? 2 : frequency === 'quarterly' ? 3 : 12;
    const desiredDay = billingDay || next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + months);
    next.setDate(Math.min(desiredDay, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
    return next;
  }
  next.setDate(next.getDate() + (FREQUENCY_DAYS[frequency] || 30));
  return next;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function inferFrequency(dates) {
  const unique = [...new Set(dates.map(toDateOnly))].sort();
  if (unique.length < 2) return { frequency: 'variable', confidence: 0 };
  const intervals = [];
  for (let index = 1; index < unique.length; index += 1) {
    const days = Math.round((parseDate(unique[index]) - parseDate(unique[index - 1])) / 86400000);
    if (days > 0) intervals.push(days);
  }
  if (!intervals.length) return { frequency: 'variable', confidence: 0 };
  const center = median(intervals);
  const candidates = Object.entries(FREQUENCY_DAYS);
  const [frequency, expected] = candidates.reduce((best, candidate) => (
    Math.abs(candidate[1] - center) < Math.abs(best[1] - center) ? candidate : best
  ));
  const deviations = intervals.map((days) => Math.abs(days - expected) / expected);
  const consistency = Math.max(0, 1 - deviations.reduce((sum, item) => sum + item, 0) / deviations.length);
  const tolerance = frequency === 'daily' ? 0.55 : frequency === 'weekly' || frequency === 'biweekly' ? 0.45 : 0.4;
  return consistency >= tolerance
    ? { frequency, confidence: Math.min(0.98, consistency * Math.min(1, unique.length / 4)) }
    : { frequency: 'variable', confidence: Math.min(0.5, consistency) };
}

function clusterAmounts(rows) {
  const clusters = [];
  [...rows].sort((a, b) => a.amount - b.amount).forEach((row) => {
    const cluster = clusters.find((candidate) => (
      Math.abs(row.amount - candidate.mean) <= Math.max(5, candidate.mean * 0.15)
    ));
    if (!cluster) {
      clusters.push({ rows: [row], mean: row.amount });
      return;
    }
    cluster.rows.push(row);
    cluster.mean = cluster.rows.reduce((sum, item) => sum + item.amount, 0) / cluster.rows.length;
  });
  return clusters.sort((a, b) => a.mean - b.mean);
}

function transactionSignature(db) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count,
      COALESCE(MAX(date), '') AS max_date,
      COALESCE(SUM(LENGTH(identifier) + LENGTH(vendor) + LENGTH(name)), 0) AS text_size,
      COALESCE(ROUND(SUM(ABS(price)), 2), 0) AS amount_sum
    FROM transactions WHERE status = 'completed'
  `).get();
  return crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
}

function readTruthRevision(db) {
  return Number(db.prepare('SELECT revision FROM financial_truth_state WHERE id = 1').get()?.revision) || 0;
}

function incrementRevision(db) {
  db.prepare(`
    UPDATE financial_truth_state
    SET revision = revision + 1, updated_at = datetime('now')
    WHERE id = 1
  `).run();
  return readTruthRevision(db);
}

function createReturnReviewItems(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'smart_action_items'").get()) return;
  const corrections = db.prepare(`
    SELECT correction.*, pattern.display_name, pattern.detected_amount,
      pattern.detected_frequency
    FROM financial_corrections correction
    JOIN financial_patterns pattern ON pattern.id = correction.pattern_id
    WHERE correction.status = 'active'
      AND correction.action IN ('end_pattern', 'suppress_pattern')
  `).all();
  const countEvidence = db.prepare(`
    SELECT COUNT(DISTINCT transaction_date) AS matches, MAX(transaction_date) AS last_date,
      GROUP_CONCAT(DISTINCT transaction_date) AS matched_dates
    FROM financial_pattern_transactions
    WHERE pattern_id = ? AND transaction_date > ?
  `);
  const insert = db.prepare(`
    INSERT INTO smart_action_items (
      action_type, severity, title, description, detected_at, user_status,
      metadata, potential_impact, detection_confidence, is_recurring, recurrence_key
    )
    SELECT 'fixed_recurring_change', 'medium', ?, ?, datetime('now'), 'active', ?, ?, 0.9, 1, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM smart_action_items
      WHERE recurrence_key = ? AND user_status IN ('active', 'accepted', 'snoozed')
    )
  `);
  corrections.forEach((correction) => {
    const threshold = correction.action === 'end_pattern' ? 1 : 2;
    const since = toDateOnly(correction.effective_date || correction.created_at);
    const evidence = countEvidence.get(correction.pattern_id, since);
    if ((Number(evidence?.matches) || 0) < threshold) return;
    if (correction.action === 'suppress_pattern') {
      const matchedDates = String(evidence.matched_dates || '').split(',').filter(Boolean);
      if (inferFrequency(matchedDates).frequency !== correction.detected_frequency) return;
    }
    const recurrenceKey = `financial_pattern:return:${correction.pattern_id}`;
    const title = `${correction.display_name} may have returned`;
    const description = correction.action === 'end_pattern'
      ? `A new charge appeared after you marked this pattern as ended. It remains excluded until you restore it.`
      : `New cadence-consistent charges appeared after you marked this as not recurring. It remains excluded until you restore it.`;
    insert.run(
      title,
      description,
      JSON.stringify({
        source: 'financial_truth',
        patternId: Number(correction.pattern_id),
        correctionId: Number(correction.id),
        lastMatchedDate: evidence.last_date,
        actions: [],
      }),
      Number(correction.detected_amount) || 0,
      recurrenceKey,
      recurrenceKey,
    );
  });
}

function invalidateDependentCaches() {
  // Lazy requires avoid a module cycle while forecast generation itself reads
  // the truth snapshot.
  try { require('./forecast.js').clearCache?.(); } catch { /* best-effort */ }
  try { require('../routes/forecast.js')._internal?.clearForecastCache?.(); } catch { /* best-effort */ }
  try { require('./analytics/extended-forecast.js').clearCache?.(); } catch { /* best-effort */ }
}

function scheduleDependentRecalculation(revision, attempt = 0) {
  if (process.env.NODE_ENV === 'test') return;
  const requestedRevision = Number(revision) || 0;
  if (attempt === 0) {
    scheduledRevision = requestedRevision;
    if (recalculationTimer) clearTimeout(recalculationTimer);
  } else if (scheduledRevision !== requestedRevision) {
    return;
  }
  const retryDelays = [0, 1_000, 5_000, 15_000, 30_000];
  recalculationTimer = setTimeout(async () => {
    recalculationTimer = null;
    let db;
    try {
      db = openDb({ readonly: true });
      if (readTruthRevision(db) !== requestedRevision) return;
    } catch {
      // The next normal request will retry if startup is still applying schema.
      return;
    } finally {
      db?.close();
    }
    try {
      await require('./forecast.js').generateDailyForecast({ cacheDurationMs: 5 * 60 * 1000 });
    } catch (error) {
      if (attempt + 1 < retryDelays.length) {
        scheduleDependentRecalculation(requestedRevision, attempt + 1);
      } else {
        console.warn('[FinancialTruth] Forecast update remains pending:', error?.message || error);
      }
    }
  }, retryDelays[Math.min(attempt, retryDelays.length - 1)]);
  recalculationTimer.unref?.();
}

function materializePatterns(db, { force = false } = {}) {
  const state = db.prepare('SELECT * FROM financial_truth_state WHERE id = 1').get();
  if (!force && state?.materialized_transaction_signature) {
    return { changed: false, revision: Number(state.revision) || 0 };
  }
  const signature = transactionSignature(db);

  const transactions = db.prepare(`
    SELECT t.identifier, t.vendor, t.date, t.name, t.merchant_name, t.price,
      t.category_type, t.category_definition_id
    FROM transactions t
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) excluded
      ON excluded.transaction_identifier = t.identifier AND excluded.transaction_vendor = t.vendor
    WHERE t.status = 'completed'
      AND excluded.transaction_identifier IS NULL
      AND t.price != 0
      AND TRIM(COALESCE(NULLIF(t.merchant_name, ''), t.name, '')) != ''
    ORDER BY t.date, t.identifier
  `).all().map((row) => ({
    ...row,
    normalizedName: normalizeName(row.merchant_name || row.name),
    displayName: row.merchant_name || row.name,
    direction: row.category_type === 'income' || row.price > 0 ? 'income' : 'expense',
    amount: Math.abs(Number(row.price) || 0),
    dateOnly: toDateOnly(row.date),
  })).filter((row) => row.normalizedName && row.amount > 0);

  const groups = new Map();
  transactions.forEach((row) => {
    const key = `${row.normalizedName}:${row.direction}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const run = db.transaction(() => {
    const existingPatterns = db.prepare(`
      SELECT * FROM financial_patterns ORDER BY is_subscription DESC, id ASC
    `).all();
    const byIdentity = new Map();
    const materializedPatternIds = new Set();
    existingPatterns.forEach((pattern) => {
      const key = `${pattern.normalized_name}:${pattern.direction}`;
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(pattern);
    });
    const upsert = db.prepare(`
      INSERT INTO financial_patterns (
        fingerprint, normalized_name, display_name, direction, category_definition_id,
        detected_frequency, detected_amount, amount_tolerance, confidence,
        first_seen_date, last_seen_date, next_expected_date, occurrence_count,
        source, is_subscription, evidence_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'detected', ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        display_name = excluded.display_name,
        category_definition_id = excluded.category_definition_id,
        detected_frequency = excluded.detected_frequency,
        detected_amount = excluded.detected_amount,
        amount_tolerance = excluded.amount_tolerance,
        confidence = excluded.confidence,
        first_seen_date = excluded.first_seen_date,
        last_seen_date = excluded.last_seen_date,
        next_expected_date = excluded.next_expected_date,
        occurrence_count = excluded.occurrence_count,
        is_subscription = MAX(financial_patterns.is_subscription, excluded.is_subscription),
        evidence_signature = excluded.evidence_signature,
        updated_at = datetime('now')
      RETURNING id
    `);
    const updateExisting = db.prepare(`
      UPDATE financial_patterns SET
        display_name = ?, category_definition_id = ?, detected_frequency = ?,
        detected_amount = ?, amount_tolerance = ?, confidence = ?, first_seen_date = ?,
        last_seen_date = ?, next_expected_date = ?, occurrence_count = ?,
        is_subscription = MAX(is_subscription, ?), evidence_signature = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    const clearEvidence = db.prepare('DELETE FROM financial_pattern_transactions WHERE pattern_id = ?');
    const insertEvidence = db.prepare(`
      INSERT OR REPLACE INTO financial_pattern_transactions (
        pattern_id, transaction_identifier, transaction_vendor, transaction_date, amount, match_score
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const linkSubscription = db.prepare(`
      UPDATE subscriptions SET financial_pattern_id = ?
      WHERE financial_pattern_id IS NULL
        AND (pattern_key = ? OR LOWER(display_name) = LOWER(?))
    `);

    for (const [identity, rows] of groups.entries()) {
      const amountClusters = clusterAmounts(rows);
      amountClusters.forEach((cluster) => {
        const uniqueDates = [...new Set(cluster.rows.map((row) => row.dateOnly))];
        if (uniqueDates.length < 2) return;
        const { frequency, confidence } = inferFrequency(uniqueDates);
        if (frequency === 'variable' || confidence < 0.3) return;

        const sample = cluster.rows[cluster.rows.length - 1];
        const meanAmount = cluster.rows.reduce((sum, row) => sum + row.amount, 0) / cluster.rows.length;
        const sortedDates = uniqueDates.sort();
        const nextDate = formatDate(addFrequency(parseDate(sortedDates[sortedDates.length - 1]), frequency));
        const evidenceSignature = crypto.createHash('sha1')
          .update(cluster.rows.map((row) => `${row.identifier}:${row.vendor}`).sort().join('|'))
          .digest('hex');
        const amountBand = Math.round(meanAmount / 5) * 5;
        const fingerprint = `pattern:v2:${identity}:${frequency}:${amountBand}`;
        const compatible = (byIdentity.get(identity) || [])
          .filter((pattern) => (
            !materializedPatternIds.has(Number(pattern.id))
            && (pattern.detected_frequency === frequency || pattern.detected_frequency === 'variable')
            && Math.abs(Number(pattern.detected_amount || 0) - meanAmount)
              <= Math.max(10, Number(pattern.amount_tolerance || 0), meanAmount * 0.2)
          ))
          .sort((left, right) => (
            Math.abs(Number(left.detected_amount || 0) - meanAmount)
            - Math.abs(Number(right.detected_amount || 0) - meanAmount)
          ))[0];
        const isSubscription = sample.direction === 'expense' && confidence >= 0.45 ? 1 : 0;
        let patternId;
        if (compatible) {
          updateExisting.run(
            sample.displayName, sample.category_definition_id || null, frequency, meanAmount,
            Math.max(5, meanAmount * 0.15), confidence, sortedDates[0],
            sortedDates[sortedDates.length - 1], nextDate, uniqueDates.length,
            isSubscription, evidenceSignature, compatible.id,
          );
          patternId = compatible.id;
        } else {
          patternId = upsert.get(
            fingerprint, sample.normalizedName, sample.displayName, sample.direction,
            sample.category_definition_id || null, frequency, meanAmount,
            Math.max(5, meanAmount * 0.15), confidence, sortedDates[0],
            sortedDates[sortedDates.length - 1], nextDate, uniqueDates.length,
            isSubscription, evidenceSignature,
          ).id;
        }
        materializedPatternIds.add(Number(patternId));
        clearEvidence.run(patternId);
        cluster.rows.forEach((row) => {
          insertEvidence.run(patternId, row.identifier, row.vendor, row.dateOnly, row.amount, confidence);
        });
        linkSubscription.run(patternId, sample.normalizedName, sample.displayName);
      });
    }

    const staleDetected = existingPatterns.filter((pattern) => (
      pattern.source === 'detected'
      && !materializedPatternIds.has(Number(pattern.id))
    ));
    const hasCorrection = db.prepare('SELECT 1 FROM financial_corrections WHERE pattern_id = ? LIMIT 1');
    const hasSubscription = db.prepare('SELECT 1 FROM subscriptions WHERE financial_pattern_id = ? LIMIT 1');
    const deletePattern = db.prepare('DELETE FROM financial_patterns WHERE id = ?');
    staleDetected.forEach((pattern) => {
      if (!hasCorrection.get(pattern.id) && !hasSubscription.get(pattern.id)) deletePattern.run(pattern.id);
    });

    createReturnReviewItems(db);

    db.prepare(`
      UPDATE financial_truth_state
      SET materialized_transaction_signature = ?, materialized_at = datetime('now'),
        revision = revision + 1, updated_at = datetime('now')
      WHERE id = 1
    `).run(signature);
  });
  run();
  invalidateDependentCaches();
  const revision = readTruthRevision(db);
  scheduleDependentRecalculation(revision);
  return { changed: true, revision };
}

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeCorrection(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    requestId: row.request_id,
    targetKind: row.target_kind,
    patternId: row.pattern_id == null ? null : Number(row.pattern_id),
    occurrenceId: row.occurrence_id || null,
    categoryDefinitionId: row.category_definition_id == null ? null : Number(row.category_definition_id),
    action: row.action,
    scope: row.scope,
    effectiveDate: row.effective_date || null,
    effectiveEndDate: row.effective_end_date || null,
    reasonCode: row.reason_code || null,
    sourceFeature: row.source_feature,
    sourceKey: row.source_key || null,
    overrides: parseJson(row.overrides_json, {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revertedAt: row.reverted_at || null,
  };
}

function resolvePattern(pattern, correctionRows) {
  const resolved = {
    id: Number(pattern.id),
    fingerprint: pattern.fingerprint,
    normalizedName: pattern.normalized_name,
    displayName: pattern.display_name,
    direction: pattern.direction,
    categoryDefinitionId: pattern.category_definition_id == null ? null : Number(pattern.category_definition_id),
    frequency: pattern.detected_frequency,
    amount: Number(pattern.detected_amount) || 0,
    amountTolerance: Number(pattern.amount_tolerance) || 0,
    confidence: Number(pattern.confidence) || 0,
    firstSeenDate: pattern.first_seen_date || null,
    lastSeenDate: pattern.last_seen_date || null,
    nextExpectedDate: pattern.next_expected_date || null,
    occurrenceCount: Number(pattern.occurrence_count) || 0,
    isSubscription: Boolean(pattern.is_subscription),
    state: 'active',
    endedAt: null,
    billingDay: null,
    confirmed: false,
    skippedOccurrences: [],
    corrections: correctionRows.map(normalizeCorrection),
  };
  correctionRows.forEach((row) => {
    const overrides = parseJson(row.overrides_json, {});
    if (row.action === 'suppress_pattern') resolved.state = 'suppressed';
    if (row.action === 'pause_pattern') resolved.state = 'paused';
    if (row.action === 'end_pattern') {
      resolved.state = 'ended';
      resolved.endedAt = row.effective_date || toDateOnly(row.created_at);
    }
    if (row.action === 'override_pattern') {
      if (Number.isFinite(Number(overrides.amount)) && Number(overrides.amount) >= 0) resolved.amount = Number(overrides.amount);
      if (FREQUENCY_DAYS[overrides.frequency] || overrides.frequency === 'variable') resolved.frequency = overrides.frequency;
      if (overrides.nextExpectedDate) resolved.nextExpectedDate = toDateOnly(overrides.nextExpectedDate);
      if (Number.isInteger(Number(overrides.billingDay))) resolved.billingDay = Number(overrides.billingDay);
      if (overrides.confirmed === true) resolved.confirmed = true;
    }
    if (row.action === 'skip_occurrence' && row.occurrence_id) resolved.skippedOccurrences.push(row.occurrence_id);
  });
  let skippedGuard = 0;
  while (
    resolved.nextExpectedDate
    && resolved.skippedOccurrences.includes(`pattern:${resolved.id}:${resolved.nextExpectedDate}`)
    && FREQUENCY_DAYS[resolved.frequency]
    && skippedGuard < 24
  ) {
    resolved.nextExpectedDate = formatDate(addFrequency(
      parseDate(resolved.nextExpectedDate),
      resolved.frequency,
      resolved.billingDay,
    ));
    skippedGuard += 1;
  }
  return resolved;
}

function getProjectionSnapshotFromDb(db, { materialize = true } = {}) {
  if (materialize) materializePatterns(db);
  const truthRevision = readTruthRevision(db);
  const patterns = db.prepare('SELECT * FROM financial_patterns ORDER BY id').all();
  const corrections = db.prepare(`
    SELECT * FROM financial_corrections WHERE status = 'active' ORDER BY created_at, id
  `).all();
  const byPattern = new Map();
  corrections.filter((row) => row.pattern_id != null).forEach((row) => {
    if (!byPattern.has(Number(row.pattern_id))) byPattern.set(Number(row.pattern_id), []);
    byPattern.get(Number(row.pattern_id)).push(row);
  });
  const resolvedPatterns = patterns.map((pattern) => resolvePattern(pattern, byPattern.get(Number(pattern.id)) || []));
  const evidenceRows = db.prepare(`
    SELECT evidence.*, pattern.detected_frequency
    FROM financial_pattern_transactions evidence
    JOIN financial_patterns pattern ON pattern.id = evidence.pattern_id
  `).all();
  const resolvedById = new Map(resolvedPatterns.map((pattern) => [pattern.id, pattern]));
  const excludedTransactionKeys = new Set();
  evidenceRows.forEach((row) => {
    const pattern = resolvedById.get(Number(row.pattern_id));
    if (!pattern) return;
    const handledExplicitly = pattern.frequency !== 'variable';
    if (handledExplicitly || pattern.state !== 'active') {
      excludedTransactionKeys.add(`${row.transaction_identifier}\u0000${row.transaction_vendor}`);
    }
  });
  const categoryExpectations = corrections
    .filter((row) => row.action === 'set_category_expectation')
    .map((row) => {
      const correction = normalizeCorrection(row);
      const category = db.prepare('SELECT name, name_en, name_fr FROM category_definitions WHERE id = ?')
        .get(correction.categoryDefinitionId);
      return {
        ...correction,
        categoryName: category?.name_en || category?.name_fr || category?.name
          || `Category ${correction.categoryDefinitionId}`,
      };
    });
  return { truthRevision, patterns: resolvedPatterns, excludedTransactionKeys, categoryExpectations };
}

function getProjectionSnapshot(options = {}) {
  const db = options.db || openDb();
  try {
    return getProjectionSnapshotFromDb(db, options);
  } finally {
    if (!options.db) db.close();
  }
}

function buildRecurringOccurrences(snapshot, startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const occurrences = [];
  snapshot.patterns.forEach((pattern) => {
    if (!FREQUENCY_DAYS[pattern.frequency]) return;
    if (pattern.state === 'suppressed' || pattern.state === 'paused') return;
    let occurrence = pattern.nextExpectedDate
      ? parseDate(pattern.nextExpectedDate)
      : addFrequency(parseDate(pattern.lastSeenDate || startDate), pattern.frequency, pattern.billingDay);
    while (occurrence < start) occurrence = addFrequency(occurrence, pattern.frequency, pattern.billingDay);
    let guard = 0;
    while (occurrence <= end && guard < 400) {
      const date = formatDate(occurrence);
      const occurrenceId = `pattern:${pattern.id}:${date}`;
      const ended = pattern.state === 'ended' && pattern.endedAt && date >= pattern.endedAt;
      if (!ended && !pattern.skippedOccurrences.includes(occurrenceId)) {
        occurrences.push({
          patternId: pattern.id,
          occurrenceId,
          date,
          predictionKind: pattern.direction === 'income' ? 'recurring_income' : 'recurring_expense',
          category: pattern.displayName,
          categoryDefinitionId: pattern.categoryDefinitionId,
          transactionName: pattern.displayName,
          categoryType: pattern.direction,
          probability: Math.max(0.45, pattern.confidence),
          expectedAmount: pattern.amount,
          probabilityWeightedAmount: pattern.amount,
          amountRange: {
            low: Math.max(0, pattern.amount - pattern.amountTolerance),
            high: pattern.amount + pattern.amountTolerance,
          },
          confidence: pattern.confidence,
          explanation: 'Based on a recurring pattern and your saved corrections',
          correctionCapabilities: ['skip_occurrence', 'suppress_pattern', 'end_pattern', 'pause_pattern', 'override_pattern'],
        });
      }
      occurrence = addFrequency(occurrence, pattern.frequency, pattern.billingDay);
      guard += 1;
    }
  });
  return occurrences;
}

function validateDraft(payload = {}) {
  const target = payload.target && typeof payload.target === 'object' ? payload.target : {};
  const action = String(payload.action || '');
  const scope = String(payload.scope || (action === 'skip_occurrence' ? 'occurrence' : 'ongoing'));
  if (!ALLOWED_ACTIONS.has(action)) throw Object.assign(new Error('Invalid correction action'), { status: 400, code: 'INVALID_CORRECTION_ACTION' });
  if (!ALLOWED_SCOPES.has(scope)) throw Object.assign(new Error('Invalid correction scope'), { status: 400, code: 'INVALID_CORRECTION_SCOPE' });
  const targetKind = String(target.kind || (target.patternId ? 'pattern' : target.categoryDefinitionId ? 'category' : ''));
  if (!['pattern', 'occurrence', 'category'].includes(targetKind)) throw Object.assign(new Error('Invalid correction target'), { status: 400, code: 'INVALID_CORRECTION_TARGET' });
  const patternId = target.patternId == null ? null : Number(target.patternId);
  const categoryDefinitionId = target.categoryDefinitionId == null ? null : Number(target.categoryDefinitionId);
  if ((targetKind === 'pattern' || targetKind === 'occurrence') && (!Number.isSafeInteger(patternId) || patternId <= 0)) {
    throw Object.assign(new Error('A valid pattern is required'), { status: 400, code: 'PATTERN_REQUIRED' });
  }
  if (targetKind === 'category' && (!Number.isSafeInteger(categoryDefinitionId) || categoryDefinitionId <= 0)) {
    throw Object.assign(new Error('A valid category is required'), { status: 400, code: 'CATEGORY_REQUIRED' });
  }
  const occurrenceId = target.occurrenceId ? String(target.occurrenceId).slice(0, 180) : null;
  if (action === 'skip_occurrence' && !occurrenceId) throw Object.assign(new Error('An occurrence is required'), { status: 400, code: 'OCCURRENCE_REQUIRED' });
  if (action === 'skip_occurrence' && !occurrenceId.startsWith(`pattern:${patternId}:`)) {
    throw Object.assign(new Error('The occurrence does not belong to this pattern'), { status: 400, code: 'OCCURRENCE_PATTERN_MISMATCH' });
  }
  if (action === 'set_category_expectation' && targetKind !== 'category') {
    throw Object.assign(new Error('Category expectations require a category target'), { status: 400, code: 'CATEGORY_TARGET_REQUIRED' });
  }
  if (action !== 'set_category_expectation' && targetKind === 'category') {
    throw Object.assign(new Error('This correction requires a financial pattern'), { status: 400, code: 'PATTERN_TARGET_REQUIRED' });
  }
  if (action === 'set_category_expectation') {
    const monthlyAmount = Number(payload.overrides?.monthlyAmount);
    if (!Number.isFinite(monthlyAmount) || monthlyAmount < 0) throw Object.assign(new Error('A valid monthly expectation is required'), { status: 400, code: 'MONTHLY_AMOUNT_REQUIRED' });
    if (!['current_month', 'ongoing'].includes(scope)) throw Object.assign(new Error('Invalid category expectation scope'), { status: 400, code: 'INVALID_CATEGORY_SCOPE' });
  }
  if (action === 'override_pattern') {
    const overrides = payload.overrides && typeof payload.overrides === 'object' ? payload.overrides : {};
    const hasOverride = overrides.amount != null || overrides.frequency || overrides.nextExpectedDate
      || overrides.billingDay != null || overrides.confirmed === true;
    if (!hasOverride) throw Object.assign(new Error('At least one corrected value is required'), { status: 400, code: 'OVERRIDE_REQUIRED' });
    if (overrides.amount != null && (!Number.isFinite(Number(overrides.amount)) || Number(overrides.amount) < 0)) {
      throw Object.assign(new Error('A valid amount is required'), { status: 400, code: 'INVALID_OVERRIDE_AMOUNT' });
    }
    if (overrides.frequency && !FREQUENCY_DAYS[overrides.frequency]) {
      throw Object.assign(new Error('A valid frequency is required'), { status: 400, code: 'INVALID_OVERRIDE_FREQUENCY' });
    }
    if (overrides.billingDay != null && (!Number.isInteger(Number(overrides.billingDay)) || Number(overrides.billingDay) < 1 || Number(overrides.billingDay) > 31)) {
      throw Object.assign(new Error('A valid billing day is required'), { status: 400, code: 'INVALID_BILLING_DAY' });
    }
  }
  return {
    requestId: String(payload.requestId || crypto.randomUUID()).slice(0, 120),
    targetKind,
    patternId,
    occurrenceId,
    categoryDefinitionId,
    action,
    scope,
    effectiveDate: toDateOnly(payload.effectiveDate),
    effectiveEndDate: toDateOnly(payload.effectiveEndDate),
    reasonCode: payload.reasonCode ? String(payload.reasonCode).slice(0, 80) : null,
    sourceFeature: String(payload.source?.feature || payload.sourceFeature || 'unknown').slice(0, 80),
    sourceKey: payload.source?.sourceKey || payload.sourceKey ? String(payload.source?.sourceKey || payload.sourceKey).slice(0, 180) : null,
    overrides: payload.overrides && typeof payload.overrides === 'object' ? payload.overrides : {},
  };
}

function monthlyAmount(pattern) {
  const multiplier = {
    daily: 30,
    weekly: 4.345,
    biweekly: 2.1725,
    monthly: 1,
    bimonthly: 0.5,
    quarterly: 1 / 3,
    yearly: 1 / 12,
  }[pattern.frequency] || 1;
  return pattern.amount * multiplier;
}

function previewCorrection(payload, options = {}) {
  const draft = validateDraft(payload);
  const db = options.db || openDb();
  try {
    const snapshot = getProjectionSnapshotFromDb(db);
    const pattern = draft.patternId ? snapshot.patterns.find((item) => item.id === draft.patternId) : null;
    if (draft.patternId && !pattern) throw Object.assign(new Error('Financial pattern not found'), { status: 404, code: 'PATTERN_NOT_FOUND' });
    let delta = 0;
    let sixMonthDelta = 0;
    if (pattern) {
      const baseMonthly = monthlyAmount(pattern);
      if (['suppress_pattern', 'end_pattern', 'pause_pattern'].includes(draft.action)) delta = -baseMonthly;
      if (draft.action === 'skip_occurrence') {
        delta = -pattern.amount;
        sixMonthDelta = -pattern.amount;
      }
      if (draft.action === 'override_pattern') {
        const overridden = {
          ...pattern,
          amount: Number.isFinite(Number(draft.overrides.amount))
            ? Number(draft.overrides.amount)
            : pattern.amount,
          frequency: FREQUENCY_DAYS[draft.overrides.frequency]
            ? draft.overrides.frequency
            : pattern.frequency,
        };
        delta = monthlyAmount(overridden) - baseMonthly;
      }
    } else if (draft.action === 'set_category_expectation') {
      const baselineRows = db.prepare(`
        SELECT SUM(ABS(price)) AS monthly_total
        FROM transactions
        WHERE status = 'completed' AND category_definition_id = ? AND price < 0
          AND substr(date, 1, 7) < strftime('%Y-%m', 'now', 'localtime')
        GROUP BY substr(date, 1, 7)
        ORDER BY substr(date, 1, 7) DESC
        LIMIT 6
      `).all(draft.categoryDefinitionId);
      const baseline = baselineRows.length
        ? baselineRows.reduce((sum, row) => sum + (Number(row.monthly_total) || 0), 0) / baselineRows.length
        : 0;
      delta = (Number(draft.overrides.monthlyAmount) || 0) - baseline;
    }
    if (draft.action !== 'skip_occurrence') {
      sixMonthDelta = delta * (draft.scope === 'current_month' ? 1 : 6);
    }
    return {
      success: true,
      truthRevision: snapshot.truthRevision,
      target: pattern ? {
        kind: draft.targetKind,
        patternId: pattern.id,
        occurrenceId: draft.occurrenceId,
        title: pattern.displayName,
        amount: pattern.amount,
        frequency: pattern.frequency,
      } : {
        kind: 'category',
        categoryDefinitionId: draft.categoryDefinitionId,
      },
      impact: {
        monthlyDelta: Math.round(delta * 100) / 100,
        sixMonthDelta: Math.round(sixMonthDelta * 100) / 100,
        affectedSurfaces: affectedDomainsForCorrection(draft),
      },
      draft,
    };
  } finally {
    if (!options.db) db.close();
  }
}

function retireDerivedActions(db, draft) {
  const hasSmartActions = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'smart_action_items'",
  ).get();
  if (!hasSmartActions) return;
  let affected = [];
  if (draft.patternId) {
    const marker = `%\"patternId\":${draft.patternId}%`;
    affected = db.prepare(`
      SELECT id, user_status FROM smart_action_items
      WHERE user_status IN ('active', 'accepted', 'snoozed')
        AND (metadata LIKE ? OR recurrence_key = ?)
    `).all(marker, `financial_pattern:${draft.patternId}`);
  } else if (draft.categoryDefinitionId) {
    affected = db.prepare(`
      SELECT id, user_status FROM smart_action_items
      WHERE user_status IN ('active', 'accepted', 'snoozed')
        AND trigger_category_id = ?
    `).all(draft.categoryDefinitionId);
  }
  if (!affected.length) return;
  const ids = affected.map((row) => Number(row.id)).filter(Number.isSafeInteger);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`
    UPDATE smart_action_items
    SET user_status = 'dismissed', dismissed_at = datetime('now'),
      completion_result = '{"success":null,"reason":"source_corrected","message":"No longer relevant after your correction"}',
      updated_at = datetime('now')
    WHERE id IN (${placeholders})
  `).run(...ids);
  const hasActionHistory = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'action_item_history'",
  ).get();
  if (hasActionHistory) {
    const insertHistory = db.prepare(`
      INSERT INTO action_item_history (
        smart_action_item_id, action, previous_status, new_status, metadata
      ) VALUES (?, 'dismissed', ?, 'dismissed', ?)
    `);
    affected.forEach((row) => insertHistory.run(
      row.id,
      row.user_status,
      JSON.stringify({
        reason: 'source_corrected',
        message: 'No longer relevant after your correction',
      }),
    ));
  }
  const hasOptimizerCandidates = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'optimizer_v2_candidates'",
  ).get();
  if (hasOptimizerCandidates) {
    db.prepare(`
      UPDATE optimizer_v2_candidates SET lifecycle_state = 'dismissed',
        dismiss_reason = 'source_corrected', updated_at = datetime('now')
      WHERE smart_action_item_id IN (${placeholders})
    `).run(...ids);
  }
}

function mirrorResolvedPatternToSubscriptions(db, patternId) {
  if (!patternId) return;
  const pattern = db.prepare('SELECT * FROM financial_patterns WHERE id = ?').get(patternId);
  if (!pattern) return;
  const corrections = db.prepare(`
    SELECT * FROM financial_corrections
    WHERE pattern_id = ? AND status = 'active'
    ORDER BY created_at, id
  `).all(patternId);
  const resolved = resolvePattern(pattern, corrections);
  const status = resolved.state === 'suppressed' || resolved.state === 'ended'
    ? 'cancelled'
    : resolved.state === 'paused'
      ? 'paused'
      : resolved.confirmed ? 'keep' : 'active';
  const hasAmountOverride = corrections.some((row) => (
    row.action === 'override_pattern' && parseJson(row.overrides_json, {}).amount != null
  ));
  const hasFrequencyOverride = corrections.some((row) => (
    row.action === 'override_pattern' && parseJson(row.overrides_json, {}).frequency
  ));
  db.prepare(`
    UPDATE subscriptions SET
      user_amount = ?, user_frequency = ?, billing_day = ?,
      next_expected_date = ?, status = ?, updated_at = datetime('now')
    WHERE financial_pattern_id = ?
  `).run(
    hasAmountOverride ? resolved.amount : null,
    hasFrequencyOverride ? resolved.frequency : null,
    resolved.billingDay,
    resolved.nextExpectedDate,
    status,
    patternId,
  );
}

function syncLegacySubscription(db, draft) {
  if (draft.patternId) mirrorResolvedPatternToSubscriptions(db, draft.patternId);
}

function createCorrection(payload, options = {}) {
  const draft = validateDraft(payload);
  const db = options.db || openDb();
  try {
    materializePatterns(db);
    const existing = db.prepare('SELECT * FROM financial_corrections WHERE request_id = ?').get(draft.requestId);
    if (existing) {
      return { success: true, correction: normalizeCorrection(existing), truthRevision: readTruthRevision(db), affectedDomains: affectedDomainsForCorrection(existing), refreshState: 'pending' };
    }
    if (draft.patternId && !db.prepare('SELECT 1 FROM financial_patterns WHERE id = ?').get(draft.patternId)) {
      throw Object.assign(new Error('Financial pattern not found'), { status: 404, code: 'PATTERN_NOT_FOUND' });
    }
    const commit = db.transaction(() => {
      const stateActions = ['suppress_pattern', 'end_pattern', 'pause_pattern'];
      if (stateActions.includes(draft.action)) {
        db.prepare(`
          UPDATE financial_corrections SET status = 'superseded', updated_at = datetime('now')
          WHERE pattern_id = ? AND status = 'active'
            AND action IN ('suppress_pattern', 'end_pattern', 'pause_pattern')
        `).run(draft.patternId);
      } else if (draft.action === 'override_pattern') {
        db.prepare(`
          UPDATE financial_corrections SET status = 'superseded', updated_at = datetime('now')
          WHERE pattern_id = ? AND status = 'active' AND action = 'override_pattern'
        `).run(draft.patternId);
      } else if (draft.action === 'set_category_expectation') {
        db.prepare(`
          UPDATE financial_corrections SET status = 'superseded', updated_at = datetime('now')
          WHERE category_definition_id = ? AND scope = ? AND status = 'active'
            AND action = 'set_category_expectation'
        `).run(draft.categoryDefinitionId, draft.scope);
      } else if (draft.action === 'skip_occurrence') {
        const duplicate = db.prepare(`
          SELECT * FROM financial_corrections
          WHERE occurrence_id = ? AND action = 'skip_occurrence' AND status = 'active'
        `).get(draft.occurrenceId);
        if (duplicate) return duplicate;
      }
      const row = db.prepare(`
        INSERT INTO financial_corrections (
          request_id, target_kind, pattern_id, occurrence_id, category_definition_id,
          action, scope, effective_date, effective_end_date, reason_code,
          source_feature, source_key, overrides_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `).get(
        draft.requestId, draft.targetKind, draft.patternId, draft.occurrenceId,
        draft.categoryDefinitionId, draft.action, draft.scope, draft.effectiveDate,
        draft.effectiveEndDate, draft.reasonCode, draft.sourceFeature, draft.sourceKey,
        JSON.stringify(draft.overrides),
      );
      syncLegacySubscription(db, draft);
      retireDerivedActions(db, draft);
      incrementRevision(db);
      return row;
    });
    const correction = commit();
    invalidateDependentCaches();
    scheduleDependentRecalculation(readTruthRevision(db));
    return {
      success: true,
      correction: normalizeCorrection(correction),
      truthRevision: readTruthRevision(db),
      affectedDomains: affectedDomainsForCorrection(draft),
      refreshState: 'pending',
    };
  } finally {
    if (!options.db) db.close();
  }
}

function listCorrections({ status = 'active' } = {}, options = {}) {
  const db = options.db || openDb({ readonly: false });
  try {
    materializePatterns(db);
    const allowedStatus = ['active', 'reverted', 'superseded'].includes(status) ? status : 'active';
    const rows = db.prepare(`
      SELECT correction.*, pattern.display_name AS pattern_display_name,
        category.name AS category_name
      FROM financial_corrections correction
      LEFT JOIN financial_patterns pattern ON pattern.id = correction.pattern_id
      LEFT JOIN category_definitions category ON category.id = correction.category_definition_id
      WHERE correction.status = ?
      ORDER BY correction.created_at DESC, correction.id DESC
    `).all(allowedStatus);
    return {
      success: true,
      truthRevision: readTruthRevision(db),
      corrections: rows.map((row) => ({
        ...normalizeCorrection(row),
        targetLabel: row.pattern_display_name || row.category_name || row.occurrence_id || 'Financial prediction',
        affectedDomains: affectedDomainsForCorrection(row),
      })),
    };
  } finally {
    if (!options.db) db.close();
  }
}

function revertCorrection(correctionId, options = {}) {
  const id = Number(correctionId);
  if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error('Invalid correction ID'), { status: 400, code: 'INVALID_CORRECTION_ID' });
  const db = options.db || openDb();
  try {
    const commit = db.transaction(() => {
      const row = db.prepare('SELECT * FROM financial_corrections WHERE id = ?').get(id);
      if (!row) throw Object.assign(new Error('Correction not found'), { status: 404, code: 'CORRECTION_NOT_FOUND' });
      if (row.status !== 'reverted') {
        db.prepare(`
          UPDATE financial_corrections SET status = 'reverted', reverted_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).run(id);
        if (row.pattern_id) {
          const hasStateCorrection = db.prepare(`
            SELECT 1 FROM financial_corrections WHERE pattern_id = ? AND status = 'active'
              AND action IN ('suppress_pattern', 'end_pattern', 'pause_pattern') LIMIT 1
          `).get(row.pattern_id);
          if (!hasStateCorrection) {
            db.prepare(`UPDATE subscriptions SET status = 'active', updated_at = datetime('now') WHERE financial_pattern_id = ?`).run(row.pattern_id);
          }
          mirrorResolvedPatternToSubscriptions(db, row.pattern_id);
        }
        incrementRevision(db);
      }
      return db.prepare('SELECT * FROM financial_corrections WHERE id = ?').get(id);
    });
    const correction = commit();
    invalidateDependentCaches();
    scheduleDependentRecalculation(readTruthRevision(db));
    return {
      success: true,
      correction: normalizeCorrection(correction),
      truthRevision: readTruthRevision(db),
      affectedDomains: affectedDomainsForCorrection(correction),
      refreshState: 'pending',
    };
  } finally {
    if (!options.db) db.close();
  }
}

function setPresentationDismissal(sourceKey, { hidden = true, sourceType = 'notification' } = {}, options = {}) {
  const key = String(sourceKey || '').trim().slice(0, 220);
  if (!key) throw Object.assign(new Error('A source key is required'), { status: 400, code: 'SOURCE_KEY_REQUIRED' });
  const db = options.db || openDb();
  try {
    db.prepare(`
      INSERT INTO presentation_dismissals (source_key, source_type, hidden, hidden_at, updated_at)
      VALUES (?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, datetime('now'))
      ON CONFLICT(source_key) DO UPDATE SET
        source_type = excluded.source_type, hidden = excluded.hidden,
        hidden_at = excluded.hidden_at, updated_at = datetime('now')
    `).run(key, String(sourceType || 'notification').slice(0, 80), hidden ? 1 : 0, hidden ? 1 : 0);
    return { success: true, sourceKey: key, hidden: Boolean(hidden) };
  } finally {
    if (!options.db) db.close();
  }
}

function upsertManualSubscriptionPattern(subscriptionId, options = {}) {
  const id = Number(subscriptionId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const db = options.db || openDb();
  try {
    const subscription = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
    if (!subscription) return null;
    const normalizedName = normalizeName(subscription.pattern_key || subscription.display_name);
    if (!normalizedName) return null;
    const frequency = subscription.user_frequency || subscription.detected_frequency || 'monthly';
    const amount = Number(subscription.user_amount ?? subscription.detected_amount) || 0;
    const commit = db.transaction(() => {
      const pattern = db.prepare(`
        INSERT INTO financial_patterns (
          fingerprint, normalized_name, display_name, direction, category_definition_id,
          detected_frequency, detected_amount, amount_tolerance, confidence,
          next_expected_date, source, is_subscription
        ) VALUES (?, ?, ?, 'expense', ?, ?, ?, ?, 1, ?, 'manual', 1)
        ON CONFLICT(fingerprint) DO UPDATE SET
          display_name = excluded.display_name,
          category_definition_id = excluded.category_definition_id,
          detected_frequency = excluded.detected_frequency,
          detected_amount = excluded.detected_amount,
          amount_tolerance = excluded.amount_tolerance,
          next_expected_date = excluded.next_expected_date,
          updated_at = datetime('now')
        RETURNING id
      `).get(
        `manual:subscription:${id}`,
        normalizedName,
        subscription.display_name,
        subscription.category_definition_id || null,
        frequency,
        amount,
        Math.max(5, amount * 0.15),
        subscription.next_expected_date || null,
      );
      db.prepare('UPDATE subscriptions SET financial_pattern_id = ? WHERE id = ?').run(pattern.id, id);
      incrementRevision(db);
      return Number(pattern.id);
    });
    const patternId = commit();
    invalidateDependentCaches();
    scheduleDependentRecalculation(readTruthRevision(db));
    return patternId;
  } finally {
    if (!options.db) db.close();
  }
}

function restorePatternState(patternId, { sourceFeature = 'subscriptions', sourceKey = null } = {}, options = {}) {
  const id = Number(patternId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const db = options.db || openDb();
  try {
    const commit = db.transaction(() => {
      const rows = db.prepare(`
        SELECT id FROM financial_corrections
        WHERE pattern_id = ? AND status = 'active'
          AND action IN ('suppress_pattern', 'end_pattern', 'pause_pattern')
      `).all(id);
      if (!rows.length) return false;
      db.prepare(`
        UPDATE financial_corrections SET status = 'reverted', reverted_at = datetime('now'),
          updated_at = datetime('now')
        WHERE pattern_id = ? AND status = 'active'
          AND action IN ('suppress_pattern', 'end_pattern', 'pause_pattern')
      `).run(id);
      db.prepare(`UPDATE subscriptions SET status = 'active', updated_at = datetime('now') WHERE financial_pattern_id = ?`).run(id);
      mirrorResolvedPatternToSubscriptions(db, id);
      incrementRevision(db);
      return true;
    });
    const changed = commit();
    if (changed) invalidateDependentCaches();
    if (changed) scheduleDependentRecalculation(readTruthRevision(db));
    return { success: true, patternId: id, changed, sourceFeature, sourceKey, truthRevision: readTruthRevision(db) };
  } finally {
    if (!options.db) db.close();
  }
}

function applySubscriptionUpdate(subscriptionId, updates = {}, options = {}) {
  const db = options.db || openDb();
  try {
    let row = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(Number(subscriptionId));
    if (!row) return null;
    let patternId = Number(row.financial_pattern_id) || null;
    if (!patternId) {
      patternId = upsertManualSubscriptionPattern(subscriptionId, { db });
      row = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(Number(subscriptionId));
    }
    const source = { feature: 'subscriptions', sourceKey: `subscription:${subscriptionId}` };
    const status = updates.status;
    if (status === 'active' || status === 'keep') restorePatternState(patternId, { sourceFeature: source.feature, sourceKey: source.sourceKey }, { db });
    if (status === 'paused') {
      createCorrection({ target: { kind: 'pattern', patternId }, action: 'pause_pattern', scope: 'ongoing', reasonCode: 'subscription_paused', source }, { db });
    } else if (status === 'cancelled') {
      createCorrection({ target: { kind: 'pattern', patternId }, action: 'end_pattern', scope: 'from_date', effectiveDate: formatDate(new Date()), reasonCode: 'subscription_cancelled', source }, { db });
    }
    const hasOverrides = updates.user_amount != null || updates.user_frequency || updates.billing_day != null || status === 'keep';
    if (hasOverrides) {
      createCorrection({
        target: { kind: 'pattern', patternId },
        action: 'override_pattern',
        scope: 'ongoing',
        reasonCode: 'subscription_edited',
        source,
        overrides: {
          ...(updates.user_amount != null ? { amount: Number(updates.user_amount) } : {}),
          ...(updates.user_frequency ? { frequency: updates.user_frequency } : {}),
          ...(updates.billing_day != null ? { billingDay: Number(updates.billing_day) } : {}),
          ...(status === 'keep' ? { confirmed: true } : {}),
        },
      }, { db });
    }
    return { success: true, patternId, truthRevision: readTruthRevision(db) };
  } finally {
    if (!options.db) db.close();
  }
}

function getHiddenSourceKeys(options = {}) {
  const db = options.db || openDb({ readonly: true });
  try {
    return new Set(db.prepare('SELECT source_key FROM presentation_dismissals WHERE hidden = 1').all().map((row) => row.source_key));
  } finally {
    if (!options.db) db.close();
  }
}

function listPresentationDismissals(options = {}) {
  const db = options.db || openDb({ readonly: true });
  try {
    return {
      success: true,
      sourceKeys: db.prepare('SELECT source_key FROM presentation_dismissals WHERE hidden = 1 ORDER BY updated_at DESC').all().map((row) => row.source_key),
    };
  } finally {
    if (!options.db) db.close();
  }
}

module.exports = {
  AFFECTED_DOMAINS,
  affectedDomainsForCorrection,
  scheduleDependentRecalculation,
  applySubscriptionUpdate,
  buildRecurringOccurrences,
  createCorrection,
  getHiddenSourceKeys,
  getProjectionSnapshot,
  getProjectionSnapshotFromDb,
  inferFrequency,
  listCorrections,
  listPresentationDismissals,
  materializePatterns,
  normalizeName,
  previewCorrection,
  readTruthRevision,
  revertCorrection,
  setPresentationDismissal,
  restorePatternState,
  upsertManualSubscriptionPattern,
  validateDraft,
  _internal: {
    addFrequency,
    clusterAmounts,
    formatDate,
    monthlyAmount,
    openDb,
    parseDate,
    resolvePattern,
    transactionSignature,
  },
};
module.exports.default = module.exports;
