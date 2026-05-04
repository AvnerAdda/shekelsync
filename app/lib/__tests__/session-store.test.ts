import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  getAuthorizationHeader,
  getSession,
  setSession,
  subscribeToSessionChanges,
} from '../session-store';

const STORAGE_KEY = 'clarify.auth.session';
const BOOTSTRAP_SESSION_KEY = '__SHEKELSYNC_SESSION_BOOTSTRAP__';
const MEMORY_SESSION_KEY = '__SHEKELSYNC_AUTH_SESSION__';

const mockStorage = () => {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key]);
    }),
  };
};

describe('session-store', () => {
  const session = {
    accessToken: 'abc',
    tokenType: 'Bearer',
    user: { name: 'Demo User' },
  } as any;

  beforeEach(() => {
    (global as any).window = {
      localStorage: mockStorage(),
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      CustomEvent,
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).electronAPI;
    delete (window as any)[BOOTSTRAP_SESSION_KEY];
    delete (window as any)[MEMORY_SESSION_KEY];
  });

  it('returns null and clears legacy storage when localStorage parsing fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.localStorage.setItem(STORAGE_KEY, '{"bad json"');

    const result = await getSession();

    expect(result).toBeNull();
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse session'),
      expect.anything(),
    );
  });

  it('migrates legacy localStorage session into memory when the bridge is missing', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));

    const result = await getSession();

    expect(result).toEqual(session);
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect((window as any)[MEMORY_SESSION_KEY]).toEqual(session);
  });

  it('uses bootstrap session when provided', async () => {
    (window as any)[BOOTSTRAP_SESSION_KEY] = session;

    const result = await getSession();

    expect(result).toEqual(session);
    expect((window as any)[MEMORY_SESSION_KEY]).toEqual(session);
  });

  it('falls back to memory when bridge getSession returns error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (window as any).electronAPI = {
      auth: { getSession: vi.fn().mockResolvedValue({ success: false, error: 'nope' }) },
    };
    (window as any)[BOOTSTRAP_SESSION_KEY] = session;

    const result = await getSession();

    expect(result).toEqual(session);
    expect(warnSpy).toHaveBeenCalledWith('[session-store] getSession failed:', 'nope');
  });

  it('uses electron auth bridge when available and clears legacy storage', async () => {
    const getSessionMock = vi.fn().mockResolvedValue({ success: true, session });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    (window.localStorage.setItem as any).mockClear();
    (window as any).electronAPI = { auth: { getSession: getSessionMock } };

    const result = await getSession();

    expect(getSessionMock).toHaveBeenCalled();
    expect(result).toEqual(session);
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
  });

  it('setSession emits update and stores in memory when bridge fails', async () => {
    const setSessionMock = vi.fn().mockRejectedValue(new Error('no bridge'));
    (window as any).electronAPI = { auth: { setSession: setSessionMock } };
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const result = await setSession(session);

    expect(dispatchSpy).toHaveBeenCalled();
    expect((window as any)[MEMORY_SESSION_KEY]).toEqual(session);
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(result).toEqual(session);
  });

  it('setSession falls back to memory when bridge returns unsuccessful result', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setSessionMock = vi.fn().mockResolvedValue({ success: false, error: 'denied' });
    (window as any).electronAPI = { auth: { setSession: setSessionMock } };

    const result = await setSession(session);

    expect(setSessionMock).toHaveBeenCalledWith(session);
    expect((window as any)[MEMORY_SESSION_KEY]).toEqual(session);
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(result).toEqual(session);
    expect(warnSpy).toHaveBeenCalledWith(
      '[session-store] setSession failed, falling back to memory:',
      expect.any(Error),
    );
  });

  it('clearSession clears memory and notifies listeners', async () => {
    const clearMock = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI = { auth: { clearSession: clearMock } };
    (window as any)[MEMORY_SESSION_KEY] = session;
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    await clearSession();

    expect(clearMock).toHaveBeenCalled();
    expect((window as any)[MEMORY_SESSION_KEY]).toBeNull();
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(dispatchSpy).toHaveBeenCalled();
  });

  it('subscribeToSessionChanges uses electron events bridge when available', () => {
    const unsubscribe = vi.fn();
    const onAuthSessionChanged = vi.fn().mockReturnValue(unsubscribe);
    (window as any).electronAPI = { events: { onAuthSessionChanged } };
    const listener = vi.fn();

    const result = subscribeToSessionChanges(listener);

    expect(onAuthSessionChanged).toHaveBeenCalledWith(listener);
    result();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('subscribeToSessionChanges falls back to window event', () => {
    const listener = vi.fn();
    const remover = subscribeToSessionChanges(listener);
    expect(window.addEventListener).toHaveBeenCalledWith('authSessionChanged', expect.any(Function));

    const [, handler] = (window.addEventListener as any).mock.calls[0];
    handler(new CustomEvent('authSessionChanged', { detail: session }));
    expect(listener).toHaveBeenCalledWith(session);

    remover();
    expect(window.removeEventListener).toHaveBeenCalled();
  });

  it('clearSession falls back when bridge throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (window as any).electronAPI = {
      auth: { clearSession: vi.fn().mockRejectedValue(new Error('fail')) },
    };
    (window as any)[MEMORY_SESSION_KEY] = session;

    await clearSession();

    expect((window as any)[MEMORY_SESSION_KEY]).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('clearSession falls back when bridge returns unsuccessful result', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clearMock = vi.fn().mockResolvedValue({ success: false, error: 'denied' });
    (window as any).electronAPI = { auth: { clearSession: clearMock } };
    (window as any)[MEMORY_SESSION_KEY] = session;

    await clearSession();

    expect(clearMock).toHaveBeenCalled();
    expect((window as any)[MEMORY_SESSION_KEY]).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[session-store] clearSession failed, falling back to memory:',
      expect.any(Error),
    );
  });

  it('subscribeToSessionChanges returns noop when no event target is available', () => {
    (window as any).addEventListener = undefined;
    (window as any).removeEventListener = undefined;

    const unsubscribe = subscribeToSessionChanges(vi.fn());

    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
  });

  it('getAuthorizationHeader returns token header when session exists', async () => {
    (window as any)[BOOTSTRAP_SESSION_KEY] = session;

    const header = await getAuthorizationHeader();

    expect(header).toEqual({ Authorization: 'Bearer abc' });
  });

  it('getAuthorizationHeader returns empty object without token', async () => {
    (window as any)[BOOTSTRAP_SESSION_KEY] = { user: { name: 'Only User' } };

    const header = await getAuthorizationHeader();

    expect(header).toEqual({});
  });
});
