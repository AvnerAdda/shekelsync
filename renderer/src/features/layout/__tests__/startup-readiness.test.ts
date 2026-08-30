import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STARTUP_READY_EVENT,
  onStartupReady,
  scheduleStartupIdleWork,
  signalStartupReady,
} from '@renderer/app/startup/startup-readiness';

describe('startup readiness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete document.body.dataset.appReady;
    document.body.innerHTML = '<div id="startup-shell"></div><div id="root"></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    delete document.body.dataset.appReady;
  });

  it('keeps the startup shell until the usable screen signals readiness', () => {
    const readyListener = vi.fn();
    window.addEventListener(STARTUP_READY_EVENT, readyListener, { once: true });

    expect(document.getElementById('startup-shell')).not.toBeNull();
    expect(document.body.dataset.appReady).toBeUndefined();

    signalStartupReady();

    expect(document.body.dataset.appReady).toBe('true');
    expect(readyListener).toHaveBeenCalledOnce();
    expect(document.getElementById('startup-shell')).not.toBeNull();

    vi.advanceTimersByTime(260);
    expect(document.getElementById('startup-shell')).toBeNull();
  });

  it('starts deferred work only after readiness and the idle delay', () => {
    const work = vi.fn();
    let cancelWork = () => {};
    const unsubscribe = onStartupReady(() => {
      cancelWork = scheduleStartupIdleWork(work, { fallbackDelayMs: 300 });
    });

    vi.advanceTimersByTime(1_000);
    expect(work).not.toHaveBeenCalled();

    signalStartupReady();
    vi.advanceTimersByTime(299);
    expect(work).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(work).toHaveBeenCalledOnce();

    unsubscribe();
    cancelWork();
  });
});
