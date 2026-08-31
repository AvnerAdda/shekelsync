import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Snackbar,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useFinancialTruth } from './useFinancialTruth';
import type { CorrectionAction, CorrectionDraft, CorrectionPreview, CorrectionTarget } from './types';
import { toLocalDateInputValue } from './local-date';

interface Props {
  open: boolean;
  target: CorrectionTarget | null;
  sourceFeature: string;
  sourceKey?: string;
  onClose: () => void;
  onApplied?: (patternId?: number, action?: CorrectionAction) => void;
}

const PATTERN_ACTIONS: Array<{ value: CorrectionAction; labelKey: string; hintKey: string }> = [
  { value: 'skip_occurrence', labelKey: 'skipOccurrence', hintKey: 'skipOccurrenceHint' },
  { value: 'suppress_pattern', labelKey: 'suppressPattern', hintKey: 'suppressPatternHint' },
  { value: 'end_pattern', labelKey: 'endPattern', hintKey: 'endPatternHint' },
  { value: 'pause_pattern', labelKey: 'pausePattern', hintKey: 'pausePatternHint' },
  { value: 'override_pattern', labelKey: 'overridePattern', hintKey: 'overridePatternHint' },
];

const FinancialCorrectionDialog: React.FC<Props> = ({
  open,
  target,
  sourceFeature,
  sourceKey,
  onClose,
  onApplied,
}) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { t } = useTranslation();
  const { formatCurrency } = useFinancePrivacy();
  const truth = useFinancialTruth();
  const isCategory = target?.kind === 'category';
  const defaultAction: CorrectionAction = isCategory ? 'set_category_expectation' : target?.occurrenceId ? 'skip_occurrence' : 'suppress_pattern';
  const [action, setAction] = useState<CorrectionAction>(defaultAction);
  const [effectiveDate, setEffectiveDate] = useState(() => toLocalDateInputValue());
  const [amount, setAmount] = useState<number | ''>('');
  const [frequency, setFrequency] = useState(target?.frequency || 'monthly');
  const [nextExpectedDate, setNextExpectedDate] = useState(target?.nextExpectedDate || '');
  const [ongoing, setOngoing] = useState(false);
  const [notSubscription, setNotSubscription] = useState(false);
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!open || !target) return;
    setAction(target.kind === 'category' ? 'set_category_expectation' : target.occurrenceId ? 'skip_occurrence' : 'suppress_pattern');
    setAmount(target.amount ?? '');
    setFrequency(target.frequency || 'monthly');
    setNextExpectedDate(target.nextExpectedDate || '');
    setEffectiveDate(toLocalDateInputValue());
    setOngoing(false);
    setNotSubscription(false);
    setPreview(null);
  }, [open, target]);

  const availableActions = useMemo(() => PATTERN_ACTIONS.filter((option) => (
    option.value !== 'skip_occurrence' || Boolean(target?.occurrenceId)
  )).filter((option) => !target?.capabilities || target.capabilities.includes(option.value)), [target]);

  const buildDraft = (): CorrectionDraft | null => {
    if (!target) return null;
    const scope = action === 'skip_occurrence'
      ? 'occurrence'
      : action === 'end_pattern'
        ? 'from_date'
        : action === 'set_category_expectation'
          ? ongoing ? 'ongoing' : 'current_month'
          : 'ongoing';
    return {
      target: {
        kind: target.kind,
        patternId: target.patternId,
        occurrenceId: target.occurrenceId,
        categoryDefinitionId: target.categoryDefinitionId,
      },
      action,
      scope,
      effectiveDate: action === 'end_pattern' || action === 'set_category_expectation' ? effectiveDate : undefined,
      reasonCode: action,
      source: { feature: sourceFeature, sourceKey },
      overrides: action === 'override_pattern'
        ? {
          amount: amount === '' ? undefined : Number(amount),
          frequency,
          nextExpectedDate: nextExpectedDate || undefined,
          isSubscription: notSubscription ? false : undefined,
        }
        : action === 'set_category_expectation'
          ? { monthlyAmount: amount === '' ? 0 : Number(amount) }
          : {},
    };
  };

  useEffect(() => {
    if (!open || !target) return;
    const draft = buildDraft();
    if (!draft || (action === 'set_category_expectation' && amount === '')
      || (action === 'override_pattern' && amount === '' && !notSubscription)) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setPreviewLoading(true);
      truth.preview(draft)
        .then((result) => { if (active) setPreview(result); })
        .catch(() => { if (active) setPreview(null); })
        .finally(() => { if (active) setPreviewLoading(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
    // buildDraft deliberately reflects the primitive controls below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target, action, amount, frequency, nextExpectedDate, effectiveDate, ongoing, notSubscription]);

  const submit = async () => {
    const draft = buildDraft();
    if (!draft) return;
    try {
      await truth.create(draft);
      onApplied?.(target?.patternId, action);
      onClose();
    } catch {
      // useFinancialTruth owns the user-facing error state.
    }
  };

  const undoLastCorrection = async () => {
    if (!truth.lastCorrection) return;
    try {
      await truth.revert(truth.lastCorrection.id);
    } catch {
      // Keep the Snackbar open and let useFinancialTruth retain the error.
    }
  };

  return (
    <>
      <Dialog open={open} onClose={truth.busy ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
        <DialogTitle>{t('financialTruth.correctTitle', 'Correct this prediction')}</DialogTitle>
        <DialogContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{target?.title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            {t('financialTruth.correctDescription', 'Your choice becomes shared financial truth across every connected forecast and insight.')}
          </Typography>

          {isCategory ? (
            <Stack spacing={2}>
              <TextField
                type="number"
                label={t('financialTruth.monthlyExpectation', 'Expected monthly amount')}
                value={amount}
                onChange={(event) => setAmount(event.target.value === '' ? '' : Number(event.target.value))}
                slotProps={{ htmlInput: { min: 0 } }}
                fullWidth
              />
              <FormControl>
                <RadioGroup row value={ongoing ? 'ongoing' : 'current_month'} onChange={(_, value) => setOngoing(value === 'ongoing')}>
                  <FormControlLabel value="current_month" control={<Radio />} label={t('financialTruth.thisMonth', 'This month')} />
                  <FormControlLabel value="ongoing" control={<Radio />} label={t('financialTruth.ongoing', 'Ongoing')} />
                </RadioGroup>
              </FormControl>
            </Stack>
          ) : (
            <FormControl fullWidth>
              <RadioGroup value={action} onChange={(_, value) => setAction(value as CorrectionAction)}>
                {availableActions.map((option) => (
                  <Box key={option.value} sx={{ border: '1px solid', borderColor: action === option.value ? 'primary.main' : 'divider', borderRadius: 2, px: 1.25, py: 0.5, mb: 1 }}>
                    <FormControlLabel value={option.value} control={<Radio />} label={t(`financialTruth.actions.${option.labelKey}`)} />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4.5, mt: -0.75, mb: 0.75 }}>{t(`financialTruth.actions.${option.hintKey}`)}</Typography>
                  </Box>
                ))}
              </RadioGroup>
            </FormControl>
          )}

          {action === 'end_pattern' && (
            <TextField type="date" label={t('financialTruth.endedOn', 'Ended on')} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} sx={{ mt: 1 }} />
          )}
          {action === 'override_pattern' && (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField type="number" label={t('financialTruth.amount', 'Amount')} value={amount} onChange={(event) => setAmount(event.target.value === '' ? '' : Number(event.target.value))} slotProps={{ htmlInput: { min: 0 } }} fullWidth />
              <FormControl fullWidth>
                <InputLabel>{t('financialTruth.frequency', 'Frequency')}</InputLabel>
                <Select label={t('financialTruth.frequency', 'Frequency')} value={frequency} onChange={(event) => setFrequency(String(event.target.value))}>
                  {['daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'yearly'].map((value) => (
                    <MenuItem key={value} value={value}>
                      {t(`analysisPage.subscriptions.frequency.${value}`, value)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              </Stack>
              <TextField
                type="date"
                label={t('financialTruth.nextExpectedDate', 'Next expected date')}
                value={nextExpectedDate}
                onChange={(event) => setNextExpectedDate(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
              {target?.isSubscription && (
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={notSubscription}
                      onChange={(event) => setNotSubscription(event.target.checked)}
                    />
                  )}
                  label={t(
                    'financialTruth.notSubscription',
                    'This is a recurring expense, but not a subscription (keep it in the forecast)',
                  )}
                />
              )}
            </Stack>
          )}

          <Box aria-live="polite" sx={{ mt: 2, minHeight: 76 }}>
            {previewLoading ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><CircularProgress size={18} /><Typography variant="body2">{t('financialTruth.calculating', 'Calculating impact…')}</Typography></Stack> : preview ? (
              <Alert severity="info" icon={false}>
                <Typography variant="subtitle2">{t('financialTruth.impactTitle', 'What will change')}</Typography>
                <Typography variant="body2">
                  {t('financialTruth.impactValues', 'Estimated impact: {{monthly}} per month · {{sixMonth}} over six months', {
                    monthly: formatCurrency(preview.impact.monthlyDelta),
                    sixMonth: formatCurrency(preview.impact.sixMonthDelta),
                  })}
                </Typography>
                <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                  {preview.impact.affectedSurfaces.slice(0, 5).map((surface) => <Chip key={surface} size="small" label={surface} />)}
                </Stack>
              </Alert>
            ) : null}
          </Box>
          {truth.error && <Alert severity="error" sx={{ mt: 1 }}>{truth.error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={truth.busy}>{t('actions.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={() => void submit()} disabled={truth.busy || !preview} startIcon={truth.busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
            {t('financialTruth.apply', 'Apply correction')}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={Boolean(truth.lastCorrection) && !open}
        autoHideDuration={8000}
        onClose={truth.clearLastCorrection}
        message={t('financialTruth.saved', 'Correction saved. Updating your plan…')}
        action={<Button color="inherit" size="small" disabled={truth.busy} onClick={() => void undoLastCorrection()}>{t('actions.undo', 'Undo')}</Button>}
      />
    </>
  );
};

export default FinancialCorrectionDialog;
