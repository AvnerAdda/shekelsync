import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import { useTranslation } from 'react-i18next';
import type { MarketSnapshot } from '@renderer/types/investments';

interface MarketDataStatusProps {
  snapshot: MarketSnapshot | null;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  onSync: () => void;
}

function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${value.toFixed(digits)}%`;
}

function signedPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function monthLabel(period: string | null | undefined): string {
  if (!period) return '-';
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function dayLabel(date: string | null | undefined): string {
  if (!date) return '-';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const MarketDataStatus: React.FC<MarketDataStatusProps> = ({ snapshot, loading, syncing, error, onSync }) => {
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.market' });
  const staleKeys = Object.entries(snapshot?.series || {})
    .filter(([, series]) => !series.optional && series.stale)
    .map(([key]) => key);
  const lastSynced = Object.values(snapshot?.series || {})
    .map((series) => series.lastSyncedAt)
    .filter(Boolean)
    .sort()
    .pop();

  const items: Array<{ label: string; value: string; hint: string }> = snapshot?.hasData
    ? [
      {
        label: t('policyRate', 'BoI rate'),
        value: pct(snapshot.policyRate?.value),
        hint: t('policyRateHint', 'Bank of Israel policy rate, since {{date}}', { date: dayLabel(snapshot.policyRate?.since) }),
      },
      {
        label: t('prime', 'Prime'),
        value: pct(snapshot.prime?.value),
        hint: t('primeHint', 'BoI rate + 1.5%. Next decision: {{date}}', { date: dayLabel(snapshot.nextDecisionDate) }),
      },
      {
        label: t('cpi', 'CPI 12m'),
        value: signedPct(snapshot.cpi?.yearOverYear),
        hint: t('cpiHint', 'Latest CPI: {{period}}. Index known today: {{known}}', {
          period: monthLabel(snapshot.cpi?.lastPeriod),
          known: monthLabel(snapshot.cpi?.knownPeriod),
        }),
      },
      {
        label: t('inflationExpectation', 'Expected inflation 1y'),
        value: pct(snapshot.inflationExpectation1y?.value),
        hint: t('inflationExpectationHint', 'Bank of Israel composite expectation, used to project CPI-linked tracks'),
      },
      {
        label: t('housePrices', 'Home prices 12m'),
        value: signedPct(snapshot.housePrices?.yearOverYear),
        hint: t('housePricesHint', 'CBS dwelling price index, {{period}} (published with ~3 months delay)', {
          period: monthLabel(snapshot.housePrices?.lastPeriod),
        }),
      },
    ]
    : [];

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mr: 0.5 }}>
          {t('title', 'Market data')}
        </Typography>
        {loading && !snapshot ? <CircularProgress size={16} /> : null}
        {snapshot && !snapshot.hasData ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('empty', 'Not synced yet. Sync to price prime and CPI-linked tracks with real data.')}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', flex: 1 }}>
          {items.map((item) => (
            <Tooltip key={item.label} title={item.hint}>
              <Chip
                size="small"
                variant="outlined"
                label={(
                  <span>
                    <Box component="span" sx={{ color: 'text.secondary', mr: 0.5 }}>{item.label}</Box>
                    <Box component="span" sx={{ fontWeight: 800 }}>{item.value}</Box>
                  </span>
                )}
              />
            </Tooltip>
          ))}
          {staleKeys.length > 0 && snapshot?.hasData ? (
            <Tooltip title={staleKeys.join(', ')}>
              <Chip size="small" color="warning" variant="outlined" label={t('stale', 'Some data is out of date')} />
            </Tooltip>
          ) : null}
        </Stack>
        <Tooltip title={lastSynced ? t('lastSynced', 'Last synced {{date}}', { date: new Date(lastSynced).toLocaleString() }) : ''}>
          <span>
            <Button
              size="small"
              onClick={onSync}
              disabled={syncing}
              startIcon={syncing ? <CircularProgress size={14} /> : <SyncIcon fontSize="small" />}
            >
              {t('sync', 'Sync')}
            </Button>
          </span>
        </Tooltip>
      </Box>
      {error ? (
        <Alert severity="warning" sx={{ mt: 1, py: 0 }}>
          {t('syncError', 'Some series could not be refreshed: {{error}}', { error })}
        </Alert>
      ) : null}
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
        {t('sources', 'Sources: Bank of Israel and the Central Bureau of Statistics public APIs. Values are cached locally.')}
      </Typography>
    </Paper>
  );
};

export default MarketDataStatus;
