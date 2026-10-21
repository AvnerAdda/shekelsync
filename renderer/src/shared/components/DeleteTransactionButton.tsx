import { IconButton, Tooltip } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { useTranslation } from 'react-i18next';
import type { TransactionCategoryReference } from './EditTransactionCategoryButton';

export const OPEN_TRANSACTION_DELETE_EVENT = 'openTransactionDelete';
export const TRANSACTION_DELETED_EVENT = 'transactionDeleted';

export default function DeleteTransactionButton({ transaction }: { transaction: TransactionCategoryReference }) {
  const { t } = useTranslation();
  const label = t('transactionDelete.title', 'Delete transaction');
  return (
    <Tooltip title={label}>
      <IconButton size="small" color="error" aria-label={label}
        disabled={!transaction.identifier || !transaction.vendor}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        }}
        onClick={event => {
          event.stopPropagation();
          window.dispatchEvent(new CustomEvent(OPEN_TRANSACTION_DELETE_EVENT, {
            detail: { identifier: transaction.identifier, vendor: transaction.vendor },
          }));
        }}>
        <DeleteOutlineIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
