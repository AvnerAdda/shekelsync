import { describe, expect, it, vi } from 'vitest';

import singleInstanceModule from '../single-instance.js';

const { enforceSingleInstance } = singleInstanceModule;

describe('single-instance lifecycle', () => {
  it('quits and prevents readiness initialization when another instance owns the lock', () => {
    const app = {
      requestSingleInstanceLock: vi.fn().mockReturnValue(false),
      quit: vi.fn(),
      on: vi.fn(),
    };

    const hasLock = enforceSingleInstance({
      app,
      onSecondInstance: vi.fn(),
    });

    expect(hasLock).toBe(false);
    expect(app.quit).toHaveBeenCalledOnce();
    expect(app.on).not.toHaveBeenCalled();
  });

  it('registers a second-instance handler that restores the primary window', () => {
    let secondInstanceHandler;
    const app = {
      requestSingleInstanceLock: vi.fn().mockReturnValue(true),
      quit: vi.fn(),
      on: vi.fn((eventName, handler) => {
        if (eventName === 'second-instance') {
          secondInstanceHandler = handler;
        }
      }),
    };
    const onSecondInstance = vi.fn();

    const hasLock = enforceSingleInstance({ app, onSecondInstance });

    expect(hasLock).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.on).toHaveBeenCalledWith('second-instance', expect.any(Function));

    const event = { sender: 'secondary' };
    const commandLine = ['--example'];
    secondInstanceHandler(event, commandLine, '/tmp');
    expect(onSecondInstance).toHaveBeenCalledWith(event, commandLine, '/tmp');
  });
});
