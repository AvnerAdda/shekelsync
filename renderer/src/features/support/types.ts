import { DEFAULT_DONATION_URL } from './constants';

export type DonationTier = 'none' | 'one_time';
export type SupportVerificationStatus = 'none' | 'pending' | 'verified' | 'rejected';
export type AiAgentAccessLevel = 'none' | 'standard';

export interface DonationStatus {
  hasDonated: boolean;
  tier: DonationTier;
  supportStatus: SupportVerificationStatus;
  totalAmountUsd: number;
  currentPlanKey: 'one_time' | null;
  pendingPlanKey: 'one_time' | null;
  hasPendingVerification: boolean;
  lastVerifiedAt: string | null;
  billingCycle: 'monthly' | 'one_time' | 'lifetime' | null;
  canAccessAiAgent: boolean;
  aiAgentAccessLevel: AiAgentAccessLevel;
  plans: [];
  currentMonthKey: string;
  reminderShownThisMonth: boolean;
  shouldShowMonthlyReminder: boolean;
  donationUrl: string;
}

export interface CreateSupportIntentPayload {
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

export function isDonationTier(value: unknown): value is DonationTier {
  return typeof value === 'string' && (value === 'none' || value === 'one_time');
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
    plans: [],
    currentMonthKey: getCurrentMonthKey(),
    reminderShownThisMonth: false,
    shouldShowMonthlyReminder: true,
    donationUrl: DEFAULT_DONATION_URL,
  };
}
