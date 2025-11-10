import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getSession,
  setSession,
  clearSession,
  subscribeToSessionChanges,
  getAuthorizationHeader,
} from '@/lib/session-store';


function resetGlobals() {
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete (window as any).electronAPI;
  delete (window as any).electronAPI;
}

beforeEach(() => {
  resetGlobals();
});

afterEach(() => {
  resetGlobals();
});

describe('session-store (browser fallback)', () => {
  it('persists and retrieves session via localStorage when electron bridge is unavailable', async () => {
    const session = {
      accessToken: 'abc',
      tokenType: 'Bearer',
      user: { id: '123' },
    };

    await setSession(session);
    const stored = await getSession();
    expect(stored).toEqual(session);

    const headers = await getAuthorizationHeader();
    expect(headers).toEqual({ Authorization: 'Bearer abc' });

    await clearSession();
    expect(await getSession()).toBeNull();
  });

  it('emits DOM events for session changes when electron bridge is absent', async () => {
    const listener = vi.fn();
    subscribeToSessionChanges(listener);

    await setSession({ accessToken: 'xyz' });
    expect(listener).toHaveBeenCalledWith({ accessToken: 'xyz' });

    await clearSession();
    expect(listener).toHaveBeenLastCalledWith(null);
  });
});

describe('session-store with electron bridge', () => {
  it('delegates to electron auth bridge and returns sanitized headers', async () => {
    const getSessionMock = vi.fn().mockResolvedValue({ success: true, session: { accessToken: 'token123' } });
    const setSessionMock = vi.fn().mockResolvedValue({ success: true, session: { accessToken: 'token123' } });
    const clearSessionMock = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI = {
      auth: {
        getSession: getSessionMock,
        setSession: setSessionMock,
        clearSession: clearSessionMock,
      },
      events: {
        onAuthSessionChanged: vi.fn(),
      },
    };

    await setSession({ accessToken: 'token123' });
    expect(setSessionMock).toHaveBeenCalledWith({ accessToken: 'token123' });

    const session = await getSession();
    expect(getSessionMock).toHaveBeenCalled();
    expect(session).toEqual({ accessToken: 'token123' });

    const headers = await getAuthorizationHeader();
    expect(headers).toEqual({ Authorization: 'Bearer token123' });

    await clearSession();
    expect(clearSessionMock).toHaveBeenCalled();
  });

  it('subscribes to electron auth events when available', () => {
    const unsubscribe = vi.fn();
    const onAuthSessionChanged = vi.fn().mockReturnValue(unsubscribe);

    (window as any).electronAPI = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ success: true, session: null }),
        setSession: vi.fn().mockResolvedValue({ success: true, session: null }),
        clearSession: vi.fn().mockResolvedValue({ success: true }),
      },
      events: {
        onAuthSessionChanged,
      },
    };

    const listener = vi.fn();
    const dispose = subscribeToSessionChanges(listener);

    expect(onAuthSessionChanged).toHaveBeenCalledTimes(1);
    expect(onAuthSessionChanged.mock.calls[0][0]).toBeInstanceOf(Function);

    dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
