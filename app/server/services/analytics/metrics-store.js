const MAX_SAMPLES = 50;

const state = {
  breakdown: [],
  dashboard: [],
  unifiedCategory: [],
  waterfall: [],
  categoryOpportunities: [],
};

let reporter = null;

function diffInDays(start, end) {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  const diffMs = Math.abs(endDate.getTime() - startDate.getTime());
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function sanitizeMetricSample(sample) {
  if (!sample || typeof sample !== 'object') {
    return {};
  }

  const sanitized = {};

  const duration = Number(sample.durationMs);
  if (Number.isFinite(duration)) {
    sanitized.durationMs = duration;
  }
  const months = Number(sample.months);
  if (Number.isFinite(months)) {
    sanitized.months = months;
  }
  if (typeof sample.type === 'string') {
    sanitized.type = sample.type;
  }
  if (typeof sample.aggregation === 'string') {
    sanitized.aggregation = sample.aggregation;
  }
  if (typeof sample.groupBy === 'string') {
    sanitized.groupBy = sample.groupBy;
  }
  if (typeof sample.includeTransactions === 'boolean') {
    sanitized.includeTransactions = sample.includeTransactions;
  }
  const minTransactions = Number(sample.minTransactions);
  if (Number.isFinite(minTransactions)) {
    sanitized.minTransactions = minTransactions;
  }

  if (sample.dateRange && typeof sample.dateRange === 'object') {
    const currentRange = diffInDays(sample.dateRange.start, sample.dateRange.end);
    const previousRange = diffInDays(sample.dateRange.previousStart, sample.dateRange.previousEnd);
    if (Number.isFinite(currentRange)) {
      sanitized.dateRangeDays = currentRange;
    }
    if (Number.isFinite(previousRange)) {
      sanitized.previousRangeDays = previousRange;
    }
  }

  if (sample.rowCounts && typeof sample.rowCounts === 'object') {
    sanitized.rowCounts = Object.fromEntries(
      Object.entries(sample.rowCounts)
        .filter(([_, value]) => value !== undefined)
        .map(([key, value]) => {
          const numeric = Number(value);
          return [key, Number.isFinite(numeric) ? numeric : null];
        }),
    );
  }

  return sanitized;
}

function recordMetric(bucket, sample) {
  if (!state[bucket]) {
    state[bucket] = [];
  }

  const enrichedSample = {
    ...sample,
    recordedAt: new Date().toISOString(),
  };

  state[bucket].push(enrichedSample);
  if (state[bucket].length > MAX_SAMPLES) {
    state[bucket].splice(0, state[bucket].length - MAX_SAMPLES);
  }

  if (typeof reporter === 'function') {
    try {
      reporter(bucket, sanitizeMetricSample(enrichedSample));
    } catch {
      // Silent failure; telemetry reporters must not break analytics flows
    }
  }
}

const recordBreakdownMetric = (sample) => recordMetric('breakdown', sample);
const recordDashboardMetric = (sample) => recordMetric('dashboard', sample);
const recordUnifiedCategoryMetric = (sample) => recordMetric('unifiedCategory', sample);
const recordWaterfallMetric = (sample) => recordMetric('waterfall', sample);
const recordCategoryOpportunitiesMetric = (sample) => recordMetric('categoryOpportunities', sample);

function getMetricsSnapshot() {
  return {
    breakdown: state.breakdown.slice(),
    dashboard: state.dashboard.slice(),
    unifiedCategory: state.unifiedCategory.slice(),
    waterfall: state.waterfall.slice(),
    categoryOpportunities: state.categoryOpportunities.slice(),
  };
}

function resetMetrics() {
  Object.keys(state).forEach((key) => {
    state[key] = [];
  });
}

function setMetricReporter(callback) {
  reporter = typeof callback === 'function' ? callback : null;
}

module.exports = {
  recordBreakdownMetric,
  recordDashboardMetric,
  recordUnifiedCategoryMetric,
  recordWaterfallMetric,
  recordCategoryOpportunitiesMetric,
  getMetricsSnapshot,
  resetMetrics,
  setMetricReporter,
  sanitizeMetricSample,
};
