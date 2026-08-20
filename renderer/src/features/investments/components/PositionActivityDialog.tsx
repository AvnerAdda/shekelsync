import React from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import type {
  InvestmentPosition,
  InvestmentPositionEvent,
  InvestmentPositionEventRequest,
} from '@renderer/types/investments';

export type PositionActivityType = InvestmentPositionEventRequest['event_type'];

export interface PositionActivityDraft {
  event_type: PositionActivityType;
  effective_date: string;
  principal_amount: string;
  income_amount: string;
  fee_amount: string;
  tax_amount: string;
  proceeds_amount: string;
  disposed_cost_basis: string;
  units: string;
  current_price: string;
  current_value: string;
  reinvested: boolean;
  deducted_from_position: boolean;
  close_action: 'keep_open' | 'partial_close' | 'full_close';
  notes: string;
}

export type PositionActivityErrors = Partial<Record<keyof PositionActivityDraft, string>>;
export type PositionActivityValidationTranslator = (key: string, fallback: string) => string;

const englishValidationMessage: PositionActivityValidationTranslator = (_key, fallback) => fallback;

interface PositionActivityDialogProps {
  open: boolean;
  position: InvestmentPosition | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

const ACTIVITY_TYPES: PositionActivityType[] = [
  'buy',
  'sell',
  'dividend',
  'interest',
  'fee',
  'tax',
  'valuation',
];

function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function createPositionActivityDraft(): PositionActivityDraft {
  return {
    event_type: 'buy',
    effective_date: today(),
    principal_amount: '',
    income_amount: '',
    fee_amount: '',
    tax_amount: '',
    proceeds_amount: '',
    disposed_cost_basis: '',
    units: '',
    current_price: '',
    current_value: '',
    reinvested: false,
    deducted_from_position: false,
    close_action: 'keep_open',
    notes: '',
  };
}

function isNumberAtLeast(value: string, minimum: number): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= minimum;
}

function validateOptionalNonNegative(
  draft: PositionActivityDraft,
  field: 'units' | 'current_price' | 'current_value' | 'fee_amount' | 'tax_amount',
  errors: PositionActivityErrors,
  translate: PositionActivityValidationTranslator,
): void {
  if (draft[field].trim() && !isNumberAtLeast(draft[field], 0)) {
    errors[field] = translate('numberNonNegative', 'Enter a number that is zero or greater.');
  }
}

export function validatePositionActivityDraft(
  draft: PositionActivityDraft,
  position?: InvestmentPosition | null,
  translate: PositionActivityValidationTranslator = englishValidationMessage,
): PositionActivityErrors {
  const errors: PositionActivityErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effective_date)) {
    errors.effective_date = translate('dateRequired', 'Choose an activity date.');
  } else if (position?.opened_at && draft.effective_date < position.opened_at.slice(0, 10)) {
    errors.effective_date = translate(
      'dateBeforeOpen',
      'Activity cannot be earlier than the holding open date.',
    );
  }

  if (draft.event_type === 'buy' && !isNumberAtLeast(draft.principal_amount, 0.0000001)) {
    errors.principal_amount = translate('investedAmountRequired', 'Enter the invested amount.');
  }
  if (draft.event_type === 'sell') {
    if (!isNumberAtLeast(draft.proceeds_amount, 0)) {
      errors.proceeds_amount = translate(
        'proceedsRequired',
        'Enter the sale proceeds, including zero for a total loss.',
      );
    }
    if (!isNumberAtLeast(draft.disposed_cost_basis, 0)) {
      errors.disposed_cost_basis = translate(
        'disposedBasisRequired',
        'Enter the cost basis disposed by this sale.',
      );
    } else if (
      position
      && Number(draft.disposed_cost_basis) > Number(position.open_cost_basis) + 0.000001
    ) {
      errors.disposed_cost_basis = translate(
        'disposedBasisExceedsOpen',
        'Disposed basis cannot exceed the open cost basis.',
      );
    }
    if (
      draft.units.trim()
      && position?.units != null
      && Number(draft.units) > Number(position.units) + 0.000001
    ) {
      errors.units = translate('unitsExceedOpen', 'Disposed units cannot exceed the open units.');
    }
  }
  if (
    (draft.event_type === 'dividend' || draft.event_type === 'interest')
    && !isNumberAtLeast(draft.income_amount, 0.0000001)
  ) {
    errors.income_amount = translate('incomeRequired', 'Enter the income amount.');
  }
  if (draft.event_type === 'fee' && !isNumberAtLeast(draft.fee_amount, 0.0000001)) {
    errors.fee_amount = translate('feeRequired', 'Enter the fee amount.');
  }
  if (draft.event_type === 'tax' && !isNumberAtLeast(draft.tax_amount, 0.0000001)) {
    errors.tax_amount = translate('taxRequired', 'Enter the tax amount.');
  }
  if (draft.event_type === 'valuation' && !isNumberAtLeast(draft.current_value, 0)) {
    errors.current_value = translate('valueRequired', 'Enter the holding value as of this date.');
  }

  validateOptionalNonNegative(draft, 'units', errors, translate);
  validateOptionalNonNegative(draft, 'current_price', errors, translate);
  validateOptionalNonNegative(draft, 'current_value', errors, translate);
  if (draft.event_type !== 'fee') validateOptionalNonNegative(draft, 'fee_amount', errors, translate);
  if (draft.event_type !== 'tax') validateOptionalNonNegative(draft, 'tax_amount', errors, translate);
  return errors;
}

function addOptionalNumber<T extends object>(target: T, key: string, value: string): void {
  if (value.trim() !== '') {
    Object.assign(target, { [key]: Number(value) });
  }
}

export function buildPositionActivityPayload(
  positionId: number,
  draft: PositionActivityDraft,
): InvestmentPositionEventRequest {
  const payload: InvestmentPositionEventRequest = {
    position_id: positionId,
    event_type: draft.event_type,
    effective_date: draft.effective_date,
    notes: draft.notes.trim() || null,
  };

  if (draft.event_type === 'buy') {
    payload.principal_amount = Number(draft.principal_amount);
    addOptionalNumber(payload, 'units', draft.units);
    addOptionalNumber(payload, 'current_price', draft.current_price);
    addOptionalNumber(payload, 'current_value', draft.current_value);
  } else if (draft.event_type === 'sell') {
    payload.proceeds_amount = Number(draft.proceeds_amount);
    payload.disposed_cost_basis = Number(draft.disposed_cost_basis);
    payload.close_action = draft.close_action;
    addOptionalNumber(payload, 'units', draft.units);
    addOptionalNumber(payload, 'fee_amount', draft.fee_amount);
    addOptionalNumber(payload, 'tax_amount', draft.tax_amount);
    addOptionalNumber(payload, 'current_price', draft.current_price);
    addOptionalNumber(payload, 'current_value', draft.current_value);
  } else if (draft.event_type === 'dividend' || draft.event_type === 'interest') {
    payload.income_amount = Number(draft.income_amount);
    payload.reinvested = draft.reinvested;
    if (draft.reinvested) addOptionalNumber(payload, 'units', draft.units);
    addOptionalNumber(payload, 'current_value', draft.current_value);
  } else if (draft.event_type === 'fee') {
    payload.fee_amount = Number(draft.fee_amount);
    payload.deducted_from_position = draft.deducted_from_position;
    addOptionalNumber(payload, 'current_value', draft.current_value);
  } else if (draft.event_type === 'tax') {
    payload.tax_amount = Number(draft.tax_amount);
    payload.deducted_from_position = draft.deducted_from_position;
    addOptionalNumber(payload, 'current_value', draft.current_value);
  } else {
    payload.current_value = Number(draft.current_value);
    addOptionalNumber(payload, 'units', draft.units);
    addOptionalNumber(payload, 'current_price', draft.current_price);
  }

  return payload;
}

const PositionActivityDialog: React.FC<PositionActivityDialogProps> = ({
  open,
  position,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation('translation');
  const [draft, setDraft] = React.useState<PositionActivityDraft>(createPositionActivityDraft);
  const [submitted, setSubmitted] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [requestError, setRequestError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDraft(createPositionActivityDraft());
    setSubmitted(false);
    setRequestError(null);
  }, [open, position?.id]);

  const translateValidation = React.useCallback<PositionActivityValidationTranslator>(
    (key, fallback) => t(`investmentsPage.holdings.activityDialog.errors.${key}`, fallback),
    [t],
  );
  const errors = React.useMemo(
    () => validatePositionActivityDraft(draft, position, translateValidation),
    [draft, position, translateValidation],
  );
  const valid = Object.keys(errors).length === 0;
  const currency = position?.currency || '';
  const recordFailedMessage = t(
    'investmentsPage.holdings.activityDialog.errors.recordFailed',
    'Failed to record activity',
  );

  const update = <K extends keyof PositionActivityDraft>(field: K, value: PositionActivityDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const save = async () => {
    setSubmitted(true);
    if (!position || !valid) return;

    setSaving(true);
    setRequestError(null);
    try {
      const response = await apiClient.post<{
        position: InvestmentPosition;
        event: InvestmentPositionEvent;
      }>('/api/investments/position-events', buildPositionActivityPayload(position.id, draft));
      if (!response.ok) {
        const body = response.data as { error?: string } | undefined;
        throw new Error(body?.error || response.statusText || recordFailedMessage);
      }
      await onSaved();
      onClose();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : recordFailedMessage);
    } finally {
      setSaving(false);
    }
  };

  const amountLabel = (key: string, fallback: string) => (
    currency ? `${t(key, fallback)} (${currency})` : t(key, fallback)
  );
  const numberProps = { htmlInput: { min: 0, step: 'any' } } as const;

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>{t('investmentsPage.holdings.activityDialog.title', 'Add holding activity')}</DialogTitle>
      <DialogContent
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          gap: 1.5,
          pt: '12px !important',
        }}
      >
        {requestError && <Alert severity="error" sx={{ gridColumn: '1 / -1' }}>{requestError}</Alert>}
        {position && (
          <Box sx={{ gridColumn: '1 / -1' }}>
            <Typography variant="subtitle2">{position.position_name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {position.asset_symbol || position.symbol || position.asset_type || ''}
              {(position.asset_symbol || position.symbol || position.asset_type) && currency ? ' · ' : ''}
              {currency}
            </Typography>
          </Box>
        )}
        <TextField
          select
          label={t('investmentsPage.holdings.activityDialog.type', 'Activity type')}
          value={draft.event_type}
          onChange={(event) => update('event_type', event.target.value as PositionActivityType)}
        >
          {ACTIVITY_TYPES.map((eventType) => (
            <MenuItem key={eventType} value={eventType}>
              {t(`investmentsPage.holdings.activityTypes.${eventType}`, eventType)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          required
          type="date"
          label={t('investmentsPage.holdings.activityDialog.date', 'Activity date')}
          value={draft.effective_date}
          onChange={(event) => update('effective_date', event.target.value)}
          error={submitted && Boolean(errors.effective_date)}
          helperText={submitted ? errors.effective_date : undefined}
          slotProps={{ inputLabel: { shrink: true } }}
        />

        {draft.event_type === 'buy' && (
          <TextField
            required
            type="number"
            label={amountLabel('investmentsPage.holdings.activityDialog.investedAmount', 'Invested amount')}
            value={draft.principal_amount}
            onChange={(event) => update('principal_amount', event.target.value)}
            error={submitted && Boolean(errors.principal_amount)}
            helperText={submitted ? errors.principal_amount : undefined}
            slotProps={numberProps}
          />
        )}
        {draft.event_type === 'sell' && (
          <>
            <TextField
              required
              type="number"
              label={amountLabel('investmentsPage.holdings.activityDialog.proceeds', 'Sale proceeds')}
              value={draft.proceeds_amount}
              onChange={(event) => update('proceeds_amount', event.target.value)}
              error={submitted && Boolean(errors.proceeds_amount)}
              helperText={submitted ? errors.proceeds_amount : undefined}
              slotProps={numberProps}
            />
            <TextField
              required
              type="number"
              label={amountLabel('investmentsPage.holdings.activityDialog.disposedBasis', 'Disposed cost basis')}
              value={draft.disposed_cost_basis}
              onChange={(event) => update('disposed_cost_basis', event.target.value)}
              error={submitted && Boolean(errors.disposed_cost_basis)}
              helperText={submitted ? errors.disposed_cost_basis : undefined}
              slotProps={numberProps}
            />
          </>
        )}
        {(draft.event_type === 'dividend' || draft.event_type === 'interest') && (
          <TextField
            required
            type="number"
            label={amountLabel('investmentsPage.holdings.activityDialog.income', 'Income amount')}
            value={draft.income_amount}
            onChange={(event) => update('income_amount', event.target.value)}
            error={submitted && Boolean(errors.income_amount)}
            helperText={submitted ? errors.income_amount : undefined}
            slotProps={numberProps}
          />
        )}
        {draft.event_type === 'fee' && (
          <TextField
            required
            type="number"
            label={amountLabel('investmentsPage.holdings.activityDialog.fee', 'Fee amount')}
            value={draft.fee_amount}
            onChange={(event) => update('fee_amount', event.target.value)}
            error={submitted && Boolean(errors.fee_amount)}
            helperText={submitted ? errors.fee_amount : undefined}
            slotProps={numberProps}
          />
        )}
        {draft.event_type === 'tax' && (
          <TextField
            required
            type="number"
            label={amountLabel('investmentsPage.holdings.activityDialog.tax', 'Tax amount')}
            value={draft.tax_amount}
            onChange={(event) => update('tax_amount', event.target.value)}
            error={submitted && Boolean(errors.tax_amount)}
            helperText={submitted ? errors.tax_amount : undefined}
            slotProps={numberProps}
          />
        )}

        {(draft.event_type === 'buy'
          || draft.event_type === 'sell'
          || draft.event_type === 'valuation'
          || ((draft.event_type === 'dividend' || draft.event_type === 'interest') && draft.reinvested)) && (
          <TextField
            type="number"
            label={t(
              'investmentsPage.holdings.activityDialog.units',
              draft.event_type === 'valuation' ? 'Units after valuation (optional)' : 'Units (optional)',
            )}
            value={draft.units}
            onChange={(event) => update('units', event.target.value)}
            error={submitted && Boolean(errors.units)}
            helperText={submitted ? errors.units : undefined}
            slotProps={numberProps}
          />
        )}
        {(draft.event_type === 'buy' || draft.event_type === 'sell' || draft.event_type === 'valuation') && (
          <TextField
            type="number"
            label={amountLabel('investmentsPage.holdings.activityDialog.currentPrice', 'Price per unit (optional)')}
            value={draft.current_price}
            onChange={(event) => update('current_price', event.target.value)}
            error={submitted && Boolean(errors.current_price)}
            helperText={submitted ? errors.current_price : undefined}
            slotProps={numberProps}
          />
        )}
        <TextField
          required={draft.event_type === 'valuation'}
          type="number"
          label={amountLabel(
            'investmentsPage.holdings.activityDialog.currentValue',
            draft.event_type === 'valuation' ? 'Holding value' : 'Holding value after activity (optional)',
          )}
          value={draft.current_value}
          onChange={(event) => update('current_value', event.target.value)}
          error={submitted && Boolean(errors.current_value)}
          helperText={submitted ? errors.current_value : undefined}
          slotProps={numberProps}
        />

        {draft.event_type === 'sell' && (
          <>
            <TextField
              type="number"
              label={amountLabel('investmentsPage.holdings.activityDialog.saleFee', 'Sale fee (optional)')}
              value={draft.fee_amount}
              onChange={(event) => update('fee_amount', event.target.value)}
              error={submitted && Boolean(errors.fee_amount)}
              helperText={submitted ? errors.fee_amount : undefined}
              slotProps={numberProps}
            />
            <TextField
              type="number"
              label={amountLabel('investmentsPage.holdings.activityDialog.saleTax', 'Sale tax (optional)')}
              value={draft.tax_amount}
              onChange={(event) => update('tax_amount', event.target.value)}
              error={submitted && Boolean(errors.tax_amount)}
              helperText={submitted ? errors.tax_amount : undefined}
              slotProps={numberProps}
            />
            <TextField
              select
              label={t('investmentsPage.holdings.activityDialog.closeAction', 'Position after sale')}
              value={draft.close_action}
              onChange={(event) => update(
                'close_action',
                event.target.value as PositionActivityDraft['close_action'],
              )}
              sx={{ gridColumn: '1 / -1' }}
            >
              <MenuItem value="keep_open">{t('investmentsPage.holdings.closeActions.keepOpen', 'Keep open')}</MenuItem>
              <MenuItem value="partial_close">{t('investmentsPage.holdings.closeActions.partial', 'Partial sale')}</MenuItem>
              <MenuItem value="full_close">{t('investmentsPage.holdings.closeActions.full', 'Full sale and close')}</MenuItem>
            </TextField>
            {draft.proceeds_amount !== '' && draft.disposed_cost_basis !== '' && (
              <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
                {t('investmentsPage.holdings.activityDialog.estimatedGain', 'Estimated realized gain/loss')}: {' '}
                {Number(draft.proceeds_amount)
                  - Number(draft.disposed_cost_basis)
                  - Number(draft.fee_amount || 0)
                  - Number(draft.tax_amount || 0)} {currency}
              </Typography>
            )}
          </>
        )}

        {(draft.event_type === 'dividend' || draft.event_type === 'interest') && (
          <FormControlLabel
            control={(
              <Checkbox
                checked={draft.reinvested}
                onChange={(event) => update('reinvested', event.target.checked)}
              />
            )}
            label={t('investmentsPage.holdings.activityDialog.reinvested', 'Reinvest this income in the holding')}
            sx={{ gridColumn: '1 / -1' }}
          />
        )}
        {(draft.event_type === 'fee' || draft.event_type === 'tax') && (
          <FormControlLabel
            control={(
              <Checkbox
                checked={draft.deducted_from_position}
                onChange={(event) => update('deducted_from_position', event.target.checked)}
              />
            )}
            label={t(
              'investmentsPage.holdings.activityDialog.deducted',
              'Deduct this amount from the tracked holding value',
            )}
            sx={{ gridColumn: '1 / -1' }}
          />
        )}
        <TextField
          multiline
          minRows={2}
          label={t('investmentsPage.holdings.activityDialog.notes', 'Notes')}
          value={draft.notes}
          onChange={(event) => update('notes', event.target.value)}
          sx={{ gridColumn: '1 / -1' }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
          {draft.event_type === 'dividend' || draft.event_type === 'interest'
            ? t(
                'investmentsPage.holdings.activityDialog.incomeNote',
                'Income is recorded without changing the holding value unless you mark it reinvested or enter a new value.',
              )
            : draft.event_type === 'fee' || draft.event_type === 'tax'
              ? t(
                  'investmentsPage.holdings.activityDialog.deductionNote',
                  'Fees and taxes change the holding value only when explicitly deducted.',
                )
              : t(
                  'investmentsPage.holdings.activityDialog.snapshotNote',
                  'Activity updates this item ledger; it does not overwrite the account valuation snapshot.',
                )}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving || !position}>
          {t('investmentsPage.holdings.activityDialog.save', 'Record activity')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PositionActivityDialog;
