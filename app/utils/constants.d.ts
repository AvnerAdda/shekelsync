export const CREDIT_CARD_VENDORS: readonly string[];
export const BANK_VENDORS: readonly string[];
export const SPECIAL_BANK_VENDORS: readonly string[];
export const OTHER_BANK_VENDORS: readonly string[];
export const ALL_VENDORS: readonly string[];
export const STALE_SYNC_THRESHOLD_MS: number;

export interface AccountCategory {
  id: string;
  label: string;
  label_he: string;
  description?: string;
  icon: string;
  color: string;
  vendors?: readonly string[];
  types?: readonly string[];
  subcategories?: Record<string, AccountCategory>;
}

export const ACCOUNT_CATEGORIES: Record<string, AccountCategory>;

export interface InvestmentAccountType {
  value: string;
  label: string;
  label_he: string;
  category: string;
}

export const INVESTMENT_ACCOUNT_TYPES: readonly InvestmentAccountType[];

export function getAccountCategory(accountType: string): string;
export function getAccountSubcategory(accountType: string): string;
