import { afterEach, describe, expect, it, vi } from 'vitest';

const originalUseSqlite = process.env.USE_SQLITE;

afterEach(() => {
  process.env.USE_SQLITE = originalUseSqlite;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('duplicate-patterns service postgres branches', () => {
  it('queries information_schema when sqlite is disabled', async () => {
    process.env.USE_SQLITE = 'false';
    vi.resetModules();

    const module = await import('../duplicate-patterns.js');
    const service = module.default ?? module;

    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    const releaseMock = vi.fn();

    service.__setDatabase({
      getClient: vi.fn().mockResolvedValue({
        query: queryMock,
        release: releaseMock,
      }),
    });

    await service.listPatterns({ includeInactive: true, userDefinedOnly: true });

    expect(String(queryMock.mock.calls[0][0])).toContain('information_schema.tables');
    expect(String(queryMock.mock.calls[1][0])).toContain('information_schema.columns');
    expect(String(queryMock.mock.calls[2][0])).toContain('LEFT JOIN category_definitions cd');
    expect(String(queryMock.mock.calls[2][0])).toContain('dp.is_user_defined = true');
    expect(String(queryMock.mock.calls[2][0])).not.toContain('dp.is_active = true');
    expect(releaseMock).toHaveBeenCalled();

    service.__resetDatabase?.();
  });
});
