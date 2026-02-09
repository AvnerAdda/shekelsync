import type { DonationTier } from '@renderer/features/support';

export function normalizeDonationTier(tier: DonationTier | null | undefined): DonationTier {
  switch (tier) {
    case 'bronze':
    case 'silver':
    case 'gold':
      return tier;
    default:
      return 'none';
  }
}
