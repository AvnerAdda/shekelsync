import type { PikadonDetailsInput } from '@renderer/types/investments';
import { getPikadonCandidateKey } from './pikadon-linking';

type SuggestionTransactionLike = {
  transactionIdentifier: string;
  transactionVendor: string;
};

type LinkBatchResponse = {
  ok: boolean;
  data?: unknown;
};

type LinkBatchFailure = {
  ok: false;
  response: LinkBatchResponse;
};

type LinkBatchSuccess = {
  ok: true;
  linkedCount: number;
};

export async function linkSuggestionTransactionsBatch({
  transactions,
  accountId,
  detailsByKey = {},
  postLink,
}: {
  transactions: SuggestionTransactionLike[];
  accountId: number;
  detailsByKey?: Record<string, PikadonDetailsInput>;
  postLink: (payload: {
    transaction_identifier: string;
    transaction_vendor: string;
    account_id: number;
    link_method: string;
    confidence: number;
    pikadon_details?: PikadonDetailsInput;
  }) => Promise<LinkBatchResponse>;
}): Promise<LinkBatchFailure | LinkBatchSuccess> {
  for (const txn of transactions) {
    const key = getPikadonCandidateKey({
      transaction_identifier: txn.transactionIdentifier,
      transaction_vendor: txn.transactionVendor,
    });
    const response = await postLink({
      transaction_identifier: txn.transactionIdentifier,
      transaction_vendor: txn.transactionVendor,
      account_id: accountId,
      link_method: 'manual_suggestion',
      confidence: 0.9,
      pikadon_details: detailsByKey[key],
    });

    if (!response.ok) {
      return {
        ok: false,
        response,
      };
    }
  }

  return {
    ok: true,
    linkedCount: transactions.length,
  };
}
