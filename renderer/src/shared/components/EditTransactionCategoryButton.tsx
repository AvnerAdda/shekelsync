import { IconButton, Tooltip } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useTranslation } from 'react-i18next';

export interface TransactionCategoryReference {
  identifier: string;
  vendor: string;
}

export const CATEGORY_UPDATED_EVENT = 'transactionCategoryUpdated';
export const OPEN_CATEGORY_EDITOR_EVENT = 'openTransactionCategoryEditor';

export default function EditTransactionCategoryButton({ transaction }: { transaction: TransactionCategoryReference }) {
  const { t } = useTranslation();
  const label = t('transactionCategoryEditor.title', 'Edit category');
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        disabled={!transaction.identifier || !transaction.vendor}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          window.dispatchEvent(new CustomEvent(OPEN_CATEGORY_EDITOR_EVENT, {
            detail: { identifier: transaction.identifier, vendor: transaction.vendor },
          }));
        }}
      >
        <EditOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
