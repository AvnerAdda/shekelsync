import React from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type {
  HealthVerdict,
  MortgageDraft,
  MortgageTrackType,
  MortgageView,
  RefinanceCheckResponse,
  RefinanceOfferTrack,
  RefinancePreviewResponse,
} from '@renderer/types/investments';
import CustomTooltip from '../CustomTooltip';
import HealthVerdictChip from './HealthVerdictChip';
import { TRACK_TYPES, TRACK_TYPE_FALLBACK_LABELS, TRACK_TYPE_META, draftFromView, seriesColor } from './mortgage-utils';

interface RefinancePanelProps {
  accountId: number;
  view: MortgageView | null;
  onApply: (draft: MortgageDraft) => Promise<unknown>;
  refreshKey?: number;
}

const VERDICT_MAP: Record<string, HealthVerdict> = { worth_it: 'good', marginal: 'watch', not_worth_it: 'unknown' };
const VERDICT_FALLBACK: Record<string, string> = { worth_it: 'Worth it', marginal: 'Marginal', not_worth_it: 'No gain' };

function parseNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactCurrency(value: number): string {
  return Math.abs(value) >= 1000 ? `₪${(value / 1000).toFixed(1)}K` : `₪${Math.round(value)}`;
}

/**
 * Apply a compared refinance to the mortgage draft: a refinance event closes
 * the replaced tracks on the date, and the offer tracks are drawn that day.
 */
export function applyRefinanceToDraft(view: MortgageView | null, preview: RefinancePreviewResponse, today: string): MortgageDraft {
  const draft = draftFromView(view);
  const closeIndexes = draft.tracks
    .map((track, index) => ({ id: String(track.id), index }))
    .filter((item) => preview.closedTrackIds.includes(item.id))
    .map((item) => item.index);
  const offerTracks = preview.offerTracks.map((offer) => ({
    type: offer.type,
    label: null,
    rate: offer.rate ?? null,
    margin: offer.margin ?? null,
    rateConvention: offer.rateConvention || 'nominal',
    resetPeriodMonths: offer.resetPeriodMonths ?? null,
    amortization: 'spitzer' as const,
    termMonths: offer.termMonths,
    firstPaymentDate: offer.firstPaymentDate,
    grace: { type: 'none' as const, endDate: null },
    cpiFloorAtBase: false,
    anchor: null,
    tranches: [{
      drawDate: preview.date,
      amount: Math.round(offer.amount),
      status: preview.date > today ? 'planned' as const : 'drawn' as const,
      rate: offer.rate ?? null,
      termMode: 'same_maturity' as const,
    }],
  }));
  return {
    ...draft,
    tracks: [...draft.tracks, ...offerTracks],
    events: [...draft.events, { type: 'refinance', date: preview.date, trackIndex: null, closeTrackIndexes: closeIndexes, fee: preview.costs.prepaymentFees }],
  };
}

const RefinancePanel: React.FC<RefinancePanelProps> = ({ accountId, view, onApply, refreshKey = 0 }) => {
  const theme = useTheme();
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light';
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.refinance' });
  const { t: tTrack } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.mortgage' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const money = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '-';
    return maskAmounts ? '***' : formatCurrency(value, { absolute: false, maximumFractionDigits: 0 });
  };
  const trackName = (type: MortgageTrackType) => tTrack(`trackTypes.${type}`, TRACK_TYPE_FALLBACK_LABELS[type]);

  const [check, setCheck] = React.useState<RefinanceCheckResponse | null>(null);
  const [checkError, setCheckError] = React.useState<string | null>(null);
  const [closeIds, setCloseIds] = React.useState<string[]>([]);
  const [offers, setOffers] = React.useState<RefinanceOfferTrack[]>([{ type: 'fixed_unlinked', rate: null, termMonths: 300, sharePct: 100, rateConvention: 'nominal' }]);
  const [switchingCosts, setSwitchingCosts] = React.useState<number | null>(3000);
  const [financeFees, setFinanceFees] = React.useState(false);
  const [preview, setPreview] = React.useState<RefinancePreviewResponse | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [applied, setApplied] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    apiClient.get<RefinanceCheckResponse>(`/api/investments/real-estate/properties/${accountId}/mortgage/refinance-check`, { cacheMode: 'no-store' })
      .then((response) => {
        if (!active) return;
        if (!response.ok) throw new Error((response.data as { error?: string })?.error || response.statusText);
        setCheck(response.data as RefinanceCheckResponse);
      })
      .catch((error) => active && setCheckError(error instanceof Error ? error.message : 'Failed'));
    return () => {
      active = false;
    };
  }, [accountId, refreshKey]);

  const updateOffer = (index: number, patch: Partial<RefinanceOfferTrack>) => {
    setOffers((previous) => previous.map((offer, position) => (position === index ? { ...offer, ...patch } : offer)));
    setPreview(null);
  };

  const compare = async () => {
    setBusy(true);
    setPreviewError(null);
    setApplied(false);
    try {
      const response = await apiClient.post<RefinancePreviewResponse>(
        `/api/investments/real-estate/properties/${accountId}/mortgage/refinance-preview`,
        { closeTrackIds: closeIds, offerTracks: offers, switchingCosts, financeFees },
      );
      if (!response.ok) throw new Error((response.data as { error?: string })?.error || response.statusText);
      setPreview(response.data as RefinancePreviewResponse);
    } catch (error) {
      setPreview(null);
      setPreviewError(error instanceof Error ? error.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    if (!window.confirm(t('confirmApply', 'Record this refinance? The replaced tracks will be closed on {{date}} and the new tracks added.', { date: preview.date }))) return;
    setBusy(true);
    try {
      await onApply(applyRefinanceToDraft(view, preview, new Date().toISOString().slice(0, 10)));
      setApplied(true);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const grid = alpha(theme.palette.divider, 0.6);
  const axisTick = { fill: theme.palette.text.secondary, fontSize: 11 };
  const activeTracks = (check?.tracks || []).filter((track) => track.status !== 'closed');

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>{t('title', 'Refinance (מחזור)')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('subtitle', 'Would replacing a track pay off, after early-repayment fees and switching costs?')}
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, overflowX: 'auto' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t('check.title', 'If you got today\'s market average rate')}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
          {t('check.subtitle', 'Same track type and end date, at the Bank of Israel average for new mortgages; switching costs {{costs}}.', { costs: money(check?.switchingCosts) })}
        </Typography>
        {checkError ? <Alert severity="warning">{checkError}</Alert> : null}
        {!check && !checkError ? <CircularProgress size={20} /> : null}
        {check ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('check.track', 'Track')}</TableCell>
                <TableCell align="right">{t('check.balance', 'Balance')}</TableCell>
                <TableCell align="right">{t('check.rates', 'Yours → market')}</TableCell>
                <TableCell align="right">{t('check.monthly', 'Monthly payment')}</TableCell>
                <TableCell align="right">{t('check.saving', 'Net saving (today\'s value)')}</TableCell>
                <TableCell>{t('check.verdict', 'Verdict')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {activeTracks.map((track) => (
                <TableRow key={track.trackId}>
                  <TableCell>{track.label || trackName(track.type)}</TableCell>
                  <TableCell align="right">{money(track.balance)}</TableCell>
                  {track.status === 'checked' ? (
                    <>
                      <TableCell align="right">{track.currentRate?.toFixed(2)}% → {track.marketRate?.toFixed(2)}%</TableCell>
                      <TableCell align="right">{track.monthlyPaymentChange !== undefined ? `${track.monthlyPaymentChange > 0 ? '+' : ''}${money(track.monthlyPaymentChange)}` : '-'}</TableCell>
                      <TableCell align="right">{money(track.saving)}</TableCell>
                      <TableCell>
                        <HealthVerdictChip verdict={VERDICT_MAP[track.verdict || 'not_worth_it']} />
                        <Typography component="span" variant="caption" sx={{ ml: 0.5 }}>{t(`verdicts.${track.verdict}`, VERDICT_FALLBACK[track.verdict || 'not_worth_it'])}</Typography>
                      </TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={4}>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {t('check.noBenchmark', 'No public market average: ask your bank for an offer and compare it below.')}
                      </Typography>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t('offer.title', 'Compare a bank\'s offer')}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
          {t('offer.subtitle', 'Pick the tracks the new loan would repay, then enter the offered tracks as the bank quotes them.')}
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1.5 }}>
          {activeTracks.map((track) => (
            <FormControlLabel
              key={track.trackId}
              control={(
                <Checkbox
                  size="small"
                  checked={closeIds.includes(track.trackId)}
                  onChange={(event) => {
                    setCloseIds((previous) => (event.target.checked ? [...previous, track.trackId] : previous.filter((id) => id !== track.trackId)));
                    setPreview(null);
                  }}
                />
              )}
              label={`${track.label || trackName(track.type)} · ${money(track.balance)}`}
            />
          ))}
        </Stack>
        <Stack spacing={1}>
          {offers.map((offer, index) => {
            const meta = TRACK_TYPE_META[offer.type];
            return (
              <Grid key={index} container spacing={1} sx={{ alignItems: 'center' }}>
                <Grid size={{ xs: 12, sm: 3 }}>
                  <TextField select fullWidth size="small" label={t('offer.type', 'Offered track')} value={offer.type}
                    onChange={(event) => updateOffer(index, { type: event.target.value as MortgageTrackType })}>
                    {TRACK_TYPES.map((type) => <MenuItem key={type} value={type}>{trackName(type)}</MenuItem>)}
                  </TextField>
                </Grid>
                {meta.needsMargin ? (
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <TextField fullWidth size="small" type="number" label={offer.type === 'prime' ? t('offer.primeMargin', 'Prime ±') : t('offer.margin', 'Margin')}
                      value={offer.margin ?? ''} onChange={(event) => updateOffer(index, { margin: parseNumber(event.target.value) })} />
                  </Grid>
                ) : null}
                {meta.needsRate ? (
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <TextField fullWidth size="small" type="number" label={t('offer.rate', 'Rate %')}
                      value={offer.rate ?? ''} onChange={(event) => updateOffer(index, { rate: parseNumber(event.target.value) })} />
                  </Grid>
                ) : null}
                {meta.needsRate ? (
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <TextField select fullWidth size="small" label={t('offer.convention', 'Quoted as')} value={offer.rateConvention || 'nominal'}
                      onChange={(event) => updateOffer(index, { rateConvention: event.target.value as RefinanceOfferTrack['rateConvention'] })}>
                      <MenuItem value="nominal">{tTrack('fields.nominal', 'Nominal')}</MenuItem>
                      <MenuItem value="effective">{tTrack('fields.effective', 'Effective')}</MenuItem>
                    </TextField>
                  </Grid>
                ) : null}
                <Grid size={{ xs: 6, sm: 1.5 }}>
                  <TextField fullWidth size="small" type="number" label={t('offer.term', 'Months')}
                    value={offer.termMonths ?? ''} onChange={(event) => updateOffer(index, { termMonths: parseNumber(event.target.value) })} />
                </Grid>
                <Grid size={{ xs: 5, sm: 1 }}>
                  <TextField fullWidth size="small" type="number" label="%"
                    value={offer.sharePct ?? ''} onChange={(event) => updateOffer(index, { sharePct: parseNumber(event.target.value) })} />
                </Grid>
                <Grid size={{ xs: 1, sm: 0.5 }}>
                  <IconButton size="small" disabled={offers.length <= 1} onClick={() => setOffers((previous) => previous.filter((_, position) => position !== index))}>
                    <DeleteOutlinedIcon fontSize="small" />
                  </IconButton>
                </Grid>
              </Grid>
            );
          })}
        </Stack>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mt: 1.5 }}>
          <Button size="small" startIcon={<AddIcon />} onClick={() => setOffers((previous) => [...previous, { type: 'prime', margin: -0.5, termMonths: 300, sharePct: null }])}>
            {t('offer.addTrack', 'Add offered track')}
          </Button>
          <TextField size="small" type="number" label={t('offer.switchingCosts', 'Switching costs ₪')} value={switchingCosts ?? ''}
            onChange={(event) => setSwitchingCosts(parseNumber(event.target.value))} sx={{ width: 180 }}
            helperText={t('offer.switchingHint', 'Appraiser, file fee, lawyer')} />
          <FormControlLabel control={<Switch checked={financeFees} onChange={(event) => setFinanceFees(event.target.checked)} />}
            label={t('offer.financeFees', 'Add the costs to the new loan')} />
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" onClick={compare} disabled={busy || closeIds.length === 0}>
            {busy ? <CircularProgress size={18} /> : t('offer.compare', 'Compare')}
          </Button>
        </Box>
        {previewError ? <Alert severity="warning" sx={{ mt: 1.5 }}>{previewError}</Alert> : null}

        {preview ? (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <HealthVerdictChip verdict={VERDICT_MAP[preview.verdict]} size="medium" />
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t(`verdicts.${preview.verdict}`, VERDICT_FALLBACK[preview.verdict])}</Typography>
            </Box>
            <Grid container spacing={1.5}>
              {[
                { label: t('result.monthly', 'Monthly payment'), value: `${money(preview.current.monthlyPayment)} → ${money(preview.offer.monthlyPayment)}`, hint: `${preview.savings.monthlyPaymentChange > 0 ? '+' : ''}${money(preview.savings.monthlyPaymentChange)}` },
                { label: t('result.saving', 'Net saving'), value: money(preview.savings.nominal), hint: t('result.pv', '{{amount}} in today\'s value ({{rate}}%/yr)', { amount: money(preview.savings.presentValue), rate: preview.savings.discountRatePct }) },
                { label: t('result.costs', 'Costs to switch'), value: money(preview.costs.total), hint: t('result.costsHint', 'Early-repayment fee {{fee}} + switching {{switching}}', { fee: money(preview.costs.prepaymentFees), switching: money(preview.costs.switchingCosts) }) },
                { label: t('result.breakEven', 'Pays for itself after'), value: preview.breakEvenMonths === null ? t('result.never', 'Never') : t('result.months', '{{count}} months', { count: preview.breakEvenMonths }), hint: t('result.ends', 'Ends {{date}}', { date: preview.offer.maturityDate || '-' }) },
              ].map((card) => (
                <Grid key={card.label} size={{ xs: 12, sm: 6, md: 3 }}>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, height: '100%' }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>{card.label}</Typography>
                    <Typography variant="body1" sx={{ fontWeight: 900 }}>{card.value}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{card.hint}</Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
            {preview.warnings.length > 0 ? (
              <Alert severity="info" sx={{ mt: 1 }}>
                {preview.warnings.map((warning) => (warning.code === 'planned_tranches_not_refinanced'
                  ? t('warnings.planned', 'Drawdowns after the refinance date stay on the original terms.')
                  : warning.message)).join(' · ')}
              </Alert>
            ) : null}
            <Box sx={{ height: 240, mt: 1.5 }} role="img" aria-label={t('result.chart', 'Monthly payment: current vs offer')}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={preview.series.filter((point, index) => index % 3 === 0)} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke={grid} vertical={false} />
                  <XAxis dataKey="month" tick={axisTick} tickFormatter={(month: string) => month.slice(0, 4)} minTickGap={40} stroke={grid} />
                  <YAxis tick={axisTick} tickFormatter={(value: number) => (maskAmounts ? '' : compactCurrency(value))} width={60} stroke={grid} domain={['auto', 'auto']} />
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="current" name={t('result.current', 'Current loan')} stroke={seriesColor(0, mode)} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="offer" name={t('result.offer', 'With the offer')} stroke={seriesColor(1, mode)} strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
              <Button variant="outlined" onClick={apply} disabled={busy || applied || view?.source !== 'tracks'}>
                {t('apply', 'I did this refinance: update my tracks')}
              </Button>
              {applied ? <Chip size="small" label={t('applied', 'Tracks updated')} /> : null}
            </Box>
          </Box>
        ) : null}
      </Paper>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('disclaimer', 'Estimates. Early-repayment fees are an upper bound; compare under the base scenario (prime flat, market inflation expectations).')}
      </Typography>
    </Stack>
  );
};

export default RefinancePanel;
