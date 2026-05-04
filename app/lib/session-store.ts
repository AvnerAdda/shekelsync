const SESSION_EVENT_NAME = 'authSessionChanged';
const STORAGE_KEY = 'clarify.auth.session';
const BOOTSTRAP_SESSION_KEY = '__SHEKELSYNC_SESSION_BOOTSTRAP__';
const MEMORY_SESSION_KEY = '__SHEKELSYNC_AUTH_SESSION__';

const isRenderer = typeof window !== 'undefined';

export type AuthSession = globalThis.AuthSession;

type SessionListener = (session: AuthSession | null) => void;
type SessionWindow = Window &
  typeof globalThis & {
    [BOOTSTRAP_SESSION_KEY]?: AuthSession | null;
    [MEMORY_SESSION_KEY]?: AuthSession | null;
  };

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

function getSessionWindow(): SessionWindow | null {
  if (!isRenderer) {
    return null;
  }
  return window as SessionWindow;
}

function removeLegacyLocalStorageSession() {
  if (!isRenderer || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('[session-store] Failed to clear legacy session from localStorage:', error);
  }
}

function consumeLegacyLocalStorageSession(): AuthSession | null {
  if (!isRenderer || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as AuthSession;
    window.localStorage.removeItem(STORAGE_KEY);
    return parsed;
  } catch (error) {
    console.warn('[session-store] Failed to parse session from localStorage:', error);
    removeLegacyLocalStorageSession();
    return null;
  }
}

function readFallbackSession(): AuthSession | null {
  const sessionWindow = getSessionWindow();
  if (!sessionWindow) {
    return null;
  }

  const memorySession = sessionWindow[MEMORY_SESSION_KEY];
  if (memorySession && typeof memorySession === 'object') {
    return memorySession;
  }

  const bootstrapSession = sessionWindow[BOOTSTRAP_SESSION_KEY];
  if (bootstrapSession && typeof bootstrapSession === 'object') {
    sessionWindow[MEMORY_SESSION_KEY] = bootstrapSession;
    return bootstrapSession;
  }

  const migratedSession = consumeLegacyLocalStorageSession();
  if (migratedSession) {
    sessionWindow[MEMORY_SESSION_KEY] = migratedSession;
  }

  return migratedSession;
}

function writeFallbackSession(session: AuthSession | null) {
  const sessionWindow = getSessionWindow();
  if (!sessionWindow) {
    return;
  }

  sessionWindow[MEMORY_SESSION_KEY] = session;
  if (session === null) {
    delete sessionWindow[BOOTSTRAP_SESSION_KEY];
  }

  removeLegacyLocalStorageSession();
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
        writeFallbackSession(session);
        return session;
      }
      console.warn('[session-store] getSession failed:', result.error);
    } catch (error) {
      console.warn('[session-store] getSession threw:', error);
    }
    // fall through to in-memory fallback
  }
  return readFallbackSession();
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
      writeFallbackSession(hydrated);
      emitLocalSessionChange(hydrated);
      return hydrated;
    } catch (error) {
      console.warn('[session-store] setSession failed, falling back to memory:', error);
    }
  }

  writeFallbackSession(session);
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
      writeFallbackSession(null);
      emitLocalSessionChange(null);
      return;
    } catch (error) {
      console.warn('[session-store] clearSession failed, falling back to memory:', error);
    }
  }

  writeFallbackSession(null);
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
