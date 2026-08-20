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
  Paper,
  Skeleton,
  TextField,
  Typography,
} from '@mui/material';
import AddChartIcon from '@mui/icons-material/Addchart';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { apiClient } from '@/lib/api-client';
import type {
  InvestmentBenchmark,
  InvestmentBenchmarkPoint,
  InvestmentPerformanceResponse,
} from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';

interface BenchmarkComparisonPanelProps {
  performance: InvestmentPerformanceResponse | null;
}

interface BenchmarkComparisonResponse {
  status: 'ok' | 'unavailable';
  reason: string | null;
  benchmark: InvestmentBenchmark | null;
  startDate?: string;
  endDate?: string;
  startObservationDate?: string;
  endObservationDate?: string;
  return?: number;
  nativeReturn?: number;
  returnCurrency?: string;
  currencyAdjusted?: boolean;
  points?: InvestmentBenchmarkPoint[];
}

function parsePoints(raw: string): InvestmentBenchmarkPoint[] {
  const points = new Map<string, number>();
  raw.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const [dateValue, numberValue] = trimmed.split(/[;,\t]/).map((value) => value.trim());
    if (index === 0 && /date/i.test(dateValue) && /value|close|index/i.test(numberValue || '')) return;
    const date = String(dateValue || '').slice(0, 10);
    const value = Number(numberValue);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 0) {
      points.set(date, value);
    }
  });
  return Array.from(points.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

const BenchmarkComparisonPanel: React.FC<BenchmarkComparisonPanelProps> = ({ performance }) => {
  const { t } = useTranslation('translation');
  const [benchmarks, setBenchmarks] = React.useState<InvestmentBenchmark[]>([]);
  const [comparison, setComparison] = React.useState<BenchmarkComparisonResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({
    name: '',
    currency: 'ILS',
    source: '',
    sourceVersion: '',
    isTotalReturn: true,
    points: '',
  });

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listResponse = await apiClient.get<{ benchmarks: InvestmentBenchmark[] }>(
        '/api/investments/benchmarks?includePoints=true',
        { cacheMode: 'no-store' },
      );
      if (!listResponse.ok) throw new Error(listResponse.statusText || 'Failed to load benchmarks');
      const nextBenchmarks = listResponse.data?.benchmarks || [];
      setBenchmarks(nextBenchmarks);

      if (performance?.startDate && performance?.endDate && nextBenchmarks.length > 0) {
        const params = new URLSearchParams({
          startDate: performance.startDate,
          endDate: performance.endDate,
          baseCurrency: performance.baseCurrency || 'ILS',
        });
        const comparisonResponse = await apiClient.get<BenchmarkComparisonResponse>(
          `/api/investments/benchmarks/comparison?${params.toString()}`,
          { cacheMode: 'no-store' },
        );
        if (!comparisonResponse.ok) throw new Error(comparisonResponse.statusText || 'Failed to compare benchmark');
        setComparison(comparisonResponse.data || null);
      } else {
        setComparison(null);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load benchmarks');
    } finally {
      setLoading(false);
    }
  }, [performance?.baseCurrency, performance?.endDate, performance?.startDate]);

  React.useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const importBenchmark = async () => {
    const points = parsePoints(draft.points);
    setSaving(true);
    setError(null);
    try {
      if (points.length < 2) throw new Error(t('investmentsPage.benchmark.needPoints', 'Enter at least two valid date,value rows.'));
      const response = await apiClient.post('/api/investments/benchmarks/import', {
        name: draft.name.trim(),
        currency: draft.currency.trim().toUpperCase(),
        source: draft.source.trim(),
        sourceVersion: draft.sourceVersion.trim() || null,
        isTotalReturn: draft.isTotalReturn,
        isDefault: true,
        points,
      });
      if (!response.ok) {
        const payload = response.data as { error?: string } | undefined;
        throw new Error(payload?.error || response.statusText || 'Failed to import benchmark');
      }
      setDialogOpen(false);
      setDraft({ name: '', currency: 'ILS', source: '', sourceVersion: '', isTotalReturn: true, points: '' });
      await fetchData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to import benchmark');
    } finally {
      setSaving(false);
    }
  };

  const removeBenchmark = async () => {
    const benchmark = comparison?.benchmark || benchmarks.find((item) => item.isDefault) || benchmarks[0];
    if (!benchmark) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.delete(`/api/investments/benchmarks?id=${benchmark.id}`);
      if (!response.ok) throw new Error(response.statusText || 'Failed to remove benchmark');
      await fetchData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to remove benchmark');
    } finally {
      setSaving(false);
    }
  };

  const activeBenchmark = comparison?.benchmark || benchmarks.find((item) => item.isDefault) || benchmarks[0] || null;
  const portfolioReturn = performance?.twr;
  const benchmarkReturn = comparison?.status === 'ok' ? comparison.return : null;
  const delta = portfolioReturn != null && benchmarkReturn != null ? portfolioReturn - benchmarkReturn : null;

  return (
    <Paper sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t('investmentsPage.benchmark.title', 'Optional benchmark')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('investmentsPage.benchmark.subtitle', 'Compare the same effective dates against a real imported index series.')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {activeBenchmark && <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => void removeBenchmark()} disabled={saving}>{t('common.remove', 'Remove')}</Button>}
          <Button size="small" variant="outlined" startIcon={<AddChartIcon />} onClick={() => setDialogOpen(true)} disabled={saving}>
            {activeBenchmark ? t('investmentsPage.benchmark.replace', 'Replace series') : t('investmentsPage.benchmark.import', 'Import series')}
          </Button>
        </Box>
      </Box>
      <Alert severity="info">
        {t('investmentsPage.benchmark.guardrail', 'No synthetic market return is shown. Import dated data from a source you trust; dividends require a total-return index.')}
      </Alert>
      {error && <Alert severity="error">{error}</Alert>}
      {loading ? <Skeleton variant="rounded" height={100} /> : !activeBenchmark ? (
        <Typography color="text.secondary" sx={{ py: 1 }}>
          {t('investmentsPage.benchmark.empty', 'No benchmark series is configured.')}
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {performance?.method === 'modified_dietz'
                ? t('investmentsPage.benchmark.portfolioEstimated', 'Portfolio estimated return')
                : t('investmentsPage.benchmark.portfolio', 'Portfolio TWR')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{formatPercent(portfolioReturn)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {activeBenchmark.name} · {activeBenchmark.isTotalReturn
                ? t('investmentsPage.benchmark.totalReturn', 'total return')
                : t('investmentsPage.benchmark.priceReturn', 'price return')} · {comparison?.returnCurrency || activeBenchmark.currency}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{formatPercent(benchmarkReturn)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">{t('investmentsPage.benchmark.difference', 'Difference')}</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, color: (delta || 0) >= 0 ? 'success.main' : 'error.main' }}>{formatPercent(delta)}</Typography>
          </Box>
          {comparison?.status !== 'ok' && (
            <Alert severity="warning" sx={{ gridColumn: '1 / -1' }}>
              {comparison?.reason === 'missing_fx_rates'
                ? t('investmentsPage.benchmark.missingFx', 'Add dated FX rates to compare this benchmark in the portfolio base currency.')
                : t('investmentsPage.benchmark.noOverlap', 'The imported series does not cover both selected portfolio dates.')}
            </Alert>
          )}
          {comparison?.status === 'ok' && (
            <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
              {t('investmentsPage.benchmark.approximation', {
                start: comparison.startObservationDate || comparison.startDate || '',
                end: comparison.endObservationDate || comparison.endDate || '',
                defaultValue: `Approximate comparison using benchmark observations from ${comparison.startObservationDate || comparison.startDate || ''} to ${comparison.endObservationDate || comparison.endDate || ''}; portfolio and benchmark return methods may differ.`,
              })}
            </Typography>
          )}
        </Box>
      )}

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('investmentsPage.benchmark.dialogTitle', 'Import benchmark series')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 1.5, pt: '12px !important' }}>
          {error && <Alert severity="error" sx={{ gridColumn: '1 / -1' }}>{error}</Alert>}
          <TextField label={t('investmentsPage.benchmark.name', 'Benchmark name')} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          <TextField label={t('investmentsPage.benchmark.currency', 'Currency')} value={draft.currency} onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} slotProps={{ htmlInput: { maxLength: 3 } }} />
          <TextField label={t('investmentsPage.benchmark.source', 'Source')} value={draft.source} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} />
          <TextField label={t('investmentsPage.benchmark.version', 'Source/version')} value={draft.sourceVersion} onChange={(event) => setDraft((current) => ({ ...current, sourceVersion: event.target.value }))} />
          <FormControlLabel
            control={<Checkbox checked={draft.isTotalReturn} onChange={(event) => setDraft((current) => ({ ...current, isTotalReturn: event.target.checked }))} />}
            label={t('investmentsPage.benchmark.isTotalReturn', 'Series includes reinvested distributions')}
            sx={{ gridColumn: '1 / -1' }}
          />
          <TextField
            multiline
            minRows={8}
            label={t('investmentsPage.benchmark.points', 'CSV points (date,value)')}
            placeholder={'date,value\n2026-01-01,100\n2026-02-01,102.5'}
            value={draft.points}
            onChange={(event) => setDraft((current) => ({ ...current, points: event.target.value }))}
            sx={{ gridColumn: '1 / -1' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={() => void importBenchmark()} disabled={saving || !draft.name.trim() || !draft.source.trim()}>{t('investmentsPage.benchmark.import', 'Import series')}</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default BenchmarkComparisonPanel;
