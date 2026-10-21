import { Box } from '@mui/material';
import EditTransactionCategoryButton, { type TransactionCategoryReference } from './EditTransactionCategoryButton';
import DeleteTransactionButton from './DeleteTransactionButton';

export default function TransactionActions({ transaction }: { transaction: TransactionCategoryReference }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0, whiteSpace: 'nowrap' }}>
      <EditTransactionCategoryButton transaction={transaction} />
      <DeleteTransactionButton transaction={transaction} />
    </Box>
  );
}
