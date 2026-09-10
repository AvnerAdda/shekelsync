import { afterEach, describe, expect, it } from 'vitest';
const registry = require('../registry.js');
const originalActive = process.env.FORECAST_ACTIVE_MODEL;
afterEach(() => {
  if (originalActive === undefined) delete process.env.FORECAST_ACTIVE_MODEL;
  else process.env.FORECAST_ACTIVE_MODEL = originalActive;
});
describe('forecast model registry', () => {
  it('only exposes the supported pattern model', () => {
    expect(registry.listModelIds()).toEqual(['pattern-v2']);
    expect(registry.resolveActiveModelId()).toBe('pattern-v2');
    expect(registry.normalizeModelId('unknown-model')).toBeNull();
    expect(() => registry.getModel('unknown-model')).toThrow(/Unknown forecast model/);
  });
  it('ignores a retired or invalid model selection', () => {
    process.env.FORECAST_ACTIVE_MODEL = 'retired-model';
    expect(registry.resolveActiveModelId({ modelId: 'retired-model' })).toBe('pattern-v2');
  });
});
