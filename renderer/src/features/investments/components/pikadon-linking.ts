import type {
  PendingPikadonSetup,
  PikadonDetailsInput,
} from '@renderer/types/investments';

export interface SuggestionTransactionLike {
  transactionIdentifier: string;
  transactionVendor: string;
  transactionDate: string;
  transactionAmount: number;
  transactionName: string;
}

const PIKADON_KEYWORDS = [
  'פיקדון',
  'פקדון',
  'pikadon',
  'term deposit',
  'fixed deposit',
  'תוכנית חסכון',
  'פק"מ',
  'פקמ',
];

export function getPikadonCandidateKey(candidate: Pick<PendingPikadonSetup, 'transaction_identifier' | 'transaction_vendor'>): string {
  return `${candidate.transaction_identifier}::${candidate.transaction_vendor}`;
}

export function transactionLooksLikePikadonDeposit(transaction: SuggestionTransactionLike): boolean {
  if (!transaction || transaction.transactionAmount >= 0) {
    return false;
  }

  const haystack = String(transaction.transactionName || '').toLowerCase();
  if (!haystack) {
    return false;
  }

  return PIKADON_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

export function buildPikadonCandidateFromSuggestionTransaction(
  transaction: SuggestionTransactionLike,
  accountId: number,
  accountName?: string | null,
): PendingPikadonSetup | null {
  if (!transactionLooksLikePikadonDeposit(transaction)) {
    return null;
  }

  return {
    account_id: accountId,
    account_name: accountName || null,
    transaction_identifier: transaction.transactionIdentifier,
    transaction_vendor: transaction.transactionVendor,
    principal: Math.abs(Number(transaction.transactionAmount || 0)),
    deposit_date: transaction.transactionDate,
    transaction_name: transaction.transactionName || null,
  };
}

export function buildPikadonSetupMap(
  candidates: PendingPikadonSetup[],
  detailsByKey: Record<string, PikadonDetailsInput>,
): Record<string, PikadonDetailsInput> {
  return candidates.reduce<Record<string, PikadonDetailsInput>>((acc, candidate) => {
    const key = getPikadonCandidateKey(candidate);
    if (detailsByKey[key]) {
      acc[key] = detailsByKey[key];
    }
    return acc;
  }, {});
}
