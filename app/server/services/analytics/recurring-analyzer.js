const database = require('../database.js');
const {
  CREDIT_CARD_REPAYMENT_CATEGORY_MATCH,
  getCreditCardRepaymentCategoryCondition,
} = require('../accounts/repayment-category.js');

const FREQUENCY_INTERVALS = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  bimonthly: 60,
  quarterly: 91,
  yearly: 365,
  variable: null
};

const FREQUENCY_THRESHOLDS = {
  daily: { min: 20, max: 31 },
  weekly: { min: 3.5, max: 5 },
  biweekly: { min: 1.8, max: 2.5 },
  monthly: { min: 0.8, max: 1.2 },
  bimonthly: { min: 0.4, max: 0.6 },
  quarterly: { min: 0.25, max: 0.4 },
  yearly: { min: 0.08, max: 0.15 }
};

const REPAYMENT_CATEGORY_NAMES = new Set([
  ...CREDIT_CARD_REPAYMENT_CATEGORY_MATCH.name,
  ...CREDIT_CARD_REPAYMENT_CATEGORY_MATCH.name_en,
  ...CREDIT_CARD_REPAYMENT_CATEGORY_MATCH.name_fr,
]);

function normalizePatternKey(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0590-\u05FF]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizeChargeDate(value) {
  if (!value) return null;
  return String(value).split('T')[0];
}

function computeMonthsSpan(dates) {
  if (!dates || dates.length === 0) return 1;
  const sorted = [...dates].sort();
  const first = new Date(sorted[0]);
  const last = new Date(sorted[sorted.length - 1]);
  const months =
    (last.getFullYear() - first.getFullYear()) * 12 +
    (last.getMonth() - first.getMonth()) +
    1;
  return Math.max(1, months);
}

function detectFrequency(occurrencesPerMonth) {
  for (const [freq, threshold] of Object.entries(FREQUENCY_THRESHOLDS)) {
    if (occurrencesPerMonth >= threshold.min && occurrencesPerMonth <= threshold.max) {
      return freq;
    }
  }
  return 'variable';
}

function detectFrequencyFromIntervals(dates) {
  if (!dates || dates.length < 2) return 'variable';
  const sortedDates = [...dates].sort().map((d) => new Date(d));
  const intervals = [];

  for (let i = 1; i < sortedDates.length; i += 1) {
    const daysDiff = Math.round((sortedDates[i] - sortedDates[i - 1]) / (1000 * 60 * 60 * 24));
    if (daysDiff > 0) {
      intervals.push(daysDiff);
    }
  }

  if (intervals.length === 0) return 'variable';

  const avgInterval = intervals.reduce((sum, d) => sum + d, 0) / intervals.length;
  let best = 'variable';
  let bestDiff = Infinity;

  for (const [freq, interval] of Object.entries(FREQUENCY_INTERVALS)) {
    if (!interval) continue;
    const diff = Math.abs(avgInterval - interval);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = freq;
    }
  }

  return best;
}

function calculateConsistencyScore(dates, expectedFrequency) {
  if (!dates || dates.length < 2) return 0;

  const expectedInterval = FREQUENCY_INTERVALS[expectedFrequency];
  if (!expectedInterval) return 0.5;

  const sortedDates = dates.map((d) => new Date(d)).sort((a, b) => a - b);
  const intervals = [];

  for (let i = 1; i < sortedDates.length; i += 1) {
    const daysDiff = Math.round((sortedDates[i] - sortedDates[i - 1]) / (1000 * 60 * 60 * 24));
    intervals.push(daysDiff);
  }

  if (intervals.length === 0) return 0;

  const deviations = intervals.map((interval) =>
    Math.abs(interval - expectedInterval) / expectedInterval
  );
  const avgDeviation = deviations.reduce((sum, d) => sum + d, 0) / deviations.length;

  return Math.max(0, 1 - avgDeviation);
}

function clusterCharges(charges, { tolerancePct = 0.08, minTolerance = 5 } = {}) {
  const sorted = [...charges].sort((a, b) => a.amount - b.amount);
  const clusters = [];

  for (const charge of sorted) {
    let matched = null;
    for (const cluster of clusters) {
      const tolerance = Math.max(cluster.mean * tolerancePct, minTolerance);
      if (Math.abs(charge.amount - cluster.mean) <= tolerance) {
        matched = cluster;
        break;
      }
    }

    if (matched) {
      matched.charges.push(charge);
      matched.total += charge.amount;
      matched.mean = matched.total / matched.charges.length;
      if (!matched.latestDate || charge.date > matched.latestDate) {
        matched.latestDate = charge.date;
      }
    } else {
      clusters.push({
        charges: [charge],
        total: charge.amount,
        mean: charge.amount,
        latestDate: charge.date,
      });
    }
  }

  return clusters;
}

function selectDominantCluster(charges, options) {
  const clusters = clusterCharges(charges, options);
  if (clusters.length === 0) return null;

  let best = clusters[0];
  for (const cluster of clusters.slice(1)) {
    if (cluster.charges.length > best.charges.length) {
      best = cluster;
      continue;
    }
    if (cluster.charges.length === best.charges.length) {
      if (cluster.latestDate > best.latestDate) {
        best = cluster;
        continue;
      }
      if (cluster.latestDate === best.latestDate && cluster.total > best.total) {
        best = cluster;
      }
    }
  }

  const amounts = best.charges.map((c) => c.amount);
  const mean = best.mean;
  const variance = amounts.length > 1
    ? amounts.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / (amounts.length - 1)
    : 0;
  best.coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 0;
  return best;
}

function resolveCategoryFields(row) {
  return {
    category_definition_id: row.category_definition_id ?? row.category_id ?? null,
    category_name: row.category_name ?? row.category ?? null,
    category_name_en: row.category_name_en ?? row.category_en ?? null,
    category_name_fr: row.category_name_fr ?? row.category_fr ?? null,
    category_icon: row.category_icon ?? row.icon_name ?? null,
    category_color: row.category_color ?? null,
    parent_category_name: row.parent_category_name ?? row.parent_category ?? null,
    parent_category_name_en: row.parent_category_name_en ?? row.parent_category_en ?? null,
    parent_category_name_fr: row.parent_category_name_fr ?? row.parent_category_fr ?? null,
  };
}

function isCreditCardRepayment(row) {
  const fields = [
    row.category_name,
    row.category_name_en,
    row.category_name_fr,
    row.parent_category_name,
    row.parent_category_name_en,
    row.parent_category_name_fr,
    row.parent_category,
    row.parent_category_en,
    row.parent_category_fr,
  ].filter(Boolean);

  return fields.some((value) => REPAYMENT_CATEGORY_NAMES.has(value));
}

function normalizeTransactionRow(row) {
  const rawName = (row.name || row.vendor || '').trim();
  const amountSource = row.amount ?? row.price ?? 0;
  const amount = Number.isFinite(amountSource)
    ? Math.abs(amountSource)
    : Math.abs(Number(amountSource)) || 0;
  return {
    date: row.date,
    name: rawName,
    vendor: row.vendor || null,
    amount,
    ...resolveCategoryFields(row),
  };
}

async function loadTransactions({
  client,
  monthsBack,
  excludeCreditCardRepayments,
  excludePairingExclusions,
}) {
  const sinceDate = new Date();
  sinceDate.setMonth(sinceDate.getMonth() - monthsBack);

  const repaymentCategoryCondition = getCreditCardRepaymentCategoryCondition('cd');
  const pairingJoin = excludePairingExclusions
    ? 'LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe ON t.identifier = tpe.transaction_identifier AND t.vendor = tpe.transaction_vendor'
    : '';
  const pairingWhere = excludePairingExclusions ? 'AND tpe.transaction_identifier IS NULL' : '';
  const repaymentFilter = excludeCreditCardRepayments
    ? `AND (cd.id IS NULL OR NOT ${repaymentCategoryCondition})`
    : '';

  const result = await (client || database).query(
    `SELECT
      t.date,
      t.name,
      t.vendor,
      ABS(t.price) as amount,
      t.category_definition_id,
      cd.name as category_name,
      cd.name_en as category_name_en,
      cd.name_fr as category_name_fr,
      cd.icon as category_icon,
      cd.color as category_color,
      parent_cd.id as parent_category_id,
      parent_cd.name as parent_category_name,
      parent_cd.name_en as parent_category_name_en,
      parent_cd.name_fr as parent_category_name_fr
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id
    ${pairingJoin}
    WHERE t.status = 'completed'
      AND t.category_type = 'expense'
      AND t.price < 0
      AND t.date >= $1
      AND TRIM(COALESCE(t.name, t.vendor)) != ''
      ${pairingWhere}
      ${repaymentFilter}
    ORDER BY t.date ASC`,
    [sinceDate.toISOString()]
  );

  return result.rows || [];
}

async function analyzeRecurringPatterns(options = {}) {
  const {
    client,
    transactions,
    monthsBack = 6,
    minOccurrences = 2,
    minConsistency = 0.3,
    minAmount = 0,
    minVariableAmount = 50,
    aggregateBy = 'day',
    excludeCreditCardRepayments = true,
    excludePairingExclusions = false,
    cluster = { tolerancePct: 0.08, minTolerance: 5 },
  } = options;

  const rows = transactions || await loadTransactions({
    client,
    monthsBack,
    excludeCreditCardRepayments,
    excludePairingExclusions,
  });

  const patternGroups = new Map();

  for (const row of rows) {
    if (excludeCreditCardRepayments && isCreditCardRepayment(row)) {
      continue;
    }
    const normalized = normalizeTransactionRow(row);
    if (!normalized.name || !normalized.date || normalized.amount <= 0) continue;

    const normalizedKey = normalizePatternKey(normalized.name);
    if (!normalizedKey) continue;

    let group = patternGroups.get(normalizedKey);
    if (!group) {
      group = {
        pattern_key: normalizedKey,
        displayNames: new Map(),
        chargesByDay: new Map(),
        charges: [],
        categoryStats: new Map(),
      };
      patternGroups.set(normalizedKey, group);
    }

    const nameCount = group.displayNames.get(normalized.name) || 0;
    group.displayNames.set(normalized.name, nameCount + 1);

    const chargeDate = normalizeChargeDate(normalized.date);
    if (!chargeDate) continue;

    if (aggregateBy === 'day') {
      const existingCharge = group.chargesByDay.get(chargeDate);
      if (existingCharge) {
        existingCharge.amount += normalized.amount;
      } else {
        group.chargesByDay.set(chargeDate, { date: chargeDate, amount: normalized.amount });
      }
    } else {
      group.charges.push({ date: chargeDate, amount: normalized.amount });
    }

    const categoryId = normalized.category_definition_id || null;
    if (categoryId) {
      let stats = group.categoryStats.get(categoryId);
      if (!stats) {
        stats = {
          category_definition_id: categoryId,
          category_name: normalized.category_name,
          category_name_en: normalized.category_name_en,
          category_name_fr: normalized.category_name_fr,
          category_icon: normalized.category_icon,
          category_color: normalized.category_color,
          parent_category_name: normalized.parent_category_name,
          parent_category_name_en: normalized.parent_category_name_en,
          parent_category_name_fr: normalized.parent_category_name_fr,
          total: 0,
          count: 0,
        };
        group.categoryStats.set(categoryId, stats);
      }
      stats.total += normalized.amount;
      stats.count += 1;
    }
  }

  const patterns = [];
  const meta = {
    total_candidates: patternGroups.size,
    excluded_occurrences: 0,
    excluded_consistency: 0,
    excluded_amount: 0,
  };

  for (const group of patternGroups.values()) {
    const charges = aggregateBy === 'day'
      ? Array.from(group.chargesByDay.values())
      : group.charges;

    if (charges.length < minOccurrences) {
      meta.excluded_occurrences += 1;
      continue;
    }

    const dominantCluster = selectDominantCluster(charges, cluster);
    let clusterCharges = dominantCluster?.charges?.length ? dominantCluster.charges : charges;
    if (clusterCharges.length < minOccurrences) {
      clusterCharges = charges;
    }
    if (clusterCharges.length < minOccurrences) {
      meta.excluded_occurrences += 1;
      continue;
    }

    const clusterDates = clusterCharges.map((charge) => charge.date).sort();
    const monthsSpan = computeMonthsSpan(clusterDates);
    const occurrencesPerMonth = clusterCharges.length / monthsSpan;
    const intervalFrequency = detectFrequencyFromIntervals(clusterDates);
    const intervalConsistency = calculateConsistencyScore(clusterDates, intervalFrequency);
    const occurrenceFrequency = detectFrequency(occurrencesPerMonth);
    const detectedFrequency =
      intervalFrequency !== 'variable' && intervalConsistency >= minConsistency
        ? intervalFrequency
        : occurrenceFrequency;

    const consistencyScore = calculateConsistencyScore(clusterDates, detectedFrequency);
    if (consistencyScore < minConsistency) {
      meta.excluded_consistency += 1;
      continue;
    }

    const detectedAmount =
      dominantCluster && dominantCluster.charges.length >= minOccurrences
        ? dominantCluster.mean
        : charges.reduce((sum, charge) => sum + charge.amount, 0) / charges.length;

    if (detectedFrequency === 'variable' && detectedAmount < minVariableAmount) {
      meta.excluded_amount += 1;
      continue;
    }
    if (detectedAmount < minAmount) {
      meta.excluded_amount += 1;
      continue;
    }

    const amountSamples = clusterCharges.map((charge) => charge.amount);
    const amountMean = amountSamples.reduce((sum, amount) => sum + amount, 0) / amountSamples.length;
    const amountVariance = amountSamples.length > 1
      ? amountSamples.reduce((sum, amount) => sum + Math.pow(amount - amountMean, 2), 0) / (amountSamples.length - 1)
      : 0;
    const amountStdDev = Math.sqrt(amountVariance);
    const amountCoefficientOfVariation = amountMean > 0 ? amountStdDev / amountMean : 0;
    const amountIsFixed = amountSamples.length >= minOccurrences && amountCoefficientOfVariation < 0.1;

    let displayName = null;
    let displayCount = 0;
    for (const [name, count] of group.displayNames.entries()) {
      if (count > displayCount) {
        displayName = name;
        displayCount = count;
      }
    }

    let category = null;
    for (const stats of group.categoryStats.values()) {
      if (!category || stats.total > category.total) {
        category = stats;
      }
    }

    const firstDetectedDate = clusterDates[0];
    const lastChargeDate = clusterDates[clusterDates.length - 1];
    const totalSpent = clusterCharges.reduce((sum, charge) => sum + charge.amount, 0);

    patterns.push({
      pattern_key: group.pattern_key,
      display_name: displayName || group.pattern_key,
      detected_frequency: detectedFrequency,
      detected_amount: Math.round(detectedAmount * 100) / 100,
      amount_is_fixed: amountIsFixed ? 1 : 0,
      consistency_score: Math.round(consistencyScore * 100) / 100,
      occurrence_count: clusterCharges.length,
      occurrences_per_month: Math.round(occurrencesPerMonth * 100) / 100,
      months_span: monthsSpan,
      total_spent: Math.round(totalSpent * 100) / 100,
      first_detected_date: firstDetectedDate,
      last_charge_date: lastChargeDate,
      amount_stddev: Math.round(amountStdDev * 100) / 100,
      amount_coefficient_of_variation: Math.round(amountCoefficientOfVariation * 10000) / 10000,
      category_definition_id: category?.category_definition_id ?? null,
      category_name: category?.category_name ?? null,
      category_name_en: category?.category_name_en ?? null,
      category_name_fr: category?.category_name_fr ?? null,
      category_icon: category?.category_icon ?? null,
      category_color: category?.category_color ?? null,
      parent_category_name: category?.parent_category_name ?? null,
      parent_category_name_en: category?.parent_category_name_en ?? null,
      parent_category_name_fr: category?.parent_category_name_fr ?? null,
    });
  }

  patterns.sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0));

  return { patterns, meta };
}

module.exports = {
  analyzeRecurringPatterns,
  normalizePatternKey,
  selectDominantCluster,
};
