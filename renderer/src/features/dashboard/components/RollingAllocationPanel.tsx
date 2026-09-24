import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, FormControlLabel, LinearProgress, Stack, Switch, Typography } from '@mui/material';
import { addDays, format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { apiClient } from '@renderer/lib/api-client';
import SpendingTimeline from '@renderer/features/analysis/components/SpendingTimeline';
import { normalizeTargets } from '@renderer/features/analysis/components/spendingCategoryTargetsHelpers';
import { FINANCIAL_TRUTH_CHANGED_EVENT } from '@renderer/features/financial-truth/types';
import { PLANNING_CHANGED_EVENT } from '@renderer/features/planning/types';
import type { SpendingTimelineResponse } from '@renderer/types/spending-categories';
import { useDashboardFilters } from '../DashboardFiltersContext';

export default function RollingAllocationPanel() {
  const { startDate, endDate } = useDashboardFilters();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.spendingChart' });
  const { formatCurrency } = useFinancePrivacy();
  const [splitBySpendingType, setSplitBySpendingType] = useState(true);
  const [data, setData] = useState<SpendingTimelineResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);
  const start = format(startDate, 'yyyy-MM-dd');
  const end = format(endDate, 'yyyy-MM-dd');

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError(false);
    setData(null);
    try {
      const chunks: SpendingTimelineResponse[] = [];
      // The endpoint accepts at most 366 plotted days per request. Keep longer
      // dashboard ranges intact; each chunk loads its own 29-day lookback.
      for (let chunkStart = start; chunkStart <= end;) {
        const chunkEnd = [format(addDays(parseISO(chunkStart), 365), 'yyyy-MM-dd'), end].sort()[0];
        const params = new URLSearchParams({ rollingDays: '30', startDate: chunkStart, endDate: chunkEnd });
        const response = await apiClient.get<SpendingTimelineResponse>(
          `/api/spending-categories/timeline?${params}`, { cacheMode: 'no-store' });
        if (request !== requestId.current) return;
        if (!response.ok || !Array.isArray(response.data?.points) || !response.data?.targets) {
          throw new Error('Unavailable');
        }
        chunks.push(response.data);
        chunkStart = format(addDays(parseISO(chunkEnd), 1), 'yyyy-MM-dd');
      }
      if (request !== requestId.current) return;
      const result = chunks.length ? {
        ...chunks[0], period: { ...chunks[0].period, end }, points: chunks.flatMap((chunk) => chunk.points),
      } : null;
      setData(result);
      setSelectedDate((previous) => result?.points.some((point) => point.date === previous)
        ? previous : result?.points.at(-1)?.date || '');
    } catch {
      if (request === requestId.current) setError(true);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    void refresh();
    const onRefresh = () => { void refresh(); };
    const onFocus = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('dataRefresh', onRefresh);
    window.addEventListener(PLANNING_CHANGED_EVENT, onRefresh);
    window.addEventListener(FINANCIAL_TRUTH_CHANGED_EVENT, onRefresh);
    window.addEventListener('focus', onFocus);
    return () => {
      ++requestId.current;
      window.removeEventListener('dataRefresh', onRefresh);
      window.removeEventListener(PLANNING_CHANGED_EVENT, onRefresh);
      window.removeEventListener(FINANCIAL_TRUTH_CHANGED_EVENT, onRefresh);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const selected = data?.points.find((point) => point.date === selectedDate) || data?.points.at(-1);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1, alignItems: { sm: 'center' } }}>
        <Box>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>{t('timeline.chartTitle')}</Typography>
          <Typography variant="caption" color="text.secondary">{t('timeline.chartCaption', { days: 30 })}</Typography>
        </Box>
        <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={t('timeline.rolling30')} />
          <FormControlLabel control={<Switch size="small" checked={splitBySpendingType}
            onChange={(_, checked) => setSplitBySpendingType(checked)} />} label={t('timeline.splitBySpendingType')} />
        </Stack>
      </Stack>
      {loading && <LinearProgress aria-label={t('timeline.loading')} />}
      {error && <Alert severity="error" action={<Button color="inherit" onClick={() => void refresh()}>{t('timeline.retry')}</Button>}>{t('timeline.error')}</Alert>}
      {!loading && !error && !selected && <Alert severity="info">{t('timeline.empty')}</Alert>}
      {data && selected && <>
        {!selected.has_income && <Alert severity="info">{t('timeline.noIncome')}</Alert>}
        <SpendingTimeline points={data.points} targets={normalizeTargets(data.targets)} selectedDate={selected.date}
          onSelect={setSelectedDate} splitBySpendingType={splitBySpendingType} />
        <Box>
          <Typography variant="caption" color="text.secondary">{t('timeline.selectedWindow')}: {selected.window_start} – {selected.date}</Typography>
          <Stack direction="row" sx={{ gap: 3, flexWrap: 'wrap', mt: 1 }}>
            {([
              ['income', selected.income, 'success.main'], ['expenses', selected.expenses, 'error.main'],
              [selected.deficit > 0 ? 'deficit' : 'growthUnspent', selected.deficit > 0 ? -selected.deficit : selected.surplus,
                selected.deficit > 0 ? 'error.main' : 'success.main'],
            ] as const).map(([key, amount, color]) => <Box key={key}>
              <Typography variant="caption" color="text.secondary">{t(`timeline.${key}`)}</Typography>
              <Typography variant="body2" sx={{ color, fontWeight: 600 }}>{formatCurrency(amount, { maximumFractionDigits: 2 })}</Typography>
            </Box>)}
          </Stack>
        </Box>
      </>}
    </Stack>
  );
}
