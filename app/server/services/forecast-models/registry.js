const patternV1 = require('./pattern-v1.js');
const ensembleV1 = require('./ensemble-v1.js');

const MODELS = Object.freeze({
  'pattern-v1': patternV1,
  'ensemble-v1': ensembleV1,
});

const DEFAULT_ACTIVE_MODEL = 'pattern-v1';
const DEFAULT_SHADOW_MODELS = 'ensemble-v1';
const DEFAULT_COMPARE_MODE = 'shadow';

function normalizeModelId(value) {
  const modelId = String(value || '').trim();
  if (!modelId || !MODELS[modelId]) return null;
  return modelId;
}

function resolveActiveModelId(options = {}) {
  const fromOptions = normalizeModelId(options.modelId);
  if (fromOptions) return fromOptions;
  return normalizeModelId(process.env.FORECAST_ACTIVE_MODEL) || DEFAULT_ACTIVE_MODEL;
}

function resolveCompareMode() {
  const mode = String(process.env.FORECAST_COMPARE_MODE || DEFAULT_COMPARE_MODE).trim().toLowerCase();
  return mode === 'active-only' ? 'active-only' : 'shadow';
}

function resolveShadowModelIds(options = {}) {
  if (options.shadowRun === true) return [];
  if (resolveCompareMode() === 'active-only') return [];
  if (Array.isArray(options.shadowModels)) {
    return options.shadowModels.map(normalizeModelId).filter(Boolean);
  }
  const raw = process.env.FORECAST_SHADOW_MODELS ?? DEFAULT_SHADOW_MODELS;
  return raw
    .split(',')
    .map((entry) => normalizeModelId(entry))
    .filter(Boolean);
}

function listModelIds() {
  return Object.keys(MODELS);
}

function getModel(modelId) {
  const normalized = normalizeModelId(modelId);
  if (!normalized) {
    throw new Error(`Unknown forecast model: ${modelId}`);
  }
  return MODELS[normalized];
}

function __resetForTests(overrides = {}) {
  if (overrides.FORECAST_ACTIVE_MODEL !== undefined) {
    process.env.FORECAST_ACTIVE_MODEL = overrides.FORECAST_ACTIVE_MODEL;
  }
  if (overrides.FORECAST_SHADOW_MODELS !== undefined) {
    process.env.FORECAST_SHADOW_MODELS = overrides.FORECAST_SHADOW_MODELS;
  }
  if (overrides.FORECAST_COMPARE_MODE !== undefined) {
    process.env.FORECAST_COMPARE_MODE = overrides.FORECAST_COMPARE_MODE;
  }
}

module.exports = {
  DEFAULT_ACTIVE_MODEL,
  DEFAULT_COMPARE_MODE,
  DEFAULT_SHADOW_MODELS,
  MODELS,
  getModel,
  listModelIds,
  normalizeModelId,
  resolveActiveModelId,
  resolveCompareMode,
  resolveShadowModelIds,
  __resetForTests,
};
