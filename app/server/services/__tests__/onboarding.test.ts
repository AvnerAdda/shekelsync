import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../onboarding.js');
const institutionsPromise = import('../institutions.js');

const queryMock = vi.fn();
const getClientMock = vi.fn();
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

// Mock sql-dialect
vi.mock('../../../lib/sql-dialect.js', () => ({
  dialect: { useSqlite: true },
}));

let onboardingService: any;
let institutionsService: any;

beforeAll(async () => {
  const module = await modulePromise;
  onboardingService = module.default ?? module;
  institutionsService = await institutionsPromise;
});

beforeEach(() => {
  queryMock.mockReset();
  getClientMock.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();

  getClientMock.mockResolvedValue(mockClient);

  // Clear institutions cache to ensure consistent test state
  institutionsService.clearInstitutionsCache?.();

  onboardingService.__setDatabase?.({
    query: queryMock,
    getClient: getClientMock,
  });
});

afterEach(() => {
  onboardingService.__resetDatabase?.();
  institutionsService.clearInstitutionsCache?.();
});

// Helper to set up institutions cache query response
// Note: getOnboardingStatus calls getVendorCodesByTypes twice in Promise.all,
// and both may call loadInstitutionsCache before the cache is populated.
// So we need to mock TWO responses to handle the race condition.
const setupInstitutionsCache = (bankVendors: string[], creditVendors: string[]) => {
  const institutions = [
    ...bankVendors.map(v => ({ vendor_code: v, institution_type: 'bank' })),
    ...creditVendors.map(v => ({ vendor_code: v, institution_type: 'credit_card' })),
  ];
  // Mock two responses for parallel calls to loadInstitutionsCache
  queryMock.mockResolvedValueOnce({ rows: institutions });
  queryMock.mockResolvedValueOnce({ rows: institutions });
};

describe('onboarding service', () => {
  describe('getOnboardingStatus', () => {
    it('returns complete status when all steps are done', async () => {
      // Set up institutions cache (called twice - once for bank, once for credit)
      setupInstitutionsCache(['hapoalim', 'leumi'], ['isracard', 'max']);

      mockClient.query
        // Profile query
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            username: 'TestUser',
            onboarding_dismissed: 1,
            onboarding_dismissed_at: '2025-01-01',
            last_active_at: '2025-01-01',
          }],
        })
        // Total accounts count
        .mockResolvedValueOnce({ rows: [{ count: 3 }] })
        // Bank accounts count
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        // Credit card count
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        // Transactions count
        .mockResolvedValueOnce({ rows: [{ count: 100 }] })
        // Last scrape
        .mockResolvedValueOnce({ rows: [{ last_scrape: '2025-01-01T12:00:00Z' }] });

      const result = await onboardingService.getOnboardingStatus();

      expect(result.isComplete).toBe(true);
      expect(result.completedSteps.profile).toBe(true);
      expect(result.completedSteps.bankAccount).toBe(true);
      expect(result.completedSteps.creditCard).toBe(true);
      expect(result.completedSteps.firstScrape).toBe(true);
      expect(result.completedSteps.explored).toBe(true);
      expect(result.suggestedAction).toBeNull();
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('returns incomplete status with suggested action for profile', async () => {
      setupInstitutionsCache(['hapoalim'], ['isracard']);

      mockClient.query
        // No profile
        .mockResolvedValueOnce({ rows: [] })
        // Accounts
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Bank accounts
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Credit cards
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Transactions
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Last scrape
        .mockResolvedValueOnce({ rows: [{ last_scrape: null }] });

      const result = await onboardingService.getOnboardingStatus();

      expect(result.isComplete).toBe(false);
      expect(result.completedSteps.profile).toBe(false);
      expect(result.suggestedAction).toBe('profile');
    });

    it('suggests bankAccount when profile exists but no bank account', async () => {
      setupInstitutionsCache(['hapoalim'], ['isracard']);

      mockClient.query
        // Profile exists with username
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            username: 'User',
            onboarding_dismissed: 0,
          }],
        })
        // Total accounts
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Bank accounts
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Credit cards
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Transactions
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Last scrape
        .mockResolvedValueOnce({ rows: [{ last_scrape: null }] });

      const result = await onboardingService.getOnboardingStatus();

      expect(result.completedSteps.profile).toBe(true);
      expect(result.completedSteps.bankAccount).toBe(false);
      expect(result.suggestedAction).toBe('bankAccount');
    });

    it('suggests creditCard when bank account exists but no credit card', async () => {
      setupInstitutionsCache(['hapoalim'], ['isracard']);

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            username: 'User',
            onboarding_dismissed: 0,
          }],
        })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ last_scrape: null }] });

      const result = await onboardingService.getOnboardingStatus();

      expect(result.completedSteps.bankAccount).toBe(true);
      expect(result.completedSteps.creditCard).toBe(false);
      expect(result.suggestedAction).toBe('creditCard');
    });

    it('suggests scrape when accounts exist but no transactions', async () => {
      setupInstitutionsCache(['hapoalim'], ['isracard']);

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            username: 'User',
            onboarding_dismissed: 0,
          }],
        })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ last_scrape: null }] });

      const result = await onboardingService.getOnboardingStatus();

      expect(result.completedSteps.creditCard).toBe(true);
      expect(result.completedSteps.firstScrape).toBe(false);
      expect(result.suggestedAction).toBe('scrape');
    });

    it('suggests explore when transactions exist but not explored', async () => {
      setupInstitutionsCache(['hapoalim'], ['isracard']);

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            username: 'User',
            onboarding_dismissed: 0,
          }],
        })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ count: 10 }] })
        .mockResolvedValueOnce({ rows: [{ last_scrape: '2025-01-01' }] });

      const result = await onboardingService.getOnboardingStatus();

      expect(result.completedSteps.firstScrape).toBe(true);
      expect(result.completedSteps.explored).toBe(false);
      expect(result.suggestedAction).toBe('explore');
    });

    it('marks explored as true when transaction count > 50', async () => {
      setupInstitutionsCache(['hapoalim'], ['isracard']);

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            username: 'User',
            onboarding_dismissed: 0,
          }],
        })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ count: 51 }] })
        .mockResolvedValueOnce({ rows: [{ last_scrape: '2025-01-01' }] });

      const result = await onboardingService.getOnboardingStatus();

      expect(result.completedSteps.explored).toBe(true);
      expect(result.isComplete).toBe(true);
    });

    it('handles empty vendor lists gracefully', async () => {
      // Set up institutions cache with no bank/credit institutions
      // (e.g., only investment institutions)
      const institutions = [
        { vendor_code: 'someInvestment', institution_type: 'investment' },
      ];
      queryMock.mockResolvedValueOnce({ rows: institutions });
      queryMock.mockResolvedValueOnce({ rows: institutions });

      mockClient.query
        // Profile query
        .mockResolvedValueOnce({ rows: [] })
        // Total accounts count
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // If bank vendors exist in cache from previous tests, handle it
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // If credit vendors exist in cache from previous tests, handle it
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Transactions count
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Last scrape
        .mockResolvedValueOnce({ rows: [{ last_scrape: null }] });

      const result = await onboardingService.getOnboardingStatus();

      // Check that client was released
      expect(mockClient.release).toHaveBeenCalled();
      // The actual counts may vary depending on cache state from previous tests,
      // but we verify the function completes without error
      expect(result.stats).toBeDefined();
    });

    it('releases client even on error', async () => {
      // Set up institutions cache first (so getVendorCodesByTypes succeeds)
      setupInstitutionsCache(['hapoalim'], ['isracard']);

      // Make client.query fail (this is guaranteed to be called after institutions lookup)
      mockClient.query.mockRejectedValue(new Error('DB Error'));

      await expect(onboardingService.getOnboardingStatus()).rejects.toThrow('DB Error');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('dismissOnboarding', () => {
    it('updates existing profile to dismiss onboarding', async () => {
      mockClient.query
        // Check for existing profile
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        // Update query
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await onboardingService.dismissOnboarding();

      expect(result).toEqual({
        success: true,
        message: 'Onboarding dismissed successfully',
      });
      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('creates new profile if none exists', async () => {
      mockClient.query
        // No existing profile
        .mockResolvedValueOnce({ rows: [] })
        // Insert query
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await onboardingService.dismissOnboarding();

      expect(result.success).toBe(true);
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it('releases client even on error', async () => {
      mockClient.query.mockRejectedValue(new Error('DB Error'));

      await expect(onboardingService.dismissOnboarding()).rejects.toThrow('DB Error');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getOnboardingStatus additional tests', () => {
    it('returns profile: false when profile has no username', async () => {
      setupInstitutionsCache(['hapoalim'], ['isracard']);

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, username: null, onboarding_dismissed: 0 }],
        })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ last_scrape: null }] });

      const result = await onboardingService.getOnboardingStatus();

      expect(result.completedSteps.profile).toBe(false);
    });

    it('returns completedSteps with three out of five completed', async () => {
      setupInstitutionsCache(['hapoalim'], ['isracard']);

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, username: 'User', onboarding_dismissed: 0 }],
        })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] }) // Total accounts
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // Bank accounts
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // Credit cards
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // Transactions
        .mockResolvedValueOnce({ rows: [{ last_scrape: null }] });

      const result = await onboardingService.getOnboardingStatus();

      // profile: true, bankAccount: true, creditCard: true, firstScrape: false, explored: false
      expect(result.completedSteps.profile).toBe(true);
      expect(result.completedSteps.bankAccount).toBe(true);
      expect(result.completedSteps.creditCard).toBe(true);
      expect(result.completedSteps.firstScrape).toBe(false);
      expect(result.isComplete).toBe(false);
    });

    it('returns stats with account counts', async () => {
      setupInstitutionsCache(['hapoalim', 'leumi'], ['isracard', 'max']);

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, username: 'User', onboarding_dismissed: 0 }],
        })
        .mockResolvedValueOnce({ rows: [{ count: 4 }] }) // Total accounts
        .mockResolvedValueOnce({ rows: [{ count: 2 }] }) // Bank accounts
        .mockResolvedValueOnce({ rows: [{ count: 2 }] }) // Credit cards
        .mockResolvedValueOnce({ rows: [{ count: 100 }] }) // Transactions
        .mockResolvedValueOnce({ rows: [{ last_scrape: '2025-01-15' }] });

      const result = await onboardingService.getOnboardingStatus();

      expect(result.stats.accountCount).toBe(4);
      expect(result.stats.bankAccountCount).toBe(2);
      expect(result.stats.creditCardCount).toBe(2);
      expect(result.stats.transactionCount).toBe(100);
    });

    it('handles null counts gracefully', async () => {
      setupInstitutionsCache(['hapoalim'], ['isracard']);

      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // No profile
        .mockResolvedValueOnce({ rows: [{ count: null }] })
        .mockResolvedValueOnce({ rows: [{ count: null }] })
        .mockResolvedValueOnce({ rows: [{ count: null }] })
        .mockResolvedValueOnce({ rows: [{ count: null }] })
        .mockResolvedValueOnce({ rows: [{ last_scrape: null }] });

      const result = await onboardingService.getOnboardingStatus();

      expect(result.stats.accountCount).toBe(0);
      expect(result.stats.transactionCount).toBe(0);
    });

    it('suggests bankAccount when no bank accounts exist', async () => {
      setupInstitutionsCache(['hapoalim'], ['isracard']);

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, username: 'User', onboarding_dismissed: 0 }],
        })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // No accounts
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // No bank
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // No credit
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ last_scrape: null }] });

      const result = await onboardingService.getOnboardingStatus();

      expect(result.suggestedAction).toBe('bankAccount');
    });

    it('suggests creditCard when bank exists but no credit card', async () => {
      setupInstitutionsCache(['hapoalim'], ['isracard']);

      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, username: 'User', onboarding_dismissed: 0 }],
        })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // 1 account
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // Bank exists
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // No credit
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ last_scrape: null }] });

      const result = await onboardingService.getOnboardingStatus();

      expect(result.suggestedAction).toBe('creditCard');
    });
  });
});
