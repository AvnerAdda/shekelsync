import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const module = await import('../user-data-scope.js');
const { configureUserDataScope } = module.default || module;

describe('user data scope', () => {
  it('leaves packaged production userData unchanged', () => {
    const app = {
      isPackaged: true,
      getPath: vi.fn(() => '/Library/Application Support/ShekelSync'),
      setPath: vi.fn(),
    };

    expect(configureUserDataScope(app)).toBe('/Library/Application Support/ShekelSync');
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('assigns unpackaged development a separate stable directory', () => {
    const app = {
      isPackaged: false,
      getPath: vi.fn((name) => name === 'appData' ? '/Library/Application Support' : '/old'),
      setPath: vi.fn(),
    };

    const result = configureUserDataScope(app);

    expect(result).toBe(path.join('/Library/Application Support', 'ShekelSync Development'));
    expect(app.setPath).toHaveBeenCalledWith('userData', result);
  });
});
