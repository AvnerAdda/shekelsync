import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getSession,
  setSession,
  clearSession,
  subscribeToSessionChanges,
  getAuthorizationHeader,
} from '../session-store';

const mockStorage = () => {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => {
      store[key] = val;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((k) => delete store[k]);
    }),
  };
};

describe('session-store', () => {
  const session = { accessToken: 'abc', tokenType: 'Bearer' } as any;

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
  });

  it('returns null when localStorage parsing fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (window as any).localStorage.getItem.mockReturnValue('{"bad json"');
    (window as any).electronAPI = undefined;

    const result = await getSession();

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse session'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('falls back when bridge getSession returns error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (window as any).localStorage.setItem('clarify.auth.session', JSON.stringify(session));
    (window as any).electronAPI = {
      auth: { getSession: vi.fn().mockResolvedValue({ success: false, error: 'nope' }) },
    };

    const result = await getSession();

    expect(result).toEqual(session);
    expect(warnSpy).toHaveBeenCalledWith('[session-store] getSession failed:', 'nope');
    warnSpy.mockRestore();
  });

  it('uses electron auth bridge when available and persists to localStorage', async () => {
    const getSessionMock = vi.fn().mockResolvedValue({ success: true, session });
    (window as any).electronAPI = { auth: { getSession: getSessionMock } };

    const result = await getSession();

    expect(getSessionMock).toHaveBeenCalled();
    expect(result).toEqual(session);
    expect((window as any).localStorage.setItem).toHaveBeenCalled();
  });

  it('falls back to localStorage when bridge is missing', async () => {
    (window as any).electronAPI = undefined;
    window.localStorage.setItem('clarify.auth.session', JSON.stringify(session));

    const result = await getSession();

    expect(result).toEqual(session);
  });

  it('setSession emits update and persists even when bridge fails', async () => {
    const setSessionMock = vi.fn().mockRejectedValue(new Error('no bridge'));
    (window as any).electronAPI = { auth: { setSession: setSessionMock } };
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const result = await setSession(session);

    expect(dispatchSpy).toHaveBeenCalled();
    expect((window as any).localStorage.setItem).toHaveBeenCalled();
    expect(result).toEqual(session);
  });

  it('clearSession clears storage and notifies listeners', async () => {
    const clearMock = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI = { auth: { clearSession: clearMock } };
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    await clearSession();

    expect(clearMock).toHaveBeenCalled();
    expect(window.localStorage.removeItem).toHaveBeenCalledWith('clarify.auth.session');
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
    (window as any).electronAPI = undefined;
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
    (window as any).electronAPI = { auth: { clearSession: vi.fn().mockRejectedValue(new Error('fail')) } };

    await clearSession();

    expect(window.localStorage.removeItem).toHaveBeenCalledWith('clarify.auth.session');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('getAuthorizationHeader returns token header when session exists', async () => {
    (window as any).electronAPI = {
      auth: { getSession: vi.fn().mockResolvedValue({ success: true, session }) },
    };

    const header = await getAuthorizationHeader();
    expect(header).toEqual({ Authorization: 'Bearer abc' });
  });

  it('getAuthorizationHeader returns empty object without token', async () => {
    (window as any).electronAPI = {
      auth: { getSession: vi.fn().mockResolvedValue({ success: true, session: null }) },
    };

    const header = await getAuthorizationHeader();
    expect(header).toEqual({});
  });
});
