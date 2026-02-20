import type { DonationTier } from '@renderer/features/support';

export function normalizeDonationTier(tier: DonationTier | null | undefined): DonationTier {
  switch (tier) {
    case 'one_time':
      return tier;
    default:
      return 'none';
  }
}
