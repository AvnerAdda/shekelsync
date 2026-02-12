import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let onboardingService;
let institutionsService;
let mockClient;
const queryMock = vi.fn();
const originalUseSqliteEnv = process.env.USE_SQLITE;

beforeAll(async () => {
  process.env.USE_SQLITE = 'false';
  vi.resetModules();

  const module = await import('../onboarding.js');
  onboardingService = module.default ?? module;
  institutionsService = await import('../institutions.js');
});

beforeEach(() => {
  queryMock.mockReset();
  institutionsService.clearInstitutionsCache?.();

  mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };

  onboardingService.__setDatabase?.({
    query: queryMock,
    getClient: vi.fn().mockResolvedValue(mockClient),
  });
});

afterEach(() => {
  onboardingService.__resetDatabase?.();
  institutionsService.clearInstitutionsCache?.();
});

afterAll(() => {
  process.env.USE_SQLITE = originalUseSqliteEnv;
  vi.resetModules();
});

describe('onboarding service postgres query behavior', () => {
  it('uses ANY($1) vendor filters when dialect is postgres', async () => {
    const institutions = [
      { vendor_code: 'hapoalim', institution_type: 'bank' },
      { vendor_code: 'isracard', institution_type: 'credit_card' },
      { vendor_code: 'max', institution_type: 'credit_card' },
    ];
    queryMock.mockResolvedValueOnce({ rows: institutions });
    queryMock.mockResolvedValueOnce({ rows: institutions });

    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 1, username: 'User', onboarding_dismissed: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ count: 15 }] })
      .mockResolvedValueOnce({ rows: [{ last_scrape: '2025-01-01T00:00:00Z' }] });

    const result = await onboardingService.getOnboardingStatus();

    expect(result.stats.bankAccountCount).toBe(1);
    expect(result.stats.creditCardCount).toBe(2);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('vendor = ANY($1)'),
      [['hapoalim']],
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('vendor = ANY($1)'),
      [['isracard', 'max']],
    );
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
