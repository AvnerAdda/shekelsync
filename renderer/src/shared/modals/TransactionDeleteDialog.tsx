import { useEffect, useId, useRef, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { apiClient, invalidateApiCache } from '@renderer/lib/api-client';
import type { TransactionCategoryReference } from '../components/EditTransactionCategoryButton';
import { OPEN_TRANSACTION_DELETE_EVENT, TRANSACTION_DELETED_EVENT } from '../components/DeleteTransactionButton';
import { focusDeleteCancel } from '../hooks/useDeleteConfirmation';
import type { TransactionForModal } from './TransactionDetailModal';

function Confirmation({ reference, onClose }: { reference: TransactionCategoryReference; onClose: () => void }) {
  const { t } = useTranslation();
  const { formatCurrency } = useFinancePrivacy();
  const titleId = useId();
  const descriptionId = useId();
  const [transaction, setTransaction] = useState<TransactionForModal | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const url = `/api/transactions/${encodeURIComponent(`${reference.identifier}|${reference.vendor}`)}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiClient.get<TransactionForModal>(url, { cacheMode: 'no-store' }).then(response => {
      if (cancelled) return;
      if (!response.ok || !response.data
        || response.data.identifier !== reference.identifier || response.data.vendor !== reference.vendor) {
        throw new Error('Unable to load transaction');
      }
      setTransaction(response.data);
    }).catch(() => {
      if (!cancelled) setError(t('transactionDelete.loadError', 'Could not load the transaction. Please try again.'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, reference.identifier, reference.vendor, attempt, t]);

  const remove = async () => {
    if (!transaction || loading || inFlight.current) return;
    inFlight.current = true;
    setDeleting(true);
    setError('');
    try {
      const response = await apiClient.delete(url);
      if (!response.ok) throw new Error('Transaction deletion failed');
      invalidateApiCache();
      window.dispatchEvent(new CustomEvent(TRANSACTION_DELETED_EVENT, { detail: reference }));
      window.dispatchEvent(new Event('dataRefresh'));
      onClose();
    } catch {
      setError(t('transactionDelete.deleteError', 'Could not delete the transaction. Please try again.'));
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  };

  return (
    <Dialog open onClose={deleting ? undefined : onClose} maxWidth="xs" fullWidth
      aria-labelledby={titleId} aria-describedby={descriptionId}
      slotProps={{ transition: { onEntered: focusDeleteCancel } }}
      sx={{ zIndex: theme => theme.zIndex.modal + 10 }}>
      <DialogTitle id={titleId}>{t('transactionDelete.title', 'Delete transaction')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading ? <CircularProgress size={24} /> : transaction ? (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{ fontWeight: 600 }}>{transaction.name || transaction.vendor}</Typography>
            <Typography variant="body2" color="text.secondary">{transaction.date?.slice(0, 10)} · {transaction.vendor}</Typography>
            <Typography>{formatCurrency(transaction.price, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Typography>
          </Box>
        ) : <Button onClick={() => setAttempt(value => value + 1)}>{t('transactionDelete.retry', 'Try again')}</Button>}
        <DialogContentText id={descriptionId}>
          {t('transactionDelete.message', 'This removes only this transaction from your records. This action cannot be undone.')}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button data-delete-cancel disabled={deleting} onClick={onClose}>{t('deleteConfirmation.cancel', 'Cancel')}</Button>
        <Button color="error" variant="contained" disabled={loading || deleting || !transaction} onClick={() => void remove()}>
          {deleting ? t('transactionDelete.deleting', 'Deleting…') : t('deleteConfirmation.delete', 'Delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** One host preserves the confirmation when its originating list refreshes. */
export default function TransactionDeleteDialog() {
  const [reference, setReference] = useState<TransactionCategoryReference | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<TransactionCategoryReference>).detail;
      if (typeof detail?.identifier === 'string' && detail.identifier && typeof detail.vendor === 'string' && detail.vendor) {
        setReference(current => current || { identifier: detail.identifier, vendor: detail.vendor });
      }
    };
    window.addEventListener(OPEN_TRANSACTION_DELETE_EVENT, open);
    return () => window.removeEventListener(OPEN_TRANSACTION_DELETE_EVENT, open);
  }, []);
  return reference ? <Confirmation reference={reference} onClose={() => setReference(null)} /> : null;
}
