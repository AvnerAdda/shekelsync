import type { PageAccessStatus } from '@app/contexts/OnboardingContext';

export interface OnboardingGateState {
  accessStatus: PageAccessStatus;
  isLocked: boolean;
  isResolved: boolean;
  shouldBlockPageData: boolean;
  showLoading: boolean;
}

export const UNRESOLVED_PAGE_ACCESS_STATUS: PageAccessStatus = {
  isLocked: false,
  requiredStep: '',
  reason: '',
};

export function resolveOnboardingGate(
  onboardingStatus: unknown,
  getPageAccessStatus: (page: string) => PageAccessStatus,
  page: string,
): OnboardingGateState {
  const isResolved = onboardingStatus !== null;
  const accessStatus = isResolved
    ? getPageAccessStatus(page)
    : UNRESOLVED_PAGE_ACCESS_STATUS;
  const isLocked = isResolved && accessStatus.isLocked;

  return {
    accessStatus,
    isLocked,
    isResolved,
    shouldBlockPageData: !isResolved || isLocked,
    showLoading: !isResolved,
  };
}
