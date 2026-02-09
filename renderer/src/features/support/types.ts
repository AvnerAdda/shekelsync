import { DEFAULT_DONATION_URL } from './constants';

export type DonationTier = 'none' | 'one_time' | 'bronze' | 'silver' | 'gold' | 'lifetime';
export type SupportPlanKey = 'one_time' | 'bronze' | 'silver' | 'gold' | 'lifetime';
export type SupportVerificationStatus = 'none' | 'pending' | 'verified' | 'rejected';
export type AiAgentAccessLevel = 'none' | 'standard' | 'extended' | 'unlimited';

export interface SupportPlan {
  key: SupportPlanKey;
  tier: Exclude<DonationTier, 'none'>;
  title: string;
  trialLabel: string | null;
  priceLabel: string;
  billingCycle: 'monthly' | 'one_time' | 'lifetime';
  amountUsd: number | null;
  rewards: string[];
  aiAccessLevel: AiAgentAccessLevel;
}

export interface DonationStatus {
  hasDonated: boolean;
  tier: DonationTier;
  supportStatus: SupportVerificationStatus;
  totalAmountUsd: number;
  currentPlanKey: SupportPlanKey | null;
  pendingPlanKey: SupportPlanKey | null;
  hasPendingVerification: boolean;
  lastVerifiedAt: string | null;
  billingCycle: 'monthly' | 'one_time' | 'lifetime' | null;
  canAccessAiAgent: boolean;
  aiAgentAccessLevel: AiAgentAccessLevel;
  plans: SupportPlan[];
  currentMonthKey: string;
  reminderShownThisMonth: boolean;
  shouldShowMonthlyReminder: boolean;
  donationUrl: string;
}

export interface CreateSupportIntentPayload {
  planKey: SupportPlanKey;
  note?: string;
  source?: string;
}

export interface AddDonationEventPayload {
  amount: number;
  donatedAt?: string;
  note?: string;
}

export interface MarkReminderShownPayload {
  monthKey?: string;
}

export const DEFAULT_SUPPORT_PLANS: SupportPlan[] = [
  {
    key: 'bronze',
    tier: 'bronze',
    title: 'Bronze Level',
    trialLabel: '7 days free trial',
    priceLabel: '$5 per month',
    billingCycle: 'monthly',
    amountUsd: 5,
    rewards: [
      'Access to AI Agent',
      'Support me on a monthly basis',
      'Unlock exclusive posts and messages',
      'Work in progress updates',
      'Early access',
    ],
    aiAccessLevel: 'standard',
  },
  {
    key: 'silver',
    tier: 'silver',
    title: 'Silver Level',
    trialLabel: '7 days free trial',
    priceLabel: '$10 per month',
    billingCycle: 'monthly',
    amountUsd: 10,
    rewards: [
      'Prioritary Feature Development',
      'Extended Access to AI Agent',
      'Support me on a monthly basis',
      'Unlock exclusive posts and messages',
      'Work in progress updates',
      'Early access',
    ],
    aiAccessLevel: 'extended',
  },
  {
    key: 'gold',
    tier: 'gold',
    title: 'Gold Level',
    trialLabel: '7 days free trial',
    priceLabel: '$20 per month',
    billingCycle: 'monthly',
    amountUsd: 20,
    rewards: [
      'Unlimited access to AI Agent',
      'Prioritary Feature Development',
      'Support me on a monthly basis',
      'Unlock exclusive posts and messages',
      'Early access',
      'Work in progress updates',
    ],
    aiAccessLevel: 'unlimited',
  },
  {
    key: 'lifetime',
    tier: 'lifetime',
    title: 'Lifetime Access',
    trialLabel: null,
    priceLabel: 'Lifetime access',
    billingCycle: 'lifetime',
    amountUsd: null,
    rewards: [
      'Prioritary Feature Development',
      'Unlimited access to AI Agent',
      'Lifetime discount on shop items',
      'Lifetime access to exclusive content',
      'Early access',
      'Work in progress updates',
    ],
    aiAccessLevel: 'unlimited',
  },
  {
    key: 'one_time',
    tier: 'one_time',
    title: 'One-Time Support',
    trialLabel: null,
    priceLabel: 'One-time payment',
    billingCycle: 'one_time',
    amountUsd: null,
    rewards: [
      'Support development with a one-time payment',
      'Thank-you mention in supporter status',
    ],
    aiAccessLevel: 'none',
  },
];

export function isDonationTier(value: unknown): value is DonationTier {
  return typeof value === 'string' && (
    value === 'none'
    || value === 'one_time'
    || value === 'bronze'
    || value === 'silver'
    || value === 'gold'
    || value === 'lifetime'
  );
}

export function isSupportPlanKey(value: unknown): value is SupportPlanKey {
  return typeof value === 'string' && (
    value === 'one_time'
    || value === 'bronze'
    || value === 'silver'
    || value === 'gold'
    || value === 'lifetime'
  );
}

export function getCurrentMonthKey(inputDate: Date = new Date()): string {
  const year = inputDate.getFullYear();
  const month = String(inputDate.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getDonationTier(totalAmountUsd: number): DonationTier {
  if (!Number.isFinite(totalAmountUsd) || totalAmountUsd <= 0) {
    return 'none';
  }

  if (totalAmountUsd >= 20) {
    return 'gold';
  }
  if (totalAmountUsd >= 10) {
    return 'silver';
  }
  if (totalAmountUsd >= 5) {
    return 'bronze';
  }

  return 'one_time';
}

export function createDefaultDonationStatus(): DonationStatus {
  return {
    hasDonated: false,
    tier: 'none',
    supportStatus: 'none',
    totalAmountUsd: 0,
    currentPlanKey: null,
    pendingPlanKey: null,
    hasPendingVerification: false,
    lastVerifiedAt: null,
    billingCycle: null,
    canAccessAiAgent: false,
    aiAgentAccessLevel: 'none',
    plans: DEFAULT_SUPPORT_PLANS,
    currentMonthKey: getCurrentMonthKey(),
    reminderShownThisMonth: false,
    shouldShowMonthlyReminder: true,
    donationUrl: DEFAULT_DONATION_URL,
  };
}
