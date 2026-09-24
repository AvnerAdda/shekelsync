import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, alpha, Box, Button, Chip, Grid, LinearProgress, MenuItem, Paper, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@renderer/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { FINANCIAL_TRUTH_CHANGED_EVENT } from '@renderer/features/financial-truth/types';
import { PLANNING_CHANGED_EVENT } from '@renderer/features/planning/types';
import type { SpendingAllocation, SpendingTimelineResponse } from '@renderer/types/spending-categories';
import SpendingTimeline, { ALLOCATION_COLORS, ALLOCATION_ORDER } from './SpendingTimeline';
import SpendingCategoryTargetsMinimal from './SpendingCategoryTargetsMinimal';
import SpendingCategoryTransactionsModal from './SpendingCategoryTransactionsModal';
import { normalizeTargets } from './spendingCategoryTargetsHelpers';

export default function SpendingCategoriesChart({ months = 3 }: { months?: number }) {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.spendingChart' });
  const { formatCurrency } = useFinancePrivacy();
  const [rollingDays, setRollingDays] = useState(30);
  const [historyDays, setHistoryDays] = useState(Math.min(366, Math.max(30, months * 30)));
  const [data, setData] = useState<SpendingTimelineResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<SpendingAllocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError(false);
    try {
      const response = await apiClient.get<SpendingTimelineResponse>(
        `/api/spending-categories/timeline?rollingDays=${rollingDays}&historyDays=${historyDays}`, { cacheMode: 'no-store' });
      if (!response.ok || !Array.isArray(response.data?.points) || !response.data?.targets) throw new Error('Unavailable');
      if (request !== requestId.current) return;
      setData(response.data);
      setSelectedDate((previous) => response.data.points.some((point) => point.date === previous)
        ? previous : response.data.points.at(-1)?.date || '');
    } catch {
      if (request === requestId.current) { setData(null); setError(true); }
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [rollingDays, historyDays]);

  useEffect(() => {
    setData(null);
    void refresh();
    const onRefresh = () => { void refresh(); };
    const onFocus = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('dataRefresh', onRefresh);
    window.addEventListener(PLANNING_CHANGED_EVENT, onRefresh);
    window.addEventListener(FINANCIAL_TRUTH_CHANGED_EVENT, onRefresh);
    window.addEventListener('focus', onFocus);
    return () => {
      // Invalidate in-flight requests when this range is no longer displayed.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++requestId.current;
      window.removeEventListener('dataRefresh', onRefresh);
      window.removeEventListener(PLANNING_CHANGED_EVENT, onRefresh);
      window.removeEventListener(FINANCIAL_TRUTH_CHANGED_EVENT, onRefresh);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const selected = data?.points.find((point) => point.date === selectedDate) || data?.points.at(-1);
  const targets = normalizeTargets(data?.targets);
  const dateLabel = (date: string) => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`));
  const rangeLabel = selected ? `${dateLabel(selected.window_start)} – ${dateLabel(selected.date)}` : '';
  const chooseRange = (_: unknown, value: number | null) => { if (value) { setSelectedCategory(null); setRollingDays(value); } };

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 2, alignItems: { md: 'center' } }}>
        <Box sx={{ maxWidth: 490 }}>
          <Typography variant="h5" component="h2" sx={{ fontWeight: 750, letterSpacing: '-0.025em', mb: 0.5 }}>{t('timeline.title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('timeline.subtitle', { days: rollingDays })}</Typography>
        </Box>
        <Stack direction="row" sx={{ gap: 1.5, alignItems: 'end', flexWrap: 'wrap', flexShrink: 0 }}>
          <Box>
            <Typography variant="caption" component="p" color="text.secondary" sx={{ mb: 0.75 }}>{t('timeline.rollingWindow')}</Typography>
            <ToggleButtonGroup exclusive value={rollingDays} onChange={chooseRange} size="small" aria-label={t('timeline.rollingWindow')}
              sx={{ bgcolor: 'background.paper', p: 0.5, borderRadius: 2, border: '1px solid', borderColor: 'divider',
                '& .MuiToggleButton-root': { border: 0, borderRadius: '8px !important', px: 1.5, py: 0.5 },
                '& .Mui-selected': { bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } } }}>
              {[30, 60, 90].map((days) => <ToggleButton key={days} value={days}>{t('timeline.days', { days })}</ToggleButton>)}
            </ToggleButtonGroup>
          </Box>
          <TextField select size="small" label={t('timeline.history')} value={historyDays}
            onChange={(event) => { setSelectedCategory(null); setHistoryDays(Number(event.target.value)); }}
            sx={{ minWidth: 135, bgcolor: 'background.paper', borderRadius: 2 }}>
            {[30, 90, 180, 365].map((days) => <MenuItem key={days} value={days}>{t('timeline.days', { days })}</MenuItem>)}
          </TextField>
        </Stack>
      </Stack>
      {loading && <LinearProgress aria-label={t('timeline.loading')} sx={{ borderRadius: 1 }} />}
      {error && <Alert severity="error" action={<Button color="inherit" onClick={() => void refresh()}>{t('timeline.retry')}</Button>}>{t('timeline.error')}</Alert>}
      {data && selected && <>
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ px: 2.5, pt: 2, gap: 1, justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>{t('timeline.selectedWindow')}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{rangeLabel}</Typography>
          </Stack>
          <Grid container>
            {([
              ['income', selected.income, 'success.main'], ['expenses', -selected.expenses, 'text.primary'],
              [selected.deficit > 0 ? 'deficit' : 'growthRemainder', selected.deficit > 0 ? -selected.deficit : selected.surplus,
                selected.deficit > 0 ? 'error.main' : 'primary.main'],
            ] as const).map(([key, amount, color], index) => <Grid key={key} size={{ xs: 12, sm: 4 }}>
              <Box data-testid={`spending-summary-${key}`} sx={{ px: 2.5, py: 2,
                borderInlineStartWidth: { sm: index > 0 ? 1 : 0 }, borderInlineStartStyle: { sm: 'solid' }, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary">{t(`timeline.${key}`)}</Typography>
                <Typography variant="h4" sx={{ color, fontWeight: 700, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums', my: 0.5, fontSize: { xs: 28, lg: 32 } }}>
                  {formatCurrency(amount, { maximumFractionDigits: 2, showSign: true })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {key === 'income' ? (selected.has_income ? t('timeline.incomeBase') : t('timeline.noIncomeRow'))
                    : key === 'expenses' ? t('timeline.expenseShare', { value: selected.has_income ? (selected.expenses / selected.income * 100).toFixed(1) : '—' })
                      : selected.deficit > 0 ? t('timeline.deficitHelp') : t('timeline.remainderHelp')}
                </Typography>
              </Box>
            </Grid>)}
          </Grid>
        </Paper>
        {!selected.has_income && <Alert severity="info">{t('timeline.noIncome')}</Alert>}
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, borderRadius: 3 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 2 }}>
            <Box>
              <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>{t('timeline.chartTitle')}</Typography>
              <Typography variant="caption" color="text.secondary">{t('timeline.chartCaption', { days: rollingDays })}</Typography>
            </Box>
            <Chip label={t(selected.has_income ? 'timeline.incomeBase' : 'timeline.noIncomeRow')} size="small" variant="outlined" sx={{ flexShrink: 0, color: 'text.secondary' }} />
          </Stack>
          <SpendingTimeline points={data.points} targets={targets} selectedDate={selected.date} onSelect={setSelectedDate} />
        </Paper>
        <Box>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 2, mb: 1.5 }}>
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>{t('timeline.allocationTitle')}</Typography>
            <Typography variant="caption" color="text.secondary">{t('timeline.detailsHint')}</Typography>
          </Stack>
          <Grid container spacing={1.5}>
            {ALLOCATION_ORDER.filter((key) => key !== 'unallocated' || selected.transaction_counts.unallocated > 0).map((key) => <Grid key={key} size={{ xs: 12, sm: 6, lg: key === 'unallocated' ? 12 : 3 }}>
              <Box component="button" type="button" onClick={() => setSelectedCategory(key)}
                aria-label={t('timeline.openCategory', { category: t(`categories.${key}`) })}
                sx={{ width: '100%', height: '100%', bgcolor: 'background.paper', textAlign: 'start', cursor: 'pointer',
                  color: 'text.primary', border: '1px solid', borderColor: 'divider', borderRadius: 2.5, p: 2,
                  transition: 'border-color 150ms, box-shadow 150ms',
                  '&:hover': { borderColor: ALLOCATION_COLORS[key], boxShadow: `0 4px 16px ${alpha(ALLOCATION_COLORS[key], 0.1)}` },
                  '&:focus-visible': { outline: `2px solid ${ALLOCATION_COLORS[key]}` } }}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 8, height: 8, bgcolor: ALLOCATION_COLORS[key], borderRadius: '50%' }} />
                  <Typography variant="body2" sx={{ fontWeight: 650, flex: 1 }}>{t(`categories.${key}`)}</Typography>
                  <ArrowOutwardIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1, mt: 1.5, mb: 0.5 }}>
                  <Typography variant="h5" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{selected.percentages[key] == null ? '—' : `${selected.percentages[key].toFixed(1)}%`}</Typography>
                  <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(selected.allocation_amounts[key], { maximumFractionDigits: 2 })}</Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" component="p">
                  {key === 'unallocated' ? t('timeline.unallocatedHelp') : t('labels.target', { value: targets[key] })}
                </Typography>
                {key === 'growth' && <Box sx={{ borderTop: '1px solid', borderColor: 'divider', mt: 1.5, pt: 1 }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary">{t('timeline.growthSpent')}</Typography>
                    <Typography variant="caption">{formatCurrency(selected.expense_amounts.growth, { maximumFractionDigits: 2 })}</Typography>
                  </Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary">{t('timeline.growthUnspent')}</Typography>
                    <Typography variant="caption">{formatCurrency(selected.surplus, { maximumFractionDigits: 2 })}</Typography>
                  </Stack>
                </Box>}
              </Box>
            </Grid>)}
          </Grid>
        </Box>
        <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '16px !important', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} data-testid="spending-targets-toggle" sx={{ px: 2.5, py: 0.5 }}>
            <Box><Typography variant="subtitle2">{t('timeline.targetsTitle')}</Typography><Typography variant="caption" color="text.secondary">{t('timeline.targetsHelp')}</Typography></Box>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 2.5, pb: 2.5 }}><SpendingCategoryTargetsMinimal data={data} income={selected.income} onDataChanged={refresh} /></AccordionDetails>
        </Accordion>
        <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}><Typography variant="caption" color="text.secondary">{t('timeline.calculationTitle')}</Typography></AccordionSummary>
          <AccordionDetails sx={{ px: 0 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('timeline.chartHelp')}</Typography>
            <Typography variant="body2" color="text.secondary">{t('timeline.accounting')}</Typography>
          </AccordionDetails>
        </Accordion>
        <SpendingCategoryTransactionsModal open={selectedCategory !== null} onClose={() => setSelectedCategory(null)}
          spendingCategory={selectedCategory} categoryLabel={selectedCategory ? t(`categories.${selectedCategory}`) : ''}
          timeRangeLabel={rangeLabel} periodStart={selected.window_start} periodEnd={selected.date} incomeBasis
          onDataChanged={() => { void refresh(); }} />
      </>}
    </Stack>
  );
}
