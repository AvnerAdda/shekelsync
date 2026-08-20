import React from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
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
import RefreshIcon from '@mui/icons-material/Refresh';
import SyncIcon from '@mui/icons-material/Sync';
import { apiClient } from '@/lib/api-client';
import type { InvestmentFxSettingsResponse } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';

interface FxSettingsPanelProps {
  currencies: string[];
  onChanged?: () => void | Promise<void>;
}

const FxSettingsPanel: React.FC<FxSettingsPanelProps> = ({ currencies, onChanged }) => {
  const { t } = useTranslation('translation');
  const [data, setData] = React.useState<InvestmentFxSettingsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({
    fromCurrency: 'USD',
    toCurrency: 'ILS',
    rateDate: new Date().toISOString().slice(0, 10),
    rate: '',
  });

  const fetchSettings = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<InvestmentFxSettingsResponse>('/api/investments/fx', { cacheMode: 'no-store' });
      if (!response.ok) throw new Error(response.statusText || 'Failed to load FX rates');
      setData(response.data || null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load FX rates');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const syncOfficial = async () => {
    setSaving(true);
    setError(null);
    try {
      const requestedCurrencies = currencies
        .map((currency) => currency.toUpperCase())
        .filter((currency) => currency !== 'ILS');
      const response = await apiClient.post<{ imported: number }>('/api/investments/fx/sync', {
        // BOI publishes foreign-currency rates against ILS. The backend can
        // derive inverse/cross pairs from these cached observations even when
        // the selected display base is another currency.
        baseCurrency: 'ILS',
        currencies: requestedCurrencies.length ? requestedCurrencies : ['USD', 'EUR', 'GBP'],
        // Import the provider's supported maximum so the "All" view remains
        // useful for long-running portfolios without requiring repeated syncs.
        lastNObservations: 4000,
      });
      if (!response.ok) {
        const payload = response.data as { error?: string } | undefined;
        throw new Error(payload?.error || response.statusText || 'Failed to sync official FX rates');
      }
      await fetchSettings();
      await onChanged?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to sync official FX rates');
    } finally {
      setSaving(false);
    }
  };

  const saveManualRate = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.post('/api/investments/fx/rates', {
        ...draft,
        fromCurrency: draft.fromCurrency.toUpperCase(),
        toCurrency: draft.toCurrency.toUpperCase(),
        rate: Number(draft.rate),
        source: 'manual',
      });
      if (!response.ok) {
        const payload = response.data as { error?: string } | undefined;
        throw new Error(payload?.error || response.statusText || 'Failed to save FX rate');
      }
      setDialogOpen(false);
      await fetchSettings();
      await onChanged?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save FX rate');
    } finally {
      setSaving(false);
    }
  };

  const updateBaseCurrency = async (baseCurrency: string) => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.put<{ baseCurrency: string }>(
        '/api/investments/fx/base-currency',
        { baseCurrency },
      );
      if (!response.ok) throw new Error(response.statusText || 'Failed to update base currency');
      await fetchSettings();
      await onChanged?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to update base currency');
    } finally {
      setSaving(false);
    }
  };

  const latestRates = React.useMemo(() => {
    const seen = new Set<string>();
    return (data?.rates || []).filter((rate) => {
      const key = `${rate.fromCurrency}-${rate.toCurrency}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data]);
  const baseCurrencyOptions = React.useMemo(
    () => Array.from(new Set([
      'ILS',
      'USD',
      'EUR',
      'GBP',
      ...(currencies || []).map((currency) => currency.toUpperCase()),
      ...(data?.rates || []).flatMap((rate) => [rate.fromCurrency, rate.toCurrency]),
    ])).sort(),
    [currencies, data?.rates],
  );

  return (
    <Paper sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t('investmentsPage.fx.title', 'Currency conversion')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('investmentsPage.fx.subtitle', 'Dated rates normalize portfolio totals into the base currency.')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Tooltip title={t('common.refresh', 'Refresh')}>
            <IconButton size="small" onClick={() => void fetchSettings()} disabled={loading || saving}><RefreshIcon fontSize="small" /></IconButton>
          </Tooltip>
          <Button size="small" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)} disabled={saving}>
            {t('investmentsPage.fx.manual', 'Manual rate')}
          </Button>
          <Button size="small" variant="outlined" startIcon={<SyncIcon />} onClick={() => void syncOfficial()} disabled={saving}>
            {t('investmentsPage.fx.sync', 'Sync official rates')}
          </Button>
        </Box>
      </Box>
      <Alert severity="info">
        {t(
          'investmentsPage.fx.sourceNote',
          'Official sync uses Bank of Israel representative rates. They are indicative, cached locally, and never replace your native-currency values.',
        )}
      </Alert>
      {error && <Alert severity="error">{error}</Alert>}
      {loading ? <Skeleton variant="rounded" height={100} /> : (
        <>
          <TextField
            select
            size="small"
            label={t('investmentsPage.fx.baseCurrency', 'Base currency')}
            value={data?.baseCurrency || 'ILS'}
            onChange={(event) => void updateBaseCurrency(event.target.value)}
            disabled={saving}
            sx={{ width: 180 }}
          >
            {baseCurrencyOptions.map((currency) => (
              <MenuItem key={currency} value={currency}>{currency}</MenuItem>
            ))}
          </TextField>
          {latestRates.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 1 }}>
              {t('investmentsPage.fx.empty', 'No conversion rates are cached yet.')}
            </Typography>
          ) : (
            <TableContainer sx={{ maxHeight: 220 }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow><TableCell>{t('investmentsPage.fx.pair', 'Pair')}</TableCell><TableCell>{t('investmentsPage.fx.date', 'Rate date')}</TableCell><TableCell align="right">{t('investmentsPage.fx.rate', 'Rate')}</TableCell><TableCell>{t('investmentsPage.fx.source', 'Source')}</TableCell></TableRow></TableHead>
                <TableBody>
                  {latestRates.map((rate) => (
                    <TableRow key={`${rate.rateDate}-${rate.fromCurrency}-${rate.toCurrency}`}>
                      <TableCell>{rate.fromCurrency} → {rate.toCurrency}</TableCell>
                      <TableCell>{rate.rateDate}</TableCell>
                      <TableCell align="right">{rate.rate.toLocaleString(undefined, { maximumFractionDigits: 6 })}</TableCell>
                      <TableCell>{rate.source}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('investmentsPage.fx.manualTitle', 'Add dated FX rate')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, pt: '12px !important' }}>
          {error && <Alert severity="error" sx={{ gridColumn: '1 / -1' }}>{error}</Alert>}
          <TextField label={t('investmentsPage.fx.from', 'From')} value={draft.fromCurrency} onChange={(event) => setDraft((current) => ({ ...current, fromCurrency: event.target.value.toUpperCase() }))} slotProps={{ htmlInput: { maxLength: 3 } }} />
          <TextField label={t('investmentsPage.fx.to', 'To')} value={draft.toCurrency} onChange={(event) => setDraft((current) => ({ ...current, toCurrency: event.target.value.toUpperCase() }))} slotProps={{ htmlInput: { maxLength: 3 } }} />
          <TextField type="date" label={t('investmentsPage.fx.date', 'Rate date')} value={draft.rateDate} onChange={(event) => setDraft((current) => ({ ...current, rateDate: event.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField type="number" label={t('investmentsPage.fx.rate', 'Rate')} value={draft.rate} onChange={(event) => setDraft((current) => ({ ...current, rate: event.target.value }))} slotProps={{ htmlInput: { min: 0, step: 0.000001 } }} />
          <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
            {t('investmentsPage.fx.rule', 'Amount in “to” currency = amount in “from” currency × rate.')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={() => void saveManualRate()} disabled={saving || !(Number(draft.rate) > 0)}>{t('common.save', 'Save')}</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default FxSettingsPanel;
