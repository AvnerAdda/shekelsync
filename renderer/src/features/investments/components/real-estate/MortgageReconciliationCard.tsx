import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { HealthVerdict, MortgageReconciliation } from '@renderer/types/investments';
import HealthVerdictChip from './HealthVerdictChip';
import { TRACK_TYPE_FALLBACK_LABELS } from './mortgage-utils';

interface MortgageReconciliationCardProps {
  accountId: number;
  refreshKey?: number;
  /** Opens the track editor (shown when the gap points at the tracks). */
  onEditTracks?: () => void;
}

const SOURCE_FALLBACKS: Record<string, string> = {
  saved: 'chosen by you',
  linked_transactions: 'from payments linked to this property',
  detected: 'detected automatically',
};
const STATUS_FALLBACKS: Record<string, string> = {
  ok: 'Matches', drift: 'Differs', missing: 'Missing', unexpected: 'Unexpected', pending: 'Upcoming',
};

const STATUS_VERDICT: Record<string, HealthVerdict> = { ok: 'good', drift: 'watch', missing: 'risk', unexpected: 'unknown', pending: 'unknown' };

const matcherKey = (item: { vendor: string | null; accountNumber: string | null; pattern: string }) => JSON.stringify([item.vendor, item.accountNumber, item.pattern]);

function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const MortgageReconciliationCard: React.FC<MortgageReconciliationCardProps> = ({ accountId, refreshKey = 0, onEditTracks }) => {
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.reconciliation' });
  const { t: tTrack } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.mortgage' });
  const [savedNotice, setSavedNotice] = React.useState(false);
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const [data, setData] = React.useState<MortgageReconciliation | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [candidateKey, setCandidateKey] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const money = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '-';
    return maskAmounts ? '***' : formatCurrency(value, { absolute: false, maximumFractionDigits: 0 });
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<MortgageReconciliation>(
        `/api/investments/real-estate/properties/${accountId}/reconciliation`,
        { cacheMode: 'no-store' },
      );
      if (!response.ok) throw new Error((response.data as { error?: string })?.error || response.statusText);
      const next = response.data as MortgageReconciliation;
      setData(next);
      // Preselect the debit currently used, so the picker reflects reality.
      setCandidateKey(next.matcher ? matcherKey(next.matcher) : '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to reconcile');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const saveMatcher = async () => {
    const candidate = data?.candidates.find((item) => JSON.stringify([item.vendor, item.accountNumber, item.pattern]) === candidateKey);
    if (!candidate) return;
    setSaving(true);
    try {
      const response = await apiClient.put<MortgageReconciliation>(
        `/api/investments/real-estate/properties/${accountId}/mortgage/payment-matcher`,
        { vendor: candidate.vendor, accountNumber: candidate.accountNumber, pattern: candidate.pattern },
      );
      if (!response.ok) throw new Error((response.data as { error?: string })?.error || response.statusText);
      setData(response.data as MortgageReconciliation);
      setSavedNotice(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <CircularProgress size={20} />;
  if (!data || data.status === 'no_tracks') return null;

  const trackName = (item: { type: string; label: string | null }) => item.label
    || tTrack(`trackTypes.${item.type}`, TRACK_TYPE_FALLBACK_LABELS[item.type as keyof typeof TRACK_TYPE_FALLBACK_LABELS] || item.type);
  const currentKey = data.matcher ? matcherKey(data.matcher) : '';
  const selectionIsCurrent = Boolean(candidateKey) && candidateKey === currentKey;
  const composition = data.summary?.composition;
  const suggestion = data.summary?.suggestion;
  const suggestionText = suggestion === 'large_gap'
    ? t('suggestions.largeGap', 'In {{month}} the bank debited {{actual}} but your tracks only add up to {{expected}}. A track is probably missing, or its draw or first-payment date is wrong.', {
      month: monthLabel(data.summary?.latestMonth || ''),
      actual: money(data.months.find((item) => item.month === data.summary?.latestMonth)?.actual),
      expected: money(data.months.find((item) => item.month === data.summary?.latestMonth)?.expected),
    })
    : suggestion === 'consistent_drift'
    ? t('suggestions.consistentDrift', 'The bank charges {{amount}} more or less than computed every month. Enter your bank\'s balance per track in "Bank statement check", and check whether its rates are quoted nominal or effective.', { amount: money(Math.abs(data.summary?.averageDifference ?? 0)) })
    : suggestion === 'latest_drift'
      ? t('suggestions.latestDrift', 'The last debit differs from the computed payment. A first payment often includes extra days of interest; if it repeats, check your tracks.')
      : suggestion === 'missing_payment'
        ? t('suggestions.missing', 'No mortgage debit found last month. If the bank account is not synced, sync it; otherwise check the payment matcher below.')
        : suggestion === 'first_payment'
          ? t('suggestions.firstPayment', 'A debit before the first computed payment usually means interest for the days between the draw and the first payment date, or an earlier draw date.')
          : null;

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, flex: 1 }}>{t('title', 'Computed vs debited by the bank')}</Typography>
        {data.summary ? <HealthVerdictChip verdict={STATUS_VERDICT[data.summary.latestStatus] || 'unknown'} /> : null}
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
        {data.matcher
          ? t('matcher.current', 'Matching debits "{{pattern}}"{{vendor}} ({{source}}). {{count}} found.', {
            pattern: data.matcher.pattern,
            vendor: data.matcher.vendor ? ` · ${data.matcher.vendor}${data.matcher.accountNumber ? ` ${data.matcher.accountNumber}` : ''}` : '',
            source: t(`matcher.sources.${data.matcher.source}`, SOURCE_FALLBACKS[data.matcher.source] || data.matcher.source),
            count: data.matchedCount,
          })
          : t('matcher.none', 'No mortgage debit found in your transactions yet. Pick the right one below once your bank account is synced.')}
      </Typography>
      {error ? <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert> : null}
      {data.monthsWithoutHistory ? (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
          {t('noHistory', '{{count}} earlier months are not checked: your bank history starts {{date}}.', { count: data.monthsWithoutHistory, date: data.historyStart || '-' })}
        </Typography>
      ) : null}
      {suggestionText ? (
        <Alert
          severity={suggestion === 'large_gap' ? 'warning' : 'info'}
          sx={{ mb: 1 }}
          action={suggestion === 'large_gap' && onEditTracks
            ? <Button color="inherit" size="small" onClick={onEditTracks}>{t('editTracks', 'Edit tracks')}</Button>
            : undefined}
        >
          {suggestionText}
          {composition && (suggestion === 'large_gap' || suggestion === 'latest_drift') ? (
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
              {composition.paying.map((item) => (
                <li key={item.trackId}>
                  {t('composition.paying', '{{track}}: {{amount}} on {{date}}', { track: trackName(item), amount: money(item.payment), date: dayLabel(item.date) })}
                </li>
              ))}
              {composition.notYetPaying.map((item) => (
                <li key={item.trackId}>
                  <strong>{t('composition.notYet', '{{track}}: no payment yet, first one on {{date}}', { track: trackName(item), date: dayLabel(item.firstPaymentDate) })}</strong>
                </li>
              ))}
            </Box>
          ) : null}
        </Alert>
      ) : null}

      {data.months.length > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('table.month', 'Month')}</TableCell>
              <TableCell align="right">{t('table.expected', 'Computed')}</TableCell>
              <TableCell align="right">{t('table.actual', 'Debited')}</TableCell>
              <TableCell align="right">{t('table.difference', 'Difference')}</TableCell>
              <TableCell>{t('table.status', 'Status')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.months.slice(-6).map((row) => (
              <TableRow key={row.month}>
                <TableCell>{monthLabel(row.month)}</TableCell>
                <TableCell align="right">{money(row.expected)}</TableCell>
                <TableCell align="right">{money(row.actual)}</TableCell>
                <TableCell align="right">{row.status === 'pending' ? '-' : money(row.difference)}</TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined" label={t(`statuses.${row.status}`, STATUS_FALLBACKS[row.status] || row.status)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {data.candidates.length > 0 ? (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1.5, flexWrap: 'wrap' }}>
          <TextField
            select
            size="small"
            label={t('matcher.pick', 'Mortgage debit')}
            value={candidateKey}
            onChange={(event) => {
              setCandidateKey(event.target.value);
              setSavedNotice(false);
            }}
            sx={{ minWidth: 280 }}
          >
            {data.candidates.map((candidate) => {
              const key = matcherKey(candidate);
              return (
                <MenuItem key={key} value={key}>
                  {candidate.name} · {candidate.vendor || '-'} · {t('matcher.occurrences', '{{count}}×, last {{amount}}', { count: candidate.count, amount: money(candidate.lastAmount) })}
                </MenuItem>
              );
            })}
          </TextField>
          {selectionIsCurrent ? (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {savedNotice ? t('matcher.saved', 'Saved: this debit is used to check your payments.') : t('matcher.inUse', 'This debit is already used.')}
            </Typography>
          ) : (
            <Button size="small" variant="outlined" disabled={!candidateKey || saving} onClick={saveMatcher}>
              {t('matcher.save', 'Use this debit')}
            </Button>
          )}
        </Box>
      ) : null}
    </Paper>
  );
};

export default MortgageReconciliationCard;
