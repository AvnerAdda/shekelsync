import { BreakdownTransaction } from './types';

export const isPendingTransaction = (txn: BreakdownTransaction) => {
  if (!txn.processedDate && !txn.processed_date) {
    return false;
  }

  const processedDate = txn.processedDate || txn.processed_date;
  if (!processedDate) {
    return false;
  }

  return new Date(processedDate) > new Date();
};
