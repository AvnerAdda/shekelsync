import React from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import type {
  InvestmentAccountSummary,
  InvestmentPosition,
  InvestmentPositionMutationRequest,
} from '@renderer/types/investments';

export interface PositionDraft {
  account_id: string;
  position_name: string;
  asset_symbol: string;
  asset_type: string;
  currency: string;
  units: string;
  average_cost: string;
  current_price: string;
  valuation_date: string;
  notes: string;
}

export type PositionDraftErrors = Partial<Record<keyof PositionDraft, string>>;
export type PositionValidationTranslator = (key: string, fallback: string) => string;

const englishValidationMessage: PositionValidationTranslator = (_key, fallback) => fallback;

interface PositionEditorDialogProps {
  open: boolean;
  accounts: InvestmentAccountSummary[];
  position?: InvestmentPosition | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

const ASSET_TYPES = [
  'stock',
  'etf',
  'mutual_fund',
  'bond',
  'cash',
  'crypto',
  'real_estate',
  'pension',
  'other',
] as const;

function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function createPositionDraft(
  accounts: InvestmentAccountSummary[],
  position?: InvestmentPosition | null,
): PositionDraft {
  const defaultAccount = accounts[0];
  return {
    account_id: String(position?.account_id ?? defaultAccount?.id ?? ''),
    position_name: position?.position_name ?? '',
    asset_symbol: position?.asset_symbol ?? position?.symbol ?? '',
    asset_type: position?.asset_type ?? 'stock',
    currency: position?.currency ?? defaultAccount?.currency ?? 'ILS',
    units: String(position?.units ?? 0),
    average_cost: position?.average_cost == null ? '' : String(position.average_cost),
    current_price: position?.current_price == null ? '' : String(position.current_price),
    valuation_date: position?.valuation_date ?? position?.opened_at?.slice(0, 10) ?? today(),
    notes: position?.notes ?? '',
  };
}

function isNonNegativeNumber(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
}

export function validatePositionDraft(
  draft: PositionDraft,
  translate: PositionValidationTranslator = englishValidationMessage,
): PositionDraftErrors {
  const errors: PositionDraftErrors = {};
  if (!/^\d+$/.test(draft.account_id) || Number(draft.account_id) <= 0) {
    errors.account_id = translate('accountRequired', 'Choose an investment account.');
  }
  if (!draft.position_name.trim()) {
    errors.position_name = translate('nameRequired', 'Enter a holding name.');
  }
  if (!/^[A-Za-z]{3}$/.test(draft.currency.trim())) {
    errors.currency = translate('currencyInvalid', 'Use a three-letter currency code.');
  }
  if (!isNonNegativeNumber(draft.units)) {
    errors.units = translate('unitsNonNegative', 'Units must be zero or greater.');
  }
  if (draft.average_cost.trim() && !isNonNegativeNumber(draft.average_cost)) {
    errors.average_cost = translate(
      'averageCostNonNegative',
      'Average cost must be zero or greater.',
    );
  }
  if (draft.current_price.trim() && !isNonNegativeNumber(draft.current_price)) {
    errors.current_price = translate(
      'currentPriceNonNegative',
      'Current price must be zero or greater.',
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.valuation_date)) {
    errors.valuation_date = translate('valuationDateRequired', 'Choose a valuation date.');
  }
  return errors;
}

function optionalNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

export function buildPositionPayload(draft: PositionDraft): InvestmentPositionMutationRequest {
  return {
    account_id: Number(draft.account_id),
    position_name: draft.position_name.trim(),
    asset_symbol: draft.asset_symbol.trim().toUpperCase() || null,
    asset_type: draft.asset_type || null,
    currency: draft.currency.trim().toUpperCase(),
    units: Number(draft.units),
    average_cost: optionalNumber(draft.average_cost),
    current_price: optionalNumber(draft.current_price),
    valuation_date: draft.valuation_date,
    notes: draft.notes.trim() || null,
  };
}

const PositionEditorDialog: React.FC<PositionEditorDialogProps> = ({
  open,
  accounts,
  position,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation('translation');
  const [draft, setDraft] = React.useState<PositionDraft>(() => createPositionDraft(accounts, position));
  const [submitted, setSubmitted] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [requestError, setRequestError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDraft(createPositionDraft(accounts, position));
    setSubmitted(false);
    setRequestError(null);
  }, [accounts, open, position]);

  const translateValidation = React.useCallback<PositionValidationTranslator>(
    (key, fallback) => t(`investmentsPage.holdings.positionDialog.errors.${key}`, fallback),
    [t],
  );
  const errors = React.useMemo(
    () => validatePositionDraft(draft, translateValidation),
    [draft, translateValidation],
  );
  const valid = Object.keys(errors).length === 0;
  const saveFailedMessage = t(
    'investmentsPage.holdings.positionDialog.errors.saveFailed',
    'Failed to save holding',
  );

  const update = (field: keyof PositionDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const selectAccount = (accountId: string) => {
    const account = accounts.find((item) => String(item.id) === accountId);
    setDraft((current) => ({
      ...current,
      account_id: accountId,
      currency: account?.currency || current.currency,
    }));
  };

  const save = async () => {
    setSubmitted(true);
    if (!valid) return;

    setSaving(true);
    setRequestError(null);
    try {
      const payload = buildPositionPayload(draft);
      const response = position
        ? await apiClient.put<{ position: InvestmentPosition }>('/api/investments/positions', {
            ...payload,
            id: position.id,
          })
        : await apiClient.post<{ position: InvestmentPosition }>('/api/investments/positions', payload);
      if (!response.ok) {
        const body = response.data as { error?: string } | undefined;
        throw new Error(body?.error || response.statusText || saveFailedMessage);
      }
      await onSaved();
      onClose();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : saveFailedMessage);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>
        {position
          ? t('investmentsPage.holdings.positionDialog.editTitle', 'Edit holding')
          : t('investmentsPage.holdings.positionDialog.addTitle', 'Add holding')}
      </DialogTitle>
      <DialogContent
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          gap: 1.5,
          pt: '12px !important',
        }}
      >
        {requestError && <Alert severity="error" sx={{ gridColumn: '1 / -1' }}>{requestError}</Alert>}
        <TextField
          select
          required
          disabled={Boolean(position)}
          label={t('investmentsPage.holdings.positionDialog.account', 'Investment account')}
          value={draft.account_id}
          onChange={(event) => selectAccount(event.target.value)}
          error={submitted && Boolean(errors.account_id)}
          helperText={submitted ? errors.account_id : undefined}
          sx={{ gridColumn: '1 / -1' }}
        >
          {accounts.map((account) => (
            <MenuItem key={account.id} value={String(account.id)}>
              {account.account_name} ({account.currency})
            </MenuItem>
          ))}
        </TextField>
        <TextField
          required
          label={t('investmentsPage.holdings.positionDialog.name', 'Holding name')}
          value={draft.position_name}
          onChange={(event) => update('position_name', event.target.value)}
          error={submitted && Boolean(errors.position_name)}
          helperText={submitted ? errors.position_name : undefined}
          sx={{ gridColumn: '1 / -1' }}
        />
        <TextField
          label={t('investmentsPage.holdings.positionDialog.symbol', 'Symbol')}
          value={draft.asset_symbol}
          onChange={(event) => update('asset_symbol', event.target.value.toUpperCase())}
        />
        <TextField
          select
          label={t('investmentsPage.holdings.positionDialog.assetType', 'Asset type')}
          value={draft.asset_type}
          onChange={(event) => update('asset_type', event.target.value)}
        >
          {ASSET_TYPES.map((assetType) => (
            <MenuItem key={assetType} value={assetType}>
              {t(`investmentsPage.holdings.assetTypes.${assetType}`, assetType.replace('_', ' '))}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          required
          label={t('investmentsPage.holdings.positionDialog.currency', 'Currency')}
          value={draft.currency}
          onChange={(event) => update('currency', event.target.value.toUpperCase())}
          error={submitted && Boolean(errors.currency)}
          helperText={submitted ? errors.currency : undefined}
          slotProps={{ htmlInput: { maxLength: 3 } }}
        />
        <TextField
          required
          type="number"
          label={t('investmentsPage.holdings.positionDialog.units', 'Units')}
          value={draft.units}
          onChange={(event) => update('units', event.target.value)}
          error={submitted && Boolean(errors.units)}
          helperText={submitted ? errors.units : undefined}
          slotProps={{ htmlInput: { min: 0, step: 'any' } }}
        />
        <TextField
          type="number"
          label={t('investmentsPage.holdings.positionDialog.averageCost', 'Average cost per unit')}
          value={draft.average_cost}
          onChange={(event) => update('average_cost', event.target.value)}
          error={submitted && Boolean(errors.average_cost)}
          helperText={submitted ? errors.average_cost : undefined}
          slotProps={{ htmlInput: { min: 0, step: 'any' } }}
        />
        <TextField
          type="number"
          label={t('investmentsPage.holdings.positionDialog.currentPrice', 'Current price per unit')}
          value={draft.current_price}
          onChange={(event) => update('current_price', event.target.value)}
          error={submitted && Boolean(errors.current_price)}
          helperText={submitted ? errors.current_price : undefined}
          slotProps={{ htmlInput: { min: 0, step: 'any' } }}
        />
        <TextField
          required
          type="date"
          label={t('investmentsPage.holdings.positionDialog.valuationDate', 'Valuation date')}
          value={draft.valuation_date}
          onChange={(event) => update('valuation_date', event.target.value)}
          error={submitted && Boolean(errors.valuation_date)}
          helperText={submitted ? errors.valuation_date : undefined}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          multiline
          minRows={2}
          label={t('investmentsPage.holdings.positionDialog.notes', 'Notes')}
          value={draft.notes}
          onChange={(event) => update('notes', event.target.value)}
          sx={{ gridColumn: '1 / -1' }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
          {t(
            'investmentsPage.holdings.positionDialog.snapshotNote',
            'This tracks the item inside the account. The account valuation snapshot remains unchanged.',
          )}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving}>
          {t('common.save', 'Save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PositionEditorDialog;
