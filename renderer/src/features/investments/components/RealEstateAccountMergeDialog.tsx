import React, { useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, MenuItem, TextField, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';

interface MergeAccount {
  id?: number;
  account_name: string;
  account_type: string;
  currency: string;
  current_value?: number | null;
  last_update_date?: string | null;
}

interface Props {
  account: MergeAccount;
  accounts: MergeAccount[];
  onClose: () => void;
  onMerged: () => void;
}

export default function RealEstateAccountMergeDialog({ account, accounts, onClose, onMerged }: Props) {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'accountsModal.realEstateMerge' });
  const candidates = accounts.filter((row) => (
    row.id && row.account_type === 'real_estate' && row.currency === account.currency
  ));
  const [targetId, setTargetId] = useState(account.id!);
  const [selectedIds, setSelectedIds] = useState<number[]>(() => candidates
    .filter((row) => row.id === account.id || row.account_name === account.account_name)
    .map((row) => row.id!));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = candidates.filter((row) => selectedIds.includes(row.id!));
  const sourceIds = selectedIds.filter((id) => id !== targetId);
  const total = selected.reduce((sum, row) => sum + (row.current_value ?? 0), 0);
  const formatValue = (value: number) => `${account.currency} ${value.toLocaleString(i18n.language, { maximumFractionDigits: 2 })}`;
  const label = (row: MergeAccount) => `${row.account_name} (#${row.id}) — ${row.current_value == null ? t('notSet') : formatValue(row.current_value)}${row.last_update_date ? ` · ${new Date(row.last_update_date).toLocaleDateString(i18n.language)}` : ''}`;

  const merge = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.post<{ error?: string }>('/api/investments/accounts/merge', {
        target_account_id: targetId,
        source_account_ids: sourceIds,
      });
      if (!response.ok) throw new Error(response.data?.error || t('failed'));
      onMerged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('title')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>{t('description')}</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          select fullWidth label={t('keepAccount')} value={targetId} disabled={saving}
          helperText={t('keepHelper')}
          onChange={(event) => {
            const next = Number(event.target.value);
            setTargetId(next);
            setSelectedIds((ids) => [...new Set([...ids, next])]);
          }}
          sx={{ mt: 1, mb: 2 }}
        >
          {candidates.map((row) => <MenuItem key={row.id} value={row.id}>{label(row)}</MenuItem>)}
        </TextField>
        <Typography variant="subtitle2">{t('selectAccounts')}</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', mb: 2 }}>
          {candidates.map((row) => (
            <FormControlLabel key={row.id} label={label(row)} control={(
              <Checkbox
                checked={selectedIds.includes(row.id!)} disabled={saving || row.id === targetId}
                onChange={(_, checked) => setSelectedIds((ids) => checked
                  ? [...ids, row.id!]
                  : ids.filter((id) => id !== row.id))}
              />
            )} />
          ))}
        </Box>
        <Alert severity="info">
          {selected.some((row) => row.current_value == null)
            ? t('missingValue')
            : t('combinedValue', { value: formatValue(total) })}
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
        <Button variant="contained" onClick={() => void merge()} disabled={saving || sourceIds.length === 0}>
          {saving ? t('merging') : t('merge')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
