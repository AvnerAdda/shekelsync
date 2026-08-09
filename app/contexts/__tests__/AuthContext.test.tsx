import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '../AuthContext';

const loadStoredSession = vi.fn();
const persistSession = vi.fn();
const clearStoredSession = vi.fn();
let sessionChangeListener: ((session: unknown) => void) | null = null;
const subscribeToSessionChanges = vi.fn((listener: (session: unknown) => void) => {
  sessionChangeListener = listener;
  return () => {};
});

vi.mock('@/lib/session-store', () => ({
  getSession: (...args: unknown[]) => loadStoredSession(...args),
  setSession: (...args: unknown[]) => persistSession(...args),
  clearSession: (...args: unknown[]) => clearStoredSession(...args),
  subscribeToSessionChanges: (...args: unknown[]) => subscribeToSessionChanges(...args),
}));

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('AuthContext', () => {
  beforeEach(() => {
    loadStoredSession.mockReset();
    persistSession.mockReset();
    clearStoredSession.mockReset();
    subscribeToSessionChanges.mockClear();
    sessionChangeListener = null;
  });

  it('keeps a persisted-session load failure explicit until a retry succeeds', async () => {
    loadStoredSession.mockRejectedValueOnce(new Error('Keychain session decrypt failed'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
    expect(result.current.sessionLoadError).toMatchObject({
      message: 'Keychain session decrypt failed',
    });

    act(() => {
      sessionChangeListener?.(null);
    });
    expect(result.current.sessionLoadError).toMatchObject({
      message: 'Keychain session decrypt failed',
    });

    const recoveredSession = {
      accessToken: 'test-token',
      user: { email: 'user@example.com', name: 'Test User' },
    };
    loadStoredSession.mockResolvedValueOnce(recoveredSession);

    await act(async () => {
      await result.current.refreshSession();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.sessionLoadError).toBeNull();
    expect(result.current.session).toEqual(recoveredSession);
  });
});
