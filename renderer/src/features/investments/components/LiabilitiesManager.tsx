import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import { apiClient } from '@/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { InvestmentLiability } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';

interface LiabilitiesManagerProps {
  onChanged?: () => void | Promise<void>;
}

interface LiabilityDraft {
  liability_name: string;
  liability_type: InvestmentLiability['liability_type'];
  balance: string;
  currency: string;
  interest_rate: string;
  monthly_payment: string;
  as_of_date: string;
  notes: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function blankDraft(): LiabilityDraft {
  return {
    liability_name: '',
    liability_type: 'loan',
    balance: '',
    currency: 'ILS',
    interest_rate: '',
    monthly_payment: '',
    as_of_date: today(),
    notes: '',
  };
}

function toDraft(liability: InvestmentLiability): LiabilityDraft {
  return {
    liability_name: liability.liability_name,
    liability_type: liability.liability_type,
    balance: String(liability.balance),
    currency: liability.currency,
    interest_rate: liability.interest_rate == null ? '' : String(liability.interest_rate),
    monthly_payment: liability.monthly_payment == null ? '' : String(liability.monthly_payment),
    as_of_date: liability.as_of_date || today(),
    notes: liability.notes || '',
  };
}

const LiabilitiesManager: React.FC<LiabilitiesManagerProps> = ({ onChanged }) => {
  const { t } = useTranslation('translation');
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const [liabilities, setLiabilities] = React.useState<InvestmentLiability[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<InvestmentLiability | null | 'new'>(null);
  const [draft, setDraft] = React.useState<LiabilityDraft>(blankDraft);
  const [pendingDelete, setPendingDelete] = React.useState<InvestmentLiability | null>(null);

  const fetchLiabilities = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<{ liabilities: InvestmentLiability[] }>(
        '/api/investments/liabilities',
        { cacheMode: 'no-store' },
      );
      if (!response.ok) throw new Error(response.statusText || 'Failed to load liabilities');
      setLiabilities(response.data?.liabilities || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load liabilities');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchLiabilities();
  }, [fetchLiabilities]);

  const openNew = () => {
    setEditing('new');
    setDraft(blankDraft());
    setError(null);
  };

  const openEdit = (liability: InvestmentLiability) => {
    setEditing(liability);
    setDraft(toDraft(liability));
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...(editing !== 'new' && editing ? { id: editing.id } : {}),
        liability_name: draft.liability_name.trim(),
        liability_type: draft.liability_type,
        balance: Number(draft.balance),
        currency: draft.currency.trim().toUpperCase(),
        interest_rate: draft.interest_rate === '' ? null : Number(draft.interest_rate),
        monthly_payment: draft.monthly_payment === '' ? null : Number(draft.monthly_payment),
        as_of_date: draft.as_of_date,
        notes: draft.notes.trim() || null,
      };
      const response = editing === 'new'
        ? await apiClient.post<{ liability: InvestmentLiability }>('/api/investments/liabilities', payload)
        : await apiClient.put<{ liability: InvestmentLiability }>('/api/investments/liabilities', payload);
      if (!response.ok) {
        const body = response.data as { error?: string } | undefined;
        throw new Error(body?.error || response.statusText || 'Failed to save liability');
      }
      setEditing(null);
      await fetchLiabilities();
      await onChanged?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save liability');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!pendingDelete) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.delete(
        `/api/investments/liabilities?id=${encodeURIComponent(String(pendingDelete.id))}`,
      );
      if (!response.ok) throw new Error(response.statusText || 'Failed to remove liability');
      setPendingDelete(null);
      await fetchLiabilities();
      await onChanged?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to remove liability');
    } finally {
      setSaving(false);
    }
  };

  const formatNative = (liability: InvestmentLiability, value: number) => {
    if (maskAmounts) return '***';
    return formatCurrency(value, {
      absolute: true,
      maximumFractionDigits: 0,
      currencySymbol: liability.currency === 'ILS' ? '₪' : `${liability.currency} `,
    });
  };

  const formValid = draft.liability_name.trim().length > 0
    && Number.isFinite(Number(draft.balance))
    && Number(draft.balance) >= 0
    && /^[A-Za-z]{3}$/.test(draft.currency.trim());

  return (
    <Paper sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t('investmentsPage.liabilities.title', 'Standalone liabilities')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(
              'investmentsPage.liabilities.subtitle',
              'Track loans and other debts not already reflected in an asset value.',
            )}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title={t('common.refresh', 'Refresh')}>
            <IconButton size="small" onClick={() => void fetchLiabilities()} disabled={loading}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={openNew}>
            {t('investmentsPage.liabilities.add', 'Add liability')}
          </Button>
        </Box>
      </Box>

      <Alert severity="info">
        {t(
          'investmentsPage.liabilities.mortgageNote',
          'Do not add a property mortgage here when the real-estate simulator already reports net equity; that debt is already deducted.',
        )}
      </Alert>
      {error && !editing && <Alert severity="error">{error}</Alert>}
      {loading ? (
        <Skeleton variant="rounded" height={120} />
      ) : liabilities.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          {t('investmentsPage.liabilities.empty', 'No standalone liabilities are tracked.')}
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('investmentsPage.liabilities.fields.name', 'Name')}</TableCell>
                <TableCell>{t('investmentsPage.liabilities.fields.type', 'Type')}</TableCell>
                <TableCell align="right">{t('investmentsPage.liabilities.fields.balance', 'Balance')}</TableCell>
                <TableCell align="right">{t('investmentsPage.liabilities.fields.payment', 'Monthly payment')}</TableCell>
                <TableCell>{t('investmentsPage.liabilities.fields.date', 'As of')}</TableCell>
                <TableCell align="right">{t('investmentsPage.liabilities.actions', 'Actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {liabilities.map((liability) => (
                <TableRow key={liability.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{liability.liability_name}</Typography>
                    {liability.notes && <Typography variant="caption" color="text.secondary">{liability.notes}</Typography>}
                  </TableCell>
                  <TableCell><Chip size="small" label={t(`investmentsPage.liabilities.types.${liability.liability_type}`, liability.liability_type)} /></TableCell>
                  <TableCell align="right">{formatNative(liability, liability.balance)}</TableCell>
                  <TableCell align="right">{liability.monthly_payment == null ? '—' : formatNative(liability, liability.monthly_payment)}</TableCell>
                  <TableCell>{new Date(`${liability.as_of_date}T00:00:00`).toLocaleDateString()}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" aria-label={t('common.edit', 'Edit')} onClick={() => openEdit(liability)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" aria-label={t('common.delete', 'Delete')} onClick={() => setPendingDelete(liability)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={editing !== null} onClose={() => !saving && setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editing === 'new'
            ? t('investmentsPage.liabilities.dialogAdd', 'Add standalone liability')
            : t('investmentsPage.liabilities.dialogEdit', 'Edit liability')}
        </DialogTitle>
        <DialogContent sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5, pt: '12px !important' }}>
          {error && <Alert severity="error" sx={{ gridColumn: '1 / -1' }}>{error}</Alert>}
          <TextField label={t('investmentsPage.liabilities.fields.name', 'Name')} value={draft.liability_name} onChange={(event) => setDraft((current) => ({ ...current, liability_name: event.target.value }))} sx={{ gridColumn: '1 / -1' }} />
          <TextField select label={t('investmentsPage.liabilities.fields.type', 'Type')} value={draft.liability_type} onChange={(event) => setDraft((current) => ({ ...current, liability_type: event.target.value as LiabilityDraft['liability_type'] }))}>
            {(['loan', 'credit_line', 'tax', 'other'] as const).map((type) => <MenuItem key={type} value={type}>{t(`investmentsPage.liabilities.types.${type}`, type)}</MenuItem>)}
          </TextField>
          <TextField label={t('investmentsPage.liabilities.fields.currency', 'Currency')} value={draft.currency} onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} slotProps={{ htmlInput: { maxLength: 3 } }} />
          <TextField type="number" label={t('investmentsPage.liabilities.fields.balance', 'Balance')} value={draft.balance} onChange={(event) => setDraft((current) => ({ ...current, balance: event.target.value }))} slotProps={{ htmlInput: { min: 0, step: 0.01 } }} />
          <TextField type="date" label={t('investmentsPage.liabilities.fields.date', 'As of')} value={draft.as_of_date} onChange={(event) => setDraft((current) => ({ ...current, as_of_date: event.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField type="number" label={t('investmentsPage.liabilities.fields.rate', 'Interest rate %')} value={draft.interest_rate} onChange={(event) => setDraft((current) => ({ ...current, interest_rate: event.target.value }))} slotProps={{ htmlInput: { min: 0, step: 0.01 } }} />
          <TextField type="number" label={t('investmentsPage.liabilities.fields.payment', 'Monthly payment')} value={draft.monthly_payment} onChange={(event) => setDraft((current) => ({ ...current, monthly_payment: event.target.value }))} slotProps={{ htmlInput: { min: 0, step: 0.01 } }} />
          <TextField multiline minRows={2} label={t('investmentsPage.liabilities.fields.notes', 'Notes')} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} sx={{ gridColumn: '1 / -1' }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={saving}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={() => void save()} disabled={saving || !formValid}>{t('common.save', 'Save')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(pendingDelete)} onClose={() => !saving && setPendingDelete(null)}>
        <DialogTitle>{t('investmentsPage.liabilities.removeTitle', 'Stop tracking liability?')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('investmentsPage.liabilities.removeMessage', 'This removes it from tracked net worth. Historical account snapshots are not changed.')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)} disabled={saving}>{t('common.cancel', 'Cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => void deactivate()} disabled={saving}>{t('common.remove', 'Remove')}</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default LiabilitiesManager;
