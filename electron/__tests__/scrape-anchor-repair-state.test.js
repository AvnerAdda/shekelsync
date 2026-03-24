import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireModule = createRequire(import.meta.url);
const ModuleLoader = requireModule('module');
const electronTestDir = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.join(electronTestDir, '..', 'scrape-anchor-repair-state.js');

async function loadModule(sessionStoreMock) {
  const originalLoad = ModuleLoader._load;

  ModuleLoader._load = function patched(request, parent, isMain) {
    if (request === './session-store' && parent?.id === modulePath) {
      return sessionStoreMock;
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    delete requireModule.cache[modulePath];
    return requireModule(modulePath);
  } finally {
    ModuleLoader._load = originalLoad;
  }
}

describe('scrape-anchor-repair-state', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes completed credential ids by filtering invalid values and sorting', async () => {
    const module = await loadModule({
      getSettings: vi.fn().mockResolvedValue({}),
      updateSettings: vi.fn(),
    });

    expect(module.normalizeCompletedCredentialIds([7, '3', 7, 'x', 0, null, 12])).toEqual([3, 7, 12]);
    expect(module.normalizeCompletedCredentialIds('invalid')).toEqual([]);
  });

  it('loads persisted ids and appends a new completed credential once', async () => {
    const sessionStoreMock = {
      getSettings: vi.fn().mockResolvedValue({
        locale: 'he',
        dataRepair: {
          scrapeAnchorV1: {
            completedCredentialIds: [12, '3', 12],
          },
        },
      }),
      updateSettings: vi.fn().mockResolvedValue({}),
    };

    const { createScrapeAnchorRepairStateProvider } = await loadModule(sessionStoreMock);
    const provider = createScrapeAnchorRepairStateProvider();

    await expect(provider.getCompletedCredentialIds()).resolves.toEqual([3, 12]);
    await expect(provider.markCredentialRepairComplete('7')).resolves.toBe(true);

    expect(sessionStoreMock.updateSettings).toHaveBeenCalledWith({
      locale: 'he',
      dataRepair: {
        scrapeAnchorV1: {
          completedCredentialIds: [3, 7, 12],
        },
      },
    });
  });

  it('skips invalid or already-completed credentials without writing settings', async () => {
    const sessionStoreMock = {
      getSettings: vi.fn().mockResolvedValue({
        dataRepair: {
          scrapeAnchorV1: {
            completedCredentialIds: [5],
          },
        },
      }),
      updateSettings: vi.fn().mockResolvedValue({}),
    };

    const { createScrapeAnchorRepairStateProvider } = await loadModule(sessionStoreMock);
    const provider = createScrapeAnchorRepairStateProvider();

    await expect(provider.markCredentialRepairComplete(null)).resolves.toBe(false);
    await expect(provider.markCredentialRepairComplete(5)).resolves.toBe(false);
    expect(sessionStoreMock.updateSettings).not.toHaveBeenCalled();
  });
});
