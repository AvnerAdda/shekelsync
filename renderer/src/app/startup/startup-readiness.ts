export const STARTUP_READY_EVENT = 'shekelsync:startup-ready';

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function removeStartupShell(): void {
  if (typeof document === 'undefined') return;

  const startupShell = document.getElementById('startup-shell');
  if (!startupShell) return;

  const remove = () => startupShell.remove();
  startupShell.addEventListener('transitionend', remove, { once: true });
  window.setTimeout(remove, 260);
}

/**
 * Completes the native HTML startup shell once the first usable application
 * screen has rendered. This is intentionally separate from React mounting:
 * providers and the local API may still be resolving at that point.
 */
export function signalStartupReady(): void {
  if (typeof document === 'undefined' || document.body.dataset.appReady === 'true') return;

  document.body.dataset.appReady = 'true';
  removeStartupShell();
  window.dispatchEvent(new Event(STARTUP_READY_EVENT));
}

export function onStartupReady(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  if (document.body.dataset.appReady === 'true') {
    const timeoutId = window.setTimeout(callback, 0);
    return () => window.clearTimeout(timeoutId);
  }

  const handleReady = () => callback();
  window.addEventListener(STARTUP_READY_EVENT, handleReady, { once: true });
  return () => window.removeEventListener(STARTUP_READY_EVENT, handleReady);
}

/** Schedule non-critical feature work without competing with the first paint. */
export function scheduleStartupIdleWork(
  callback: () => void,
  options: { timeoutMs?: number; fallbackDelayMs?: number } = {},
): () => void {
  if (typeof window === 'undefined') return () => {};

  const idleWindow = window as IdleWindow;
  const timeoutMs = options.timeoutMs ?? 4_000;
  const fallbackDelayMs = options.fallbackDelayMs ?? 600;
  let cancelled = false;
  let idleHandle: number | null = null;
  let kickoffHandle: number | null = null;

  const run = () => {
    if (cancelled) return;
    callback();
  };

  kickoffHandle = window.setTimeout(() => {
    kickoffHandle = null;
    if (cancelled) return;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleHandle = idleWindow.requestIdleCallback(run, { timeout: timeoutMs });
    } else {
      run();
    }
  }, fallbackDelayMs);

  return () => {
    cancelled = true;
    if (idleHandle !== null && typeof idleWindow.cancelIdleCallback === 'function') {
      idleWindow.cancelIdleCallback(idleHandle);
    }
    if (kickoffHandle !== null) window.clearTimeout(kickoffHandle);
  };
}
