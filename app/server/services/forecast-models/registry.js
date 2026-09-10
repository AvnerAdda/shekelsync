const patternV1 = require('./pattern.js');

const MODELS = Object.freeze({
  'pattern-v2': patternV1,
});

const DEFAULT_ACTIVE_MODEL = 'pattern-v2';
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

module.exports = {
  DEFAULT_ACTIVE_MODEL,
  MODELS,
  getModel,
  listModelIds,
  normalizeModelId,
  resolveActiveModelId,
};
