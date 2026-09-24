import { useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, Paper, Skeleton, Stack, Switch, TextField, Typography,
} from '@mui/material';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { apiClient } from '@renderer/lib/api-client';
import { toLocalDateInputValue } from '@renderer/features/financial-truth/local-date';
import { PLANNING_CHANGED_EVENT, type PlanningProjection } from '../types';
import { usePlanningData } from '../hooks/usePlanningData';
import { usePlanningResource } from '../hooks/usePlanningResource';

async function loadProjection(): Promise<PlanningProjection> {
  const response = await apiClient.get<PlanningProjection>('/api/planning/projection', { cacheMode: 'no-store' });
  if (!response.ok || !['ready', 'incomplete'].includes(response.data?.status || '')) throw new Error('Unavailable');
  return response.data;
}

export default function SpendabilityCard({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'planning.spendability' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const planning = usePlanningData();
  const forecast = usePlanningResource(loadProjection);
  const projection = forecast.data;
  const settings = planning.data?.settings;
  const loading = planning.loading || forecast.loading;
  const error = planning.error || forecast.error;
  const refresh = () => Promise.all([planning.refresh(), forecast.refresh()]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [buffer, setBuffer] = useState('0');
  const [incomeDate, setIncomeDate] = useState('');
  const [commitments, setCommitments] = useState('');
  const [overrideIncome, setOverrideIncome] = useState(false);
  const [overrideCards, setOverrideCards] = useState(false);
  const [purchase, setPurchase] = useState('');

  const openSettings = () => {
    setBuffer(String(settings?.cash_buffer ?? 0));
    setIncomeDate(projection?.next_income_date ?? '');
    setOverrideIncome(projection?.next_income_source === 'manual');
    setCommitments(projection?.card_commitments == null ? '' : String(projection.card_commitments));
    setOverrideCards(projection?.card_commitments_source === 'manual');
    setSaveError(false);
    setOpen(true);
  };
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minimumDate = toLocalDateInputValue(tomorrow);
  const horizonEnd = new Date();
  horizonEnd.setDate(horizonEnd.getDate() + 180);
  const maximumDate = toLocalDateInputValue(horizonEnd);
  const bufferValue = Number(buffer);
  const commitmentsValue = Number(commitments);
  const valid = buffer.trim() !== '' && Number.isFinite(bufferValue) && bufferValue >= 0
    && bufferValue <= 1e9 && (!overrideIncome || (incomeDate >= minimumDate && incomeDate <= maximumDate))
    && (!overrideCards || (commitments.trim() !== '' && Number.isFinite(commitmentsValue) && commitmentsValue >= 0 && commitmentsValue <= 1e9));
  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setSaveError(false);
    try {
      const response = await apiClient.put('/api/planning/settings', {
        cash_buffer: bufferValue,
        next_income_date: overrideIncome ? incomeDate : null,
        card_commitments_amount: overrideCards ? commitmentsValue : null,
      });
      if (!response.ok) throw new Error('Could not save');
      setOpen(false);
      window.dispatchEvent(new Event(PLANNING_CHANGED_EVENT));
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };
  const ready = !loading && !error && projection?.status === 'ready'
    && typeof projection.available_spend === 'number' && Number.isFinite(projection.available_spend);
  const dateLabel = (value: string | null | undefined) => value
    ? new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(`${value}T12:00:00`))
    : '—';
  const purchaseValue = Number(purchase);
  const purchaseValid = purchase.trim() !== '' && Number.isFinite(purchaseValue) && purchaseValue > 0;
  const purchaseFits = ready && purchaseValue <= (projection?.available_spend ?? 0);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }} data-testid="spendability-card">
      <Stack spacing={2}>
        <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <SavingsOutlinedIcon color="primary" />
              <Typography variant="h6" component="h2">{t('title')}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">{t('subtitle')}</Typography>
          </Box>
          <Button onClick={openSettings} disabled={loading || !settings} size="small">{t('settings')}</Button>
        </Stack>
        {loading ? <Skeleton height={72} /> : error ? (
          <Alert severity="warning" action={<Button color="inherit" onClick={() => void refresh()}>{t('retry')}</Button>}>
            {t('loadError')}
          </Alert>
        ) : ready ? (
          <Box aria-live="polite">
            <Typography variant={compact ? 'h4' : 'h3'} component="p" sx={{ fontWeight: 700 }}>
              {formatCurrency(projection.available_spend)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t(projection.next_income_date ? 'until' : 'rollingUntil', { date: dateLabel(projection.next_income_date || projection.spending_period_end) })}
            </Typography>
            {projection.spending_source === 'recent_spending' && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t('recentSpendingHelp', { days: projection.spending_history_days })}
              </Typography>
            )}
            {Boolean(projection.shortfall && projection.shortfall > 0) && (
              <Alert severity="warning" sx={{ mt: 1 }}>{t('shortfall', { amount: formatCurrency(projection.shortfall) })}</Alert>
            )}
          </Box>
        ) : (
          <Alert severity="info">
            <Typography sx={{ fontWeight: 600 }}>{t('incomplete')}</Typography>
            {(projection?.reasons || []).map((reason) => (
              <Typography key={reason.code} variant="body2">{t(`reasons.${reason.code}`, { defaultValue: reason.message })}</Typography>
            ))}
          </Alert>
        )}
        {ready && (
          <Typography variant="caption" color="text.secondary">
            {t(projection.next_income_source === 'manual' ? 'manualIncome' : projection.next_income_date ? 'detectedIncome' : 'rollingHelp')}
            {' '}{t(projection.card_commitments_source === 'manual' ? 'manualCards'
              : projection.card_commitments_source === 'estimated' ? 'estimatedCards' : 'detectedCards')}
          </Typography>
        )}
        {ready && !compact && (
          <>
            <Divider />
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: '1fr auto', gap: 1 }}>
              {([
                ['balance', projection.cash_balance], ['expenses', projection.forecast_expenses_until_income],
                ['commitments', projection.card_commitments], ['reserved', projection.reserved_cash],
                ['contributions', projection.planned_contributions], ['buffer', projection.cash_buffer],
              ] as const).map(([label, value]) => (
                <Box key={label} sx={{ display: 'contents' }}>
                  <Typography component="dt" variant="body2" color="text.secondary">{t(label)}</Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0 }}>{formatCurrency(value)}</Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary">{t('asOf', { date: dateLabel(projection.latest_balance_date) })}</Typography>
            <TextField
              label={t('purchase')} value={purchase} onChange={(event) => setPurchase(event.target.value)}
              type={maskAmounts ? 'password' : 'number'} autoComplete="off" size="small" slotProps={{ htmlInput: { min: 0, step: '0.01', inputMode: 'decimal' } }}
            />
            {purchaseValid && (
              <Alert severity={purchaseFits ? 'info' : 'warning'}>
                {purchaseFits
                  ? t('purchaseFits', { amount: formatCurrency((projection.available_spend ?? 0) - purchaseValue) })
                  : t('purchaseExceeds', { amount: formatCurrency(purchaseValue - (projection.available_spend ?? 0)) })}
              </Alert>
            )}
          </>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1, alignItems: { sm: 'center' } }}>
          <Typography variant="caption" color="text.secondary">{t('assumption')}</Typography>
          {compact ? (
            <Button component={RouterLink} to="/plan?tab=planning" sx={{ flexShrink: 0 }}>{t('openPlan')}</Button>
          ) : <Chip label={t(projection?.spending_source === 'recent_spending' ? 'recentSpendingEstimate' : 'estimate')} size="small" variant="outlined" sx={{ alignSelf: 'flex-start' }} />}
        </Stack>
      </Stack>
      <Dialog open={open} onClose={() => { if (!saving) setOpen(false); }} fullWidth maxWidth="sm">
        <DialogTitle>{t('settingsTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {saveError && <Alert severity="error">{t('saveError')}</Alert>}
            <Typography variant="body2" color="text.secondary">{t('automaticHelp')}</Typography>
            <TextField label={t('buffer')} type={maskAmounts ? 'password' : 'number'} autoComplete="off" value={buffer} onChange={(e) => setBuffer(e.target.value)}
              slotProps={{ htmlInput: { min: 0, step: '0.01' } }} helperText={t('bufferHelp')} />
            <FormControlLabel control={<Switch checked={overrideIncome} onChange={(e) => setOverrideIncome(e.target.checked)} />} label={t('overrideIncome')} />
            {overrideIncome && <TextField label={t('nextIncome')} type="date" value={incomeDate} onChange={(e) => setIncomeDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: minimumDate, max: maximumDate } }} helperText={t('nextIncomeHelp')} />}
            <FormControlLabel control={<Switch checked={overrideCards} onChange={(e) => setOverrideCards(e.target.checked)}
              disabled={projection?.cash_balance == null} />} label={t('overrideCards')} />
            {overrideCards && (
              <TextField label={t('commitments')} type={maskAmounts ? 'password' : 'number'} autoComplete="off" value={commitments} onChange={(e) => setCommitments(e.target.value)}
                slotProps={{ htmlInput: { min: 0, step: '0.01' } }} helperText={t('commitmentsHelp')} required />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={saving}>{t('cancel')}</Button>
          <Button variant="contained" onClick={() => void save()} disabled={saving || !valid}>{t(saving ? 'saving' : 'save')}</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
