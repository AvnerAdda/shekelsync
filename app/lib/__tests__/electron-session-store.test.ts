import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createRequire } from 'module';

type LoadOptions =
  | { mode: 'available' }
  | { mode: 'error' }
  | { mode: 'missing' };

const repoRoot = path.resolve(process.cwd(), '..');
const sessionStorePath = path.join(repoRoot, 'electron', 'session-store.js');
const encryptionModulePath = path.join(process.cwd(), 'lib', 'server', 'encryption.js');
const appKeytarPath = path.join(process.cwd(), 'node_modules', 'keytar');

async function loadSessionStore(options: LoadOptions) {
  vi.resetModules();
  vi.clearAllMocks();

  const fsState = new Map<string, string>();

  const mkdir = vi.fn(async () => {});
  const writeFile = vi.fn(async (file: string, contents: string) => {
    fsState.set(file, contents);
  });
  const readFile = vi.fn(async (file: string) => {
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

  const fsExports = {
    promises: { mkdir, writeFile, readFile, unlink },
  };

  const getPath = vi.fn(() => '/tmp/electron-test-user');
  const electronExports = {
    app: { getPath },
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

  if (options.mode === 'available' || options.mode === 'error') {
    keytarMock = {
      setPassword: vi.fn(async () => {
        if (options.mode === 'error') {
          throw new Error('set failed');
        }
      }),
      getPassword: vi.fn(async () => null),
      deletePassword: vi.fn(async () => {}),
    };
  }

  const requireModule = createRequire(import.meta.url);
  const Module = requireModule('module');
  const originalLoad = Module._load;

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
  }

  return {
    sessionStore,
    mocks: {
      fs: { mkdir, writeFile, readFile, unlink, state: fsState },
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
    expect(fs.writeFile).not.toHaveBeenCalled();

    const cached = await sessionStore.getSession();
    expect(cached).toEqual({ token: 'abc' });

    warnSpy.mockRestore();
  });

  it('falls back to encrypted file store when keytar write fails', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'error' });
    const { keytar, fs, warnSpy } = mocks;

    await sessionStore.storeSession({ token: 'fail-me' });

    expect(keytar?.setPassword).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);

    sessionStore.cache = null;
    const loaded = await sessionStore.load();
    expect(loaded).toEqual({ token: 'fail-me' });

    warnSpy.mockRestore();
  });

  it('uses file-based storage when keytar is unavailable', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'missing' });
    const { fs, warnSpy } = mocks;

    await sessionStore.storeSession({ token: 'offline' });
    expect(fs.writeFile).toHaveBeenCalledTimes(1);

    sessionStore.cache = null;
    const loaded = await sessionStore.load();
    expect(loaded).toEqual({ token: 'offline' });

    await sessionStore.clearSession();
    expect(fs.unlink).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('merges settings updates and caches them', async () => {
    const { sessionStore, mocks } = await loadSessionStore({ mode: 'missing' });
    const { fs, warnSpy } = mocks;

    await sessionStore.updateSettings({ theme: 'dark', language: 'he' });
    expect(fs.writeFile).toHaveBeenCalledTimes(1);

    fs.writeFile.mockClear();
    const merged = await sessionStore.updateSettings({ language: 'en' });
    expect(merged).toEqual({ theme: 'dark', language: 'en' });
    expect(fs.writeFile).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
