import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
const getClientMock = vi.fn();

let service: any;

const sqlText = (value: unknown) => String(value).replace(/\s+/g, ' ').trim();

beforeEach(async () => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();
  getClientMock.mockReset();
  getClientMock.mockResolvedValue({
    query: (...args: any[]) => clientQueryMock(...args),
    release: (...args: any[]) => releaseMock(...args),
  });

  const module = await import('../allocation-targets.js');
  service = module.default ?? module;
  service.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
    getClient: (...args: any[]) => getClientMock(...args),
  });
});

afterEach(() => {
  service.__resetDatabase();
});

describe('investment allocation targets service', () => {
  it.each([
    [
      { scope: 'liquid', targets: [{ category: 'liquid', targetPercentage: 100 }] },
      /invalid allocation scope/i,
    ],
    [{ targets: [] }, /at least one/i],
    [
      {
        targets: [
          { category: 'liquid', targetPercentage: 50 },
          { category: 'liquid', targetPercentage: 50 },
        ],
      },
      /duplicate target category/i,
    ],
    [
      { targets: [{ category: 'not-a-category', targetPercentage: 100 }] },
      /invalid target category/i,
    ],
    [
      {
        targets: [
          { category: 'cash', targetPercentage: 40 },
          { category: 'liquid', targetPercentage: 40 },
        ],
      },
      /must total 100/i,
    ],
  ])('rejects invalid target payload %#', async (payload, message) => {
    await expect(service.replaceTargets(payload)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(message),
    });
    expect(getClientMock).not.toHaveBeenCalled();
  });

  it('replaces a complete target set transactionally and returns the saved targets', async () => {
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 1 });
    queryMock.mockImplementation((sql: string) => {
      if (sqlText(sql).startsWith('SELECT scope, category')) {
        return Promise.resolve({
          rows: [
            {
              scope: 'exclude_real_estate',
              category: 'cash',
              target_percentage: '35.5',
              updated_at: '2026-08-12T10:00:00Z',
            },
            {
              scope: 'exclude_real_estate',
              category: 'liquid',
              target_percentage: '64.5',
              updated_at: '2026-08-12T10:00:00Z',
            },
          ],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await service.replaceTargets({
      scope: 'exclude_real_estate',
      targets: [
        { category: 'cash', target_percentage: 35.5 },
        { category: 'liquid', targetPercentage: 64.5 },
      ],
    });

    expect(result).toMatchObject({
      scope: 'exclude_real_estate',
      configured: true,
      totalPercentage: 100,
      targets: [
        { category: 'cash', targetPercentage: 35.5 },
        { category: 'liquid', targetPercentage: 64.5 },
      ],
    });
    expect(clientQueryMock.mock.calls.map(([sql]) => sqlText(sql))).toEqual([
      'BEGIN',
      'DELETE FROM investment_allocation_targets WHERE scope = $1',
      expect.stringContaining('INSERT INTO investment_allocation_targets'),
      expect.stringContaining('INSERT INTO investment_allocation_targets'),
      'COMMIT',
    ]);
    expect(clientQueryMock.mock.calls[2][1]).toEqual(['exclude_real_estate', 'cash', 35.5]);
    expect(clientQueryMock.mock.calls[3][1]).toEqual(['exclude_real_estate', 'liquid', 64.5]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases the transaction client when an insert fails', async () => {
    const insertError = new Error('write failed');
    clientQueryMock.mockImplementation((sql: string, params?: unknown[]) => {
      const text = sqlText(sql);
      if (text.includes('INSERT INTO investment_allocation_targets') && params?.[1] === 'liquid') {
        return Promise.reject(insertError);
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await expect(service.replaceTargets({
      scope: 'all',
      targets: [
        { category: 'cash', targetPercentage: 25 },
        { category: 'liquid', targetPercentage: 75 },
      ],
    })).rejects.toBe(insertError);

    const statements = clientQueryMock.mock.calls.map(([sql]) => sqlText(sql));
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('lists normalized targets and clears only the requested scope', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sqlText(sql).startsWith('SELECT scope, category')) {
        return Promise.resolve({
          rows: [{
            scope: 'all',
            category: 'other',
            target_percentage: '100',
            updated_at: null,
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await expect(service.listTargets({ scope: 'all' })).resolves.toEqual({
      scope: 'all',
      configured: true,
      totalPercentage: 100,
      targets: [{
        scope: 'all',
        category: 'other',
        targetPercentage: 100,
        updatedAt: null,
      }],
    });
    await expect(service.clearTargets({ scope: 'all' })).resolves.toEqual({
      scope: 'all',
      configured: false,
      totalPercentage: 0,
      targets: [],
    });
    const deleteCall = queryMock.mock.calls.find(([sql]) =>
      sqlText(sql).startsWith('DELETE FROM investment_allocation_targets'));
    expect(deleteCall?.[1]).toEqual(['all']);
  });
});
