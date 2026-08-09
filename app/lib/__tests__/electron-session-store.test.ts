import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createRequire } from 'module';

type LoadMode = 'available' | 'error' | 'missing';

type LoadOptions = {
  mode: LoadMode;
  deleteFailure?: boolean;
  keytarDisabledByEnv?: boolean;
  packaged?: boolean;
  platform?: NodeJS.Platform;
  legacyPayload?: string;
  scopedPayload?: string;
  keytarReadError?: 'scoped' | 'legacy';
  renameFailureOnce?: 'scoped' | 'authority';
  readFailure?: 'scoped' | 'legacy' | 'marker' | 'settings';
};

const repoRoot = path.resolve(process.cwd(), '..');
const sessionStorePath = path.join(repoRoot, 'electron', 'session-store.js');
const encryptionModulePath = path.join(process.cwd(), 'lib', 'server', 'encryption.js');
const appKeytarPath = path.join(process.cwd(), 'node_modules', 'keytar');

async function loadSessionStore(options: LoadOptions) {
  vi.resetModules();
  vi.clearAllMocks();

  const originalKeytarDisable = process.env.KEYTAR_DISABLE;
  const originalDbusAddress = process.env.DBUS_SESSION_BUS_ADDRESS;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  if (options.keytarDisabledByEnv) {
    process.env.KEYTAR_DISABLE = 'true';
  } else {
    delete process.env.KEYTAR_DISABLE;
    delete process.env.DBUS_SESSION_BUS_ADDRESS;
  }
  if (options.platform && originalPlatform) {
    Object.defineProperty(process, 'platform', {
      ...originalPlatform,
      value: options.platform,
    });
  }

  const fsState = new Map<string, string>();
  let renameFailurePending = Boolean(options.renameFailureOnce);

  const mkdir = vi.fn(async () => {});
  const writeFile = vi.fn(async (file: string, contents: string) => {
    fsState.set(file, contents);
  });
  const readFile = vi.fn(async (file: string) => {
    const shouldFail =
      (options.readFailure === 'scoped' && file.endsWith('session.production.enc')) ||
      (options.readFailure === 'legacy' && file.endsWith('/session.enc')) ||
      (options.readFailure === 'marker' && file.endsWith('.legacy-session-ignored')) ||
      (options.readFailure === 'settings' && file.endsWith('/settings.json'));
    if (shouldFail) {
      const error: NodeJS.ErrnoException = new Error('Permission denied');
      error.code = 'EACCES';
      throw error;
    }
    if (!fsState.has(file)) {
      const error: NodeJS.ErrnoException = new Error('Missing file');
      error.code = 'ENOENT';
      throw error;
    }
    return fsState.get(file) ?? '';
  });
  const unlink = vi.fn(async (file: string) => {
    if (!fsState.delete(file)) {
      const error: NodeJS.ErrnoException = new Error('Missing file');
      error.code = 'ENOENT';
      throw error;
    }
  });
  const rename = vi.fn(async (source: string, destination: string) => {
    const shouldFailOnce =
      renameFailurePending &&
      ((options.renameFailureOnce === 'scoped' && destination.endsWith('session.production.enc')) ||
        (options.renameFailureOnce === 'authority' &&
          destination.endsWith('.session-file-authoritative')));
    if (shouldFailOnce) {
      renameFailurePending = false;
      const error: NodeJS.ErrnoException = new Error('Rename failed');
      error.code = 'EIO';
      throw error;
    }
    if (!fsState.has(source)) {
      const error: NodeJS.ErrnoException = new Error('Missing file');
      error.code = 'ENOENT';
      throw error;
    }
    fsState.set(destination, fsState.get(source) ?? '');
    fsState.delete(source);
  });
  const sync = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const open = vi.fn(async () => ({ sync, close }));
  const statSync = vi.fn((file: string) => {
    if (fsState.has(file)) return { isFile: () => true };
    const error: NodeJS.ErrnoException = new Error('Missing file');
    error.code = 'ENOENT';
    throw error;
  });

  const fsExports = {
    existsSync: (file: string) => fsState.has(file),
    statSync,
    promises: { mkdir, open, readFile, rename, unlink, writeFile },
  };

  const getPath = vi.fn(() => '/tmp/electron-test-user');
  const electronExports = {
    app: { getPath, isPackaged: options.packaged ?? true },
  };

  const encrypt = vi.fn((value: string) => `enc:${value}`);
  const decrypt = vi.fn((value: string | null) => {
    if (!value) return null;
    return value.startsWith('enc:') ? value.slice(4) : value;
  });
  const encryptionExports = {
    encrypt,
    decrypt,
  };

  let keytarMock:
    | {
        setPassword: ReturnType<typeof vi.fn>;
        getPassword: ReturnType<typeof vi.fn>;
        deletePassword: ReturnType<typeof vi.fn>;
      }
    | null = null;

  if (options.mode !== 'missing') {
    keytarMock = {
      setPassword: vi.fn(async () => {
        if (options.mode === 'error') {
          throw new Error('set failed');
        }
      }),
      getPassword: vi.fn(async (_service: string, account: string) => {
        if (
          (options.keytarReadError === 'scoped' && account.startsWith('auth-session:')) ||
          (options.keytarReadError === 'legacy' && account === 'auth-session')
        ) {
          throw new Error('read failed');
        }
        return account === 'auth-session'
          ? (options.legacyPayload ?? null)
          : (options.scopedPayload ?? null);
      }),
      deletePassword: vi.fn(async () => {
        if (options.deleteFailure) {
          throw new Error('delete failed');
        }
      }),
    };
  }

  const requireModule = createRequire(import.meta.url);
  const Module = requireModule('module');
  const originalLoad = Module._load;

  const pathsModulePath = requireModule.resolve(path.join(repoRoot, 'electron', 'paths.js'));

  const pathsModule = {
    requireFromApp: (moduleName: string) => {
      if (moduleName === 'keytar') {
        if (keytarMock) {
          return keytarMock;
        }
        const err: NodeJS.ErrnoException = new Error('module not found');
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }
      return requireModule(moduleName);
    },
    resolveAppPath: (...segments: string[]) => path.join(repoRoot, 'app', ...segments),
  };

  Module._load = function patched(request: string, parent: any, isMain: boolean) {
    if (request === 'electron') {
      return electronExports;
    }

    if (request === 'fs') {
      return fsExports;
    }

    if (request === encryptionModulePath) {
      return encryptionExports;
    }

    if (
      request === './paths' ||
      request === path.join('..', 'electron', 'paths.js') ||
      request === pathsModulePath
    ) {
      return pathsModule;
    }

    if (request === appKeytarPath || request === 'keytar') {
      if (keytarMock) {
        return keytarMock;
      }
      const err: NodeJS.ErrnoException = new Error('module not found');
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }

    return originalLoad(request, parent, isMain);
  };

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const resolvedPath = requireModule.resolve(sessionStorePath);
  delete requireModule.cache?.[resolvedPath];

  let sessionStore: any;
  try {
    sessionStore = requireModule(resolvedPath);
  } finally {
    Module._load = originalLoad;
    if (originalKeytarDisable === undefined) {
      delete process.env.KEYTAR_DISABLE;
    } else {
      process.env.KEYTAR_DISABLE = originalKeytarDisable;
    }
    if (originalDbusAddress === undefined) {
      delete process.env.DBUS_SESSION_BUS_ADDRESS;
    } else {
      process.env.DBUS_SESSION_BUS_ADDRESS = originalDbusAddress;
    }
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  }

  return {
    sessionStore,
    mocks: {
      fs: { mkdir, open, readFile, rename, statSync, sync, close, unlink, writeFile, state: fsState },
      keytar: keytarMock,
      encrypt,
      decrypt,
      warnSpy,
      getPath,
    },
  };
}

describe('electron session store', () => {
  beforeEach(() => {
    process.env.ALLOW_DEV_NO_ENCRYPTION = 'true';
  });

  it('persists sessions to keytar when available', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'available' });
    const { keytar, fs, warnSpy } = mocks;

    await sessionStore.storeSession({ token: 'abc' });

    expect(keytar?.setPassword).toHaveBeenCalledTimes(1);
    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringMatching(/session\.production\.enc\..+\.tmp$/),
      expect.stringContaining('session.production.enc'),
    );
    expect(fs.sync).toHaveBeenCalled();
    expect(keytar?.setPassword).toHaveBeenCalledWith(
      'ShekelSync',
      'auth-session:production',
      expect.any(String),
    );

    const cached = await sessionStore.getSession();
    expect(cached).toEqual({ token: 'abc' });

    warnSpy.mockRestore();
  });

  it('falls back to encrypted file store when keytar write fails', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'error' });
    const { keytar, fs, warnSpy } = mocks;

    await sessionStore.storeSession({ token: 'fail-me' });

    expect(keytar?.setPassword).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);

    sessionStore.cache = null;
    const loaded = await sessionStore.load();
    expect(loaded).toEqual({ token: 'fail-me' });

    warnSpy.mockRestore();
  });

  it('uses file-based storage when keytar is unavailable', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'missing' });
    const { fs, warnSpy } = mocks;

    await sessionStore.storeSession({ token: 'offline' });
    expect(fs.writeFile).toHaveBeenCalledTimes(2);

    sessionStore.cache = null;
    const loaded = await sessionStore.load();
    expect(loaded).toEqual({ token: 'offline' });

    await sessionStore.clearSession();
    fs.state.set(sessionStore.getLegacyFilePath(), 'enc:{"token":"rewritten-by-old-build"}');
    sessionStore.cache = null;
    expect(await sessionStore.getSession()).toBeNull();

    warnSpy.mockRestore();
  });

  it('refuses stale keychain fallback when an authoritative scoped file disappears', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'available' });
    const { fs, warnSpy } = mocks;
    await sessionStore.storeSession({ token: 'new' });
    fs.state.delete(sessionStore.getFilePath());
    sessionStore.cache = null;

    await expect(sessionStore.getSession()).rejects.toThrow('authoritative scoped session file');

    warnSpy.mockRestore();
  });

  it('promotes a validated scoped Keychain session to the authoritative file before returning', async () => {
    const encryptedPayload = 'enc:{"token":"scoped-keychain"}';
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'available',
      scopedPayload: encryptedPayload,
    });
    const { fs, keytar, warnSpy } = mocks;

    expect(await sessionStore.getSession()).toEqual({ token: 'scoped-keychain' });
    expect(fs.state.get(sessionStore.getFilePath())).toBe(encryptedPayload);
    expect(fs.state.get(sessionStore.getAuthorityMarkerPath())).toBe('1');
    expect(fs.rename.mock.calls.slice(0, 2).map(([, destination]) => destination)).toEqual([
      sessionStore.getFilePath(),
      sessionStore.getAuthorityMarkerPath(),
    ]);
    expect(keytar?.setPassword).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('retries scoped Keychain promotion when the authoritative file install fails', async () => {
    const encryptedPayload = 'enc:{"token":"retry-scoped"}';
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'available',
      scopedPayload: encryptedPayload,
      renameFailureOnce: 'scoped',
    });
    const { fs, keytar, warnSpy } = mocks;

    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'session_migration_failed',
    });
    expect(sessionStore.cache).toBeNull();
    expect(fs.state.has(sessionStore.getFilePath())).toBe(false);
    expect(fs.state.has(sessionStore.getAuthorityMarkerPath())).toBe(false);

    expect(await sessionStore.getSession()).toEqual({ token: 'retry-scoped' });
    expect(keytar?.getPassword).toHaveBeenCalledTimes(2);
    expect(fs.state.get(sessionStore.getFilePath())).toBe(encryptedPayload);
    expect(fs.state.get(sessionStore.getAuthorityMarkerPath())).toBe('1');

    warnSpy.mockRestore();
  });

  it('repairs an interrupted scoped Keychain authority-marker promotion after validation', async () => {
    const encryptedPayload = 'enc:{"token":"repair-marker"}';
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'available',
      scopedPayload: encryptedPayload,
      renameFailureOnce: 'authority',
    });
    const { fs, keytar, warnSpy } = mocks;

    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'session_migration_failed',
    });
    expect(sessionStore.cache).toBeNull();
    expect(fs.state.get(sessionStore.getFilePath())).toBe(encryptedPayload);
    expect(fs.state.has(sessionStore.getAuthorityMarkerPath())).toBe(false);

    expect(await sessionStore.getSession()).toEqual({ token: 'repair-marker' });
    expect(keytar?.getPassword).toHaveBeenCalledTimes(1);
    expect(fs.state.get(sessionStore.getAuthorityMarkerPath())).toBe('1');

    warnSpy.mockRestore();
  });

  it('merges settings updates and caches them', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'missing' });
    const { fs, warnSpy } = mocks;

    await sessionStore.updateSettings({ theme: 'dark', language: 'he' });
    expect(fs.writeFile).toHaveBeenCalledTimes(1);

    fs.writeFile.mockClear();
    const merged = await sessionStore.updateSettings({ language: 'fr' });
    expect(merged).toEqual({ theme: 'dark', language: 'fr' });
    expect(fs.writeFile).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('migrates a validated legacy file without overwriting it', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'available' });
    const { keytar, fs, warnSpy } = mocks;

    const encryptedPayload = 'enc:{"token":"legacy"}';
    fs.state.set(sessionStore.getLegacyFilePath(), encryptedPayload);

    const session = await sessionStore.getSession();
    expect(session).toEqual({ token: 'legacy' });
    expect(keytar?.getPassword).toHaveBeenCalledTimes(2);
    expect(keytar?.setPassword).toHaveBeenCalledWith(
      'ShekelSync',
      'auth-session:production',
      encryptedPayload,
    );
    expect(fs.state.get(sessionStore.getLegacyFilePath())).toBe(encryptedPayload);
    expect(fs.state.get(sessionStore.getFilePath())).toBe(encryptedPayload);

    warnSpy.mockRestore();
  });

  it('persists an authoritative tombstone when the keytar mirror fails', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'error' });
    const { fs, warnSpy } = mocks;

    await sessionStore.storeSession({ token: 'abc' });
    await sessionStore.clearSession();
    sessionStore.cache = null;

    expect(await sessionStore.getSession()).toBeNull();
    expect(fs.state.get(sessionStore.getFilePath())).toContain('__shekelsyncSessionCleared');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist session tombstone to keytar:'),
      expect.anything(),
    );

    warnSpy.mockRestore();
  });

  it('keeps development away from production legacy session files', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'available', packaged: false });
    const { keytar, fs, warnSpy } = mocks;
    fs.state.set(sessionStore.getLegacyFilePath(), 'enc:{"token":"production"}');

    expect(sessionStore.getFilePath()).toContain('session.development.enc');
    expect(await sessionStore.getSession()).toBeNull();
    expect(keytar?.setPassword).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('migrates a validated production legacy keychain session once', async () => {
    const encryptedPayload = 'enc:{"token":"legacy-keychain"}';
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'available',
      legacyPayload: encryptedPayload,
    });
    const { keytar, fs, warnSpy } = mocks;
    fs.state.set('/tmp/electron-test-user/config.enc', 'upgrade-evidence');

    expect(await sessionStore.getSession()).toEqual({ token: 'legacy-keychain' });
    expect(keytar?.setPassword).toHaveBeenCalledWith(
      'ShekelSync',
      'auth-session:production',
      encryptedPayload,
    );
    expect(fs.state.get(sessionStore.getFilePath())).toBe(encryptedPayload);

    warnSpy.mockRestore();
  });

  it('prefers a valid legacy Keychain session over a divergent legacy fallback file', async () => {
    const keychainPayload = 'enc:{"token":"keychain-primary"}';
    const filePayload = 'enc:{"token":"stale-file"}';
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'available',
      legacyPayload: keychainPayload,
    });
    const { fs, warnSpy } = mocks;
    fs.state.set(sessionStore.getLegacyFilePath(), filePayload);

    expect(await sessionStore.getSession()).toEqual({ token: 'keychain-primary' });
    expect(fs.state.get(sessionStore.getFilePath())).toBe(keychainPayload);

    warnSpy.mockRestore();
  });

  it('does not fall back to a legacy file after a legacy Keychain read error', async () => {
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'available',
      keytarReadError: 'legacy',
    });
    const { fs, warnSpy } = mocks;
    fs.state.set(sessionStore.getLegacyFilePath(), 'enc:{"token":"stale-file"}');

    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'legacy_session_keychain_read_failed',
    });
    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'legacy_session_keychain_read_failed',
    });

    warnSpy.mockRestore();
  });

  it('does not consume a macOS legacy file when the Keychain backend is unavailable', async () => {
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'missing',
      platform: 'darwin',
    });
    const { decrypt, fs, warnSpy } = mocks;
    fs.state.set(sessionStore.getLegacyFilePath(), 'enc:{"token":"possibly-stale"}');

    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'legacy_session_keychain_unavailable',
    });
    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'legacy_session_keychain_unavailable',
    });
    expect(decrypt).not.toHaveBeenCalled();
    expect(fs.state.has(sessionStore.getFilePath())).toBe(false);
    expect(fs.state.has(sessionStore.getAuthorityMarkerPath())).toBe(false);

    warnSpy.mockRestore();
  });

  it('does not report a macOS local install as logged out when Keychain is unavailable', async () => {
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'missing',
      platform: 'darwin',
    });
    const { decrypt, fs, warnSpy } = mocks;
    fs.state.set('/tmp/electron-test-user/config.enc', 'local-install-evidence');

    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'legacy_session_keychain_unavailable',
    });
    expect(decrypt).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalledWith(sessionStore.getLegacyFilePath(), 'utf8');

    warnSpy.mockRestore();
  });

  it('accepts macOS legacy-file recovery when file-only mode was explicitly configured', async () => {
    const encryptedPayload = 'enc:{"token":"file-only"}';
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'missing',
      platform: 'darwin',
      keytarDisabledByEnv: true,
    });
    const { fs, warnSpy } = mocks;
    fs.state.set(sessionStore.getLegacyFilePath(), encryptedPayload);

    expect(await sessionStore.getSession()).toEqual({ token: 'file-only' });
    expect(fs.state.get(sessionStore.getFilePath())).toBe(encryptedPayload);
    expect(fs.state.get(sessionStore.getAuthorityMarkerPath())).toBe('1');

    warnSpy.mockRestore();
  });

  it('does not fall back after a scoped file read error', async () => {
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'available',
      readFailure: 'scoped',
    });
    const { keytar, fs, warnSpy } = mocks;
    fs.state.set(sessionStore.getFilePath(), 'enc:{"token":"unreadable"}');

    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'session_store_unreadable',
    });
    expect(keytar?.getPassword).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('does not fall back to legacy storage after a scoped Keychain read error', async () => {
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'available',
      keytarReadError: 'scoped',
    });
    const { fs, warnSpy } = mocks;
    fs.state.set(sessionStore.getLegacyFilePath(), 'enc:{"token":"legacy"}');

    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'session_keychain_read_failed',
    });
    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'session_keychain_read_failed',
    });

    warnSpy.mockRestore();
  });

  it('does not treat an unreadable legacy fallback file as absent', async () => {
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'missing',
      keytarDisabledByEnv: true,
      platform: 'darwin',
      readFailure: 'legacy',
    });
    const { fs, warnSpy } = mocks;
    fs.state.set(sessionStore.getLegacyFilePath(), 'enc:{"token":"legacy"}');

    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'legacy_session_store_unreadable',
    });

    warnSpy.mockRestore();
  });

  it('keeps an undecryptable legacy session retryable without writing an ignore marker', async () => {
    const { sessionStore, mocks } = await loadSessionStore({
      mode: 'missing',
      keytarDisabledByEnv: true,
      platform: 'darwin',
    });
    const { fs, warnSpy } = mocks;
    fs.state.set(sessionStore.getLegacyFilePath(), 'not-json');

    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'session_decrypt_failed',
    });
    expect(fs.state.has(sessionStore.getLegacyMarkerPath())).toBe(false);

    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'session_decrypt_failed',
    });
    warnSpy.mockRestore();
  });

  it('propagates validated legacy migration failures without marking legacy ignored', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'error' });
    const { fs, warnSpy } = mocks;
    fs.state.set(sessionStore.getLegacyFilePath(), 'enc:{"token":"legacy"}');

    await expect(sessionStore.getSession()).rejects.toMatchObject({
      code: 'session_migration_failed',
    });
    expect(fs.state.has(sessionStore.getLegacyMarkerPath())).toBe(false);

    warnSpy.mockRestore();
  });

  it('fails closed when existing auth settings are malformed', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'missing' });
    const { fs, warnSpy } = mocks;
    fs.state.set(sessionStore.getSettingsFilePath(), 'not-json');

    await expect(sessionStore.updateSettings({ language: 'fr' })).rejects.toMatchObject({
      code: 'auth_settings_unreadable',
    });
    expect(fs.rename).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
