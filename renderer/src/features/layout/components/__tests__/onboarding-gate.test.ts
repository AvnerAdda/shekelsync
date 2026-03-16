import { describe, expect, it, vi } from 'vitest';

import { resolveOnboardingGate, UNRESOLVED_PAGE_ACCESS_STATUS } from '../onboarding-gate';

describe('resolveOnboardingGate', () => {
  it('treats unresolved onboarding as loading instead of locked', () => {
    const getPageAccessStatus = vi.fn().mockReturnValue({
      isLocked: true,
      requiredStep: 'firstScrape',
      reason: 'Complete your first transaction scrape to unlock this page',
    });

    const result = resolveOnboardingGate(null, getPageAccessStatus, 'analysis');

    expect(getPageAccessStatus).not.toHaveBeenCalled();
    expect(result).toEqual({
      accessStatus: UNRESOLVED_PAGE_ACCESS_STATUS,
      isLocked: false,
      isResolved: false,
      shouldBlockPageData: true,
      showLoading: true,
    });
  });

  it('surfaces the locked state after onboarding resolves', () => {
    const accessStatus = {
      isLocked: true,
      requiredStep: 'firstScrape',
      reason: 'Complete your first transaction scrape to unlock this page',
    };
    const getPageAccessStatus = vi.fn().mockReturnValue(accessStatus);

    const result = resolveOnboardingGate({ completedSteps: { firstScrape: false } }, getPageAccessStatus, 'investments');

    expect(getPageAccessStatus).toHaveBeenCalledWith('investments');
    expect(result).toEqual({
      accessStatus,
      isLocked: true,
      isResolved: true,
      shouldBlockPageData: true,
      showLoading: false,
    });
  });
});
