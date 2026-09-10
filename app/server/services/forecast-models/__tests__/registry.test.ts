import { afterEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const registry = require('../registry.js');

describe('forecast model registry', () => {
  const originalActive = process.env.FORECAST_ACTIVE_MODEL;
  const originalShadow = process.env.FORECAST_SHADOW_MODELS;
  const originalCompare = process.env.FORECAST_COMPARE_MODE;

  afterEach(() => {
    process.env.FORECAST_ACTIVE_MODEL = originalActive;
    process.env.FORECAST_SHADOW_MODELS = originalShadow;
    process.env.FORECAST_COMPARE_MODE = originalCompare;
  });

  it('resolves known models and rejects unknown ids', () => {
    expect(registry.resolveActiveModelId()).toBe('pattern-v1');
    expect(registry.resolveActiveModelId({ modelId: 'ensemble-v1' })).toBe('ensemble-v1');
    expect(registry.normalizeModelId('unknown-model')).toBeNull();
    expect(() => registry.getModel('unknown-model')).toThrow(/Unknown forecast model/);
  });

  it('resolves shadow models unless compare mode is active-only', () => {
    process.env.FORECAST_COMPARE_MODE = 'shadow';
    process.env.FORECAST_SHADOW_MODELS = 'ensemble-v1,pattern-v1';
    expect(registry.resolveShadowModelIds()).toEqual(['ensemble-v1', 'pattern-v1']);

    process.env.FORECAST_COMPARE_MODE = 'active-only';
    expect(registry.resolveShadowModelIds()).toEqual([]);
  });
});
