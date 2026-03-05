export interface BudgetUsageSummary {
  percentage: number;
  [key: string]: unknown;
}

export type BudgetUsageResponse = BudgetUsageSummary[];

export type RepaymentMatchStatus = 'matched' | 'partial' | 'unmatched' | 'ambiguous';
export type RepaymentMatchSource = 'inferred_amount_cycle' | 'none';
export type CardTxnLinkMethod = 'inferred_amount_cycle' | 'none';

export type PairingCycleStatus =
  | 'matched'
  | 'missing_cc_cycle'
  | 'fee_candidate'
  | 'large_discrepancy'
  | 'cc_over_bank'
  | 'incomplete_history'
  | 'ambiguous';

export interface PairingDetails {
  id: number;
  creditCardVendor: string;
  creditCardAccountNumber: string | null;
  bankVendor: string;
  bankAccountNumber: string | null;
  matchPatterns: string[];
  isActive: boolean;
  discrepancyAcknowledged: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RepaymentMatchDetails {
  identifier: string;
  vendor: string;
  accountNumber: string | null;
  date: string;
  cycleDate: string;
  name: string;
  price: number;
  absAmount: number;
  matchedAmount: number;
  remainingAmount: number;
  linkedExpenseCount: number;
  linkedExpenseTxnIds: string[];
  sharedPairingsCount: number;
  sharedPairingIds: number[];
  status: RepaymentMatchStatus;
  matchSource: RepaymentMatchSource;
}

export interface CardTxnMatchDetails {
  identifier: string;
  vendor: string;
  accountNumber: string | null;
  date: string;
  processedDate: string | null;
  cycleDate: string;
  name: string;
  price: number;
  absAmount: number;
  linkedRepaymentCount: number;
  linkedRepaymentIds: string[];
  isLinked: boolean;
  linkMethod: CardTxnLinkMethod;
}

export interface PairingCycleDetails {
  cycleDate: string;
  cycleStatus: PairingCycleStatus;
  bankTotal: number;
  ccTotal: number | null;
  difference: number | null;
  pendingCardDelta?: number;
  pendingTransactionCount?: number;
  provisionalCardTotal?: number | null;
  provisionalDifference?: number | null;
  matchedAccount: string | null;
  repayments: RepaymentMatchDetails[];
  cardTransactions: CardTxnMatchDetails[];
}

export interface PairingMatchSummary {
  cyclesCount: number;
  repaymentCount: number;
  cardTransactionCount: number;
  totalBankAmount: number;
  totalCardAmount: number;
  totalMatchedAmount: number;
  totalRemainingAmount: number;
  statusCounts: Record<RepaymentMatchStatus, number>;
}

export interface PairingMatchDetailsResponse {
  pairing: PairingDetails;
  summary: PairingMatchSummary;
  cycles: PairingCycleDetails[];
  periodMonths: number;
  method: string | null;
  acknowledged: boolean;
  generatedAt: string;
}
