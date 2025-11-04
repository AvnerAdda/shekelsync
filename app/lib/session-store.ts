const SESSION_EVENT_NAME = 'authSessionChanged';
const STORAGE_KEY = 'clarify.auth.session';

const isRenderer = typeof window !== 'undefined';

export type AuthSession = globalThis.AuthSession;

type SessionListener = (session: AuthSession | null) => void;

function getElectronAuthBridge() {
  if (!isRenderer) {
    return undefined;
  }
  return window.electronAPI?.auth;
}

function getElectronEventsBridge() {
  if (!isRenderer) {
    return undefined;
  }
  return window.electronAPI?.events;
}

function readFromLocalStorage(): AuthSession | null {
  if (!isRenderer || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as AuthSession;
  } catch (error) {
    console.warn('[session-store] Failed to parse session from localStorage:', error);
    return null;
  }
}

function writeToLocalStorage(session: AuthSession | null) {
  if (!isRenderer || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    if (session) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {
    console.warn('[session-store] Failed to persist session to localStorage:', error);
  }
}

function emitLocalSessionChange(session: AuthSession | null) {
  if (!isRenderer || typeof window.dispatchEvent !== 'function') {
    return;
  }
  const event = new CustomEvent<AuthSession | null>(SESSION_EVENT_NAME, {
    detail: session,
  });
  window.dispatchEvent(event);
}

export async function getSession(): Promise<AuthSession | null> {
  const authBridge = getElectronAuthBridge();
  if (authBridge?.getSession) {
    try {
      const result = await authBridge.getSession();
      if (result.success) {
        const session = (result.session ?? null) as AuthSession | null;
        if (session && typeof session === 'object') {
          writeToLocalStorage(session);
        }
        return session;
      }
      console.warn('[session-store] getSession failed:', result.error);
    } catch (error) {
      console.warn('[session-store] getSession threw:', error);
    }
    // fall through to local storage fallback
  }
  return readFromLocalStorage();
}

export async function setSession(session: AuthSession | null): Promise<AuthSession | null> {
  const authBridge = getElectronAuthBridge();
  if (authBridge?.setSession) {
    try {
      const result = await authBridge.setSession(session);
      if (!result.success) {
        throw new Error(result.error || 'Failed to set session');
      }
      const hydrated = (result.session ?? null) as AuthSession | null;
      writeToLocalStorage(hydrated);
      emitLocalSessionChange(hydrated);
      return hydrated;
    } catch (error) {
      console.warn('[session-store] setSession failed, falling back to localStorage:', error);
    }
  }

  writeToLocalStorage(session);
  emitLocalSessionChange(session);
  return session;
}

export async function clearSession(): Promise<void> {
  const authBridge = getElectronAuthBridge();
  if (authBridge?.clearSession) {
    try {
      const result = await authBridge.clearSession();
      if (!result.success) {
        throw new Error(result.error || 'Failed to clear session');
      }
      writeToLocalStorage(null);
      emitLocalSessionChange(null);
      return;
    } catch (error) {
      console.warn('[session-store] clearSession failed, falling back to localStorage:', error);
    }
  }

  writeToLocalStorage(null);
  emitLocalSessionChange(null);
}

export function subscribeToSessionChanges(listener: SessionListener): () => void {
  const eventsBridge = getElectronEventsBridge();
  if (eventsBridge?.onAuthSessionChanged) {
    const unsubscribe = eventsBridge.onAuthSessionChanged(listener);
    if (typeof unsubscribe === 'function') {
      return unsubscribe;
    }
  }

  if (isRenderer && typeof window.addEventListener === 'function') {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<AuthSession | null>;
      listener(customEvent.detail ?? null);
    };
    window.addEventListener(SESSION_EVENT_NAME, handler);
    return () => window.removeEventListener(SESSION_EVENT_NAME, handler);
  }

  return () => {};
}

export async function getAuthorizationHeader(): Promise<Record<string, string>> {
  const session = await getSession();
  if (!session?.accessToken) {
    return {};
  }

  const tokenType = session.tokenType || 'Bearer';
  return {
    Authorization: `${tokenType} ${session.accessToken}`,
  };
}
