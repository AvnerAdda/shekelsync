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

  it('suggests profile when no profile record exists in postgres mode', async () => {
    const institutions = [
      { vendor_code: 'hapoalim', institution_type: 'bank' },
      { vendor_code: 'isracard', institution_type: 'credit_card' },
    ];
    queryMock.mockResolvedValueOnce({ rows: institutions });
    queryMock.mockResolvedValueOnce({ rows: institutions });

    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // no profile
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // total accounts
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // bank accounts
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // credit cards
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // transactions
      .mockResolvedValueOnce({ rows: [{ last_scrape: null }] });

    const result = await onboardingService.getOnboardingStatus();

    expect(result.completedSteps.profile).toBe(false);
    expect(result.suggestedAction).toBe('profile');
    expect(result.isComplete).toBe(false);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('updates existing profile when dismissing onboarding in postgres mode', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await onboardingService.dismissOnboarding();

    expect(result).toEqual({
      success: true,
      message: 'Onboarding dismissed successfully',
    });
    expect(mockClient.query.mock.calls[1][0]).toContain('UPDATE user_profile');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('inserts a default profile when dismissing onboarding without an existing profile', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await onboardingService.dismissOnboarding();

    expect(result.success).toBe(true);
    expect(mockClient.query.mock.calls[1][0]).toContain('INSERT INTO user_profile');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
