import React from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type {
  MortgageDraft,
  MortgageEvent,
  MortgageTrack,
  MortgageTrackType,
  MortgageTranche,
} from '@renderer/types/investments';
import { useMortgagePreview } from '../../hooks/useRealEstateMortgage';
import {
  TRACK_TYPES,
  TRACK_TYPE_FALLBACK_LABELS,
  TRACK_TYPE_META,
  addMonthsIso,
  addRemainingAtDelivery,
  changeTrackType,
  applyDatesToAllTracks,
  createTrackLike,
  plannedByTrack,
  removeTrackFromDraft,
  resplitPlannedDrawdowns,
  trackDateIssue,
  effectiveToNominal,
  nominalToEffective,
  seriesColor,
  todayIso,
  trancheTotals,
} from './mortgage-utils';

interface MortgageTracksDialogProps {
  open: boolean;
  title?: string;
  initialDraft: MortgageDraft;
  onClose: () => void;
  onSave: (draft: MortgageDraft) => Promise<unknown>;
}

type NumberInput = number | null | undefined;

function toInputValue(value: NumberInput): string {
  return value === null || value === undefined || Number.isNaN(value) ? '' : String(value);
}

function parseInput(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const NumberField: React.FC<{
  label: string;
  value: NumberInput;
  onChange: (value: number | null) => void;
  helperText?: React.ReactNode;
  required?: boolean;
  step?: string;
  adornment?: string;
}> = ({ label, value, onChange, helperText, required, step = 'any', adornment }) => (
  <TextField
    fullWidth
    size="small"
    type="number"
    label={label}
    required={required}
    value={toInputValue(value)}
    onChange={(event) => onChange(parseInput(event.target.value))}
    helperText={helperText}
    error={required && (value === null || value === undefined)}
    slotProps={{
      htmlInput: { step },
      input: adornment ? { endAdornment: <Typography variant="caption" sx={{ color: 'text.secondary' }}>{adornment}</Typography> } : undefined,
    }}
  />
);

const DateField: React.FC<{ label: string; value: string | null | undefined; onChange: (value: string | null) => void; required?: boolean }> = ({
  label, value, onChange, required,
}) => (
  <TextField
    fullWidth
    size="small"
    type="date"
    label={label}
    required={required}
    value={value || ''}
    onChange={(event) => onChange(event.target.value || null)}
    error={required && !value}
    slotProps={{ inputLabel: { shrink: true } }}
  />
);

const MortgageTracksDialog: React.FC<MortgageTracksDialogProps> = ({ open, title, initialDraft, onClose, onSave }) => {
  const theme = useTheme();
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light';
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.mortgage' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const [draft, setDraft] = React.useState<MortgageDraft>(initialDraft);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [expandedStatement, setExpandedStatement] = React.useState<Record<number, boolean>>({});
  const [delivery, setDelivery] = React.useState<{ date: string | null; amount: number | null }>({
    date: addMonthsIso(todayIso(), 1),
    amount: null,
  });

  React.useEffect(() => {
    if (open) {
      setDraft(initialDraft);
      setSaveError(null);
      const plannedDate = plannedByTrack(initialDraft).firstDate;
      if (plannedDate) setDelivery((previous) => ({ ...previous, date: plannedDate }));
    }
  }, [open, initialDraft]);

  const preview = useMortgagePreview(open ? draft : null);
  const money = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '-';
    return maskAmounts ? '***' : formatCurrency(value, { absolute: false, maximumFractionDigits: 0 });
  };
  const trackTypeLabel = (type: MortgageTrackType) => t(`trackTypes.${type}`, TRACK_TYPE_FALLBACK_LABELS[type]);
  const currentPrime = preview.data?.market?.currentPrime ?? null;

  const updateTrack = (index: number, patch: Partial<MortgageTrack>) => {
    setDraft((previous) => ({
      ...previous,
      tracks: previous.tracks.map((track, trackIndex) => (trackIndex === index ? { ...track, ...patch } : track)),
    }));
  };
  const updateTranche = (trackIndex: number, trancheIndex: number, patch: Partial<MortgageTranche>) => {
    setDraft((previous) => ({
      ...previous,
      tracks: previous.tracks.map((track, index) => (index !== trackIndex ? track : {
        ...track,
        tranches: track.tranches.map((tranche, position) => (position === trancheIndex ? { ...tranche, ...patch } : tranche)),
      })),
    }));
  };
  const removeTrack = (index: number) => {
    setDraft((previous) => ({ ...previous, ...removeTrackFromDraft(previous, index) }));
  };
  const updateEvent = (index: number, patch: Partial<MortgageEvent>) => {
    setDraft((previous) => ({
      ...previous,
      events: previous.events.map((event, eventIndex) => (eventIndex === index ? { ...event, ...patch } : event)),
    }));
  };

  const totals = draft.tracks.reduce((sum, track) => {
    const trackTotals = trancheTotals(track);
    return { drawn: sum.drawn + trackTotals.drawn, planned: sum.planned + trackTotals.planned };
  }, { drawn: 0, planned: 0 });
  const remainingToDraw = draft.approvedAmount ? Math.max(0, draft.approvedAmount - totals.drawn - totals.planned) : null;
  const planned = plannedByTrack(draft);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('errors.saveFailed', 'Failed to save mortgage'));
    } finally {
      setSaving(false);
    }
  };

  const renderRateFields = (track: MortgageTrack, index: number) => {
    const meta = TRACK_TYPE_META[track.type];
    const rate = track.rate;
    const converted = rate === null || rate === undefined
      ? null
      : track.rateConvention === 'effective' ? effectiveToNominal(rate) : nominalToEffective(rate);
    return (
      <>
        {meta.needsMargin ? (
          <Grid size={{ xs: 6, md: 3 }}>
            <NumberField
              label={track.type === 'prime' ? t('fields.primeMargin', 'Margin vs prime') : t('fields.margin', 'Margin over anchor')}
              value={track.margin}
              onChange={(value) => updateTrack(index, { margin: value })}
              required
              step="0.01"
              adornment="%"
              helperText={track.type === 'prime' && currentPrime !== null && track.margin !== null && track.margin !== undefined
                ? t('fields.primeNow', 'Today: {{rate}}% ({{effective}}% effective)', {
                  rate: (currentPrime + track.margin).toFixed(2),
                  effective: nominalToEffective(currentPrime + track.margin).toFixed(2),
                })
                : undefined}
            />
          </Grid>
        ) : null}
        {meta.needsRate ? (
          <Grid size={{ xs: 6, md: 3 }}>
            <NumberField
              label={meta.variable ? t('fields.currentRate', 'Current rate') : t('fields.rate', 'Interest rate')}
              value={rate}
              onChange={(value) => updateTrack(index, { rate: value })}
              required
              step="0.01"
              adornment="%"
              helperText={converted === null ? undefined : t(
                track.rateConvention === 'effective' ? 'fields.equalsNominal' : 'fields.equalsEffective',
                track.rateConvention === 'effective' ? '= {{rate}}% nominal' : '= {{rate}}% effective',
                { rate: converted.toFixed(2) },
              )}
            />
          </Grid>
        ) : null}
        {meta.needsRate ? (
          <Grid size={{ xs: 12, md: 3 }}>
            <Tooltip title={t('fields.conventionHint', 'Banks often quote the effective annual rate (ריבית אפקטיבית). Check your mortgage report.')}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={track.rateConvention}
                onChange={(_, value) => value && updateTrack(index, { rateConvention: value })}
                sx={{ height: 40 }}
              >
                <ToggleButton value="nominal">{t('fields.nominal', 'Nominal')}</ToggleButton>
                <ToggleButton value="effective">{t('fields.effective', 'Effective')}</ToggleButton>
              </ToggleButtonGroup>
            </Tooltip>
          </Grid>
        ) : null}
        {meta.variable ? (
          <Grid size={{ xs: 6, md: 3 }}>
            <NumberField
              label={t('fields.resetPeriod', 'Rate changes every')}
              value={track.resetPeriodMonths}
              onChange={(value) => updateTrack(index, { resetPeriodMonths: value })}
              step="1"
              adornment={t('units.months', 'months')}
            />
          </Grid>
        ) : null}
      </>
    );
  };

  const renderTrack = (track: MortgageTrack, index: number) => {
    const meta = TRACK_TYPE_META[track.type];
    const snapshot = preview.data?.summary.tracks[index];
    const color = seriesColor(index, mode);
    const termYears = track.termMonths ? (track.termMonths / 12).toFixed(1) : null;
    return (
      <Paper key={index} variant="outlined" sx={{ p: 2, borderRadius: 2, borderLeft: `4px solid ${color}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
          <TextField
            select
            size="small"
            label={t('fields.type', 'Track type')}
            value={track.type}
            onChange={(event) => updateTrack(index, changeTrackType(track, event.target.value as MortgageTrackType))}
            sx={{ minWidth: 220 }}
            helperText={track.type === 'variable_unlinked'
              ? t('fields.variableUnlinkedHint', 'Resets every few years to a bond anchor. For "prime ± x" choose Prime.')
              : undefined}
          >
            {TRACK_TYPES.map((type) => (
              <MenuItem key={type} value={type}>{trackTypeLabel(type)}</MenuItem>
            ))}
            {track.type === 'legacy' || track.type === 'fx_linked'
              ? <MenuItem value={track.type}>{trackTypeLabel(track.type)}</MenuItem>
              : null}
          </TextField>
          <TextField
            size="small"
            label={t('fields.label', 'Label (optional)')}
            value={track.label || ''}
            onChange={(event) => updateTrack(index, { label: event.target.value })}
            sx={{ flex: 1, minWidth: 160 }}
          />
          {snapshot ? (
            <Stack direction="row" spacing={1}>
              <Chip size="small" label={`${t('preview.balance', 'Balance')} ${money(snapshot.balance)}`} />
              <Chip size="small" color="primary" variant="outlined" label={`${t('preview.next', 'Next')} ${money(snapshot.nextPayment)}`} />
              {snapshot.currentRate !== null ? <Chip size="small" variant="outlined" label={`${snapshot.currentRate.toFixed(2)}%`} /> : null}
            </Stack>
          ) : null}
          <Tooltip title={t('actions.removeTrack', 'Remove track')}>
            <span>
              <IconButton size="small" onClick={() => removeTrack(index)} disabled={draft.tracks.length <= 1}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        <Grid container spacing={1.5}>
          {renderRateFields(track, index)}
          <Grid size={{ xs: 6, md: 3 }}>
            <NumberField
              label={t('fields.term', 'Term')}
              value={track.termMonths}
              onChange={(value) => updateTrack(index, { termMonths: value })}
              required
              step="1"
              adornment={t('units.months', 'months')}
              helperText={termYears ? t('fields.years', '{{years}} years', { years: termYears }) : undefined}
            />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <DateField
              label={t('fields.firstPayment', 'First payment date')}
              value={track.firstPaymentDate}
              onChange={(value) => updateTrack(index, { firstPaymentDate: value })}
            />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <TextField
              select
              fullWidth
              size="small"
              label={t('fields.amortization', 'Repayment method')}
              value={track.amortization}
              onChange={(event) => updateTrack(index, { amortization: event.target.value as MortgageTrack['amortization'] })}
            >
              <MenuItem value="spitzer">{t('amortization.spitzer', 'Spitzer (equal payments)')}</MenuItem>
              <MenuItem value="equal_principal">{t('amortization.equal_principal', 'Equal principal')}</MenuItem>
              <MenuItem value="balloon">{t('amortization.balloon', 'Balloon (interest only)')}</MenuItem>
              <MenuItem value="bullet">{t('amortization.bullet', 'Bullet (all at maturity)')}</MenuItem>
            </TextField>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <TextField
              select
              fullWidth
              size="small"
              label={t('fields.grace', 'Grace period')}
              value={track.grace?.type || 'none'}
              onChange={(event) => updateTrack(index, { grace: { ...track.grace, type: event.target.value as MortgageTrack['grace']['type'] } })}
            >
              <MenuItem value="none">{t('grace.none', 'None')}</MenuItem>
              <MenuItem value="partial">{t('grace.partial', 'Partial (interest only)')}</MenuItem>
              <MenuItem value="full">{t('grace.full', 'Full (interest added to balance)')}</MenuItem>
            </TextField>
          </Grid>
          {track.grace?.type && track.grace.type !== 'none' ? (
            <Grid size={{ xs: 6, md: 3 }}>
              <DateField
                label={t('fields.graceEnd', 'Grace ends')}
                value={track.grace.endDate}
                onChange={(value) => updateTrack(index, { grace: { ...track.grace, endDate: value } })}
                required
              />
            </Grid>
          ) : null}
          {meta.cpiLinked ? (
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControlLabel
                control={(
                  <Checkbox
                    size="small"
                    checked={Boolean(track.cpiFloorAtBase)}
                    onChange={(event) => updateTrack(index, { cpiFloorAtBase: event.target.checked })}
                  />
                )}
                label={t('fields.cpiFloor', 'Deflation floor (balance never below the base index)')}
              />
            </Grid>
          ) : null}
        </Grid>

        {(() => {
          const issue = trackDateIssue(track, draft.options?.brokenPeriodInterest);
          if (!issue) return null;
          return (
            <Alert
              severity="warning"
              sx={{ mt: 1.5 }}
              action={(
                <Button color="inherit" size="small" onClick={() => updateTrack(index, { firstPaymentDate: issue.suggested })}>
                  {t('dates.fix', 'Set to {{date}}', { date: shortDate(issue.suggested) })}
                </Button>
              )}
            >
              {issue.kind === 'on_or_before_draw'
                ? t('dates.onDraw', 'The first payment ({{payment}}) should come after the draw ({{draw}}), usually one month later.', { payment: shortDate(issue.firstPayment), draw: shortDate(issue.firstDraw) })
                : t('dates.longGap', 'The first payment ({{payment}}) is {{days}} days after the draw ({{draw}}). Banks usually charge the first payment one month after the draw.', { payment: shortDate(issue.firstPayment), draw: shortDate(issue.firstDraw), days: issue.days })}
            </Alert>
          );
        })()}

        <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mt: 2, mb: 1, color: 'text.secondary' }}>
          {t('tranches.title', 'Drawdowns')}
        </Typography>
        <Stack spacing={1}>
          {track.tranches.map((tranche, trancheIndex) => (
            <Grid key={trancheIndex} container spacing={1} sx={{ alignItems: 'center' }}>
              <Grid size={{ xs: 6, md: 3 }}>
                <DateField
                  label={t('tranches.date', 'Draw date')}
                  value={tranche.drawDate}
                  onChange={(value) => updateTranche(index, trancheIndex, { drawDate: value || '' })}
                  required
                />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <NumberField
                  label={t('tranches.amount', 'Amount')}
                  value={tranche.amount}
                  onChange={(value) => updateTranche(index, trancheIndex, { amount: value })}
                  required
                  step="1000"
                  adornment="₪"
                />
              </Grid>
              <Grid size={{ xs: 6, md: 2.5 }}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label={t('tranches.status', 'Status')}
                  value={tranche.status}
                  onChange={(event) => {
                    const status = event.target.value as MortgageTranche['status'];
                    // Marking a planned draw as drawn keeps the market rate it was priced at
                    // (editable: replace it with the bank's actual rate).
                    const assumed = preview.data?.schedule?.tracks?.[index]?.tranches?.[trancheIndex]?.assumedRate;
                    const keepAssumed = meta.needsRate && status === 'drawn' && tranche.status === 'planned'
                      && (tranche.rate === null || tranche.rate === undefined) && typeof assumed === 'number' && Number.isFinite(assumed);
                    updateTranche(index, trancheIndex, keepAssumed ? { status, rate: Math.round(assumed * 10000) / 10000 } : { status });
                  }}
                >
                  <MenuItem value="drawn">{t('tranches.drawn', 'Drawn')}</MenuItem>
                  <MenuItem value="planned">{t('tranches.planned', 'Planned')}</MenuItem>
                </TextField>
              </Grid>
              {meta.needsRate ? (
                <Grid size={{ xs: 5, md: 2.5 }}>
                  <NumberField
                    label={t('tranches.rate', 'Rate (if different)')}
                    value={tranche.rate}
                    onChange={(value) => updateTranche(index, trancheIndex, { rate: value })}
                    step="0.01"
                    adornment="%"
                    helperText={tranche.status === 'planned' && (tranche.rate === null || tranche.rate === undefined)
                      ? t('tranches.marketRate', 'Empty = market average')
                      : undefined}
                  />
                </Grid>
              ) : <Grid size={{ xs: 5, md: 2.5 }} />}
              <Grid size={{ xs: 1, md: 1 }}>
                <IconButton
                  size="small"
                  disabled={track.tranches.length <= 1}
                  onClick={() => updateTrack(index, { tranches: track.tranches.filter((_, position) => position !== trancheIndex) })}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Grid>
            </Grid>
          ))}
        </Stack>
        <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => updateTrack(index, {
              tranches: [...track.tranches, { drawDate: todayIso(), amount: null, status: 'planned', rate: null, termMode: 'same_maturity' }],
            })}
          >
            {t('tranches.add', 'Add drawdown')}
          </Button>
          {draft.tracks.length > 1 ? (
            <Tooltip title={t('dates.applyAllHint', 'Copies this track\'s draw date and first payment date to the other tracks: a mortgage\'s tracks are usually drawn and paid together.')}>
              <Button size="small" onClick={() => setDraft((previous) => applyDatesToAllTracks(previous, index))}>
                {t('dates.applyAll', 'Use these dates for all tracks')}
              </Button>
            </Tooltip>
          ) : null}
          <Button
            size="small"
            endIcon={expandedStatement[index] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            onClick={() => setExpandedStatement((previous) => ({ ...previous, [index]: !previous[index] }))}
          >
            {t('statement.toggle', 'Bank statement check')}
          </Button>
        </Box>
        <Collapse in={Boolean(expandedStatement[index])}>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1, mb: 1 }}>
            {t('statement.hint', 'Enter the balance shown in your bank report for this track. The projection restarts from it, so small differences in bank conventions don\'t accumulate.')}
          </Typography>
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 6, md: 4 }}>
              <DateField
                label={t('statement.date', 'Statement date')}
                value={track.anchor?.date}
                onChange={(value) => updateTrack(index, { anchor: value ? { ...(track.anchor || { balance: null }), date: value } : null })}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 4 }}>
              <NumberField
                label={t('statement.balance', 'Balance on statement')}
                value={track.anchor?.balance}
                onChange={(value) => updateTrack(index, { anchor: { ...(track.anchor || { date: todayIso() }), balance: value } })}
                step="1"
                adornment="₪"
              />
            </Grid>
            <Grid size={{ xs: 6, md: 4 }}>
              <NumberField
                label={t('statement.remaining', 'Payments remaining')}
                value={track.anchor?.remainingMonths}
                onChange={(value) => updateTrack(index, { anchor: { ...(track.anchor || { date: todayIso(), balance: null }), remainingMonths: value } })}
                step="1"
              />
            </Grid>
          </Grid>
        </Collapse>
      </Paper>
    );
  };

  const renderEvent = (event: MortgageEvent, index: number) => (
    <Grid key={index} container spacing={1} sx={{ alignItems: 'center' }}>
      <Grid size={{ xs: 6, md: 2.5 }}>
        <TextField
          select
          fullWidth
          size="small"
          label={t('events.type', 'Event')}
          value={event.type}
          onChange={(e) => updateEvent(index, { type: e.target.value as MortgageEvent['type'] })}
        >
          <MenuItem value="prepay_partial">{t('events.prepay_partial', 'Partial prepayment')}</MenuItem>
          <MenuItem value="prepay_full">{t('events.prepay_full', 'Full repayment')}</MenuItem>
          <MenuItem value="rate_override">{t('events.rate_override', 'Rate change')}</MenuItem>
        </TextField>
      </Grid>
      <Grid size={{ xs: 6, md: 2.5 }}>
        <TextField
          select
          fullWidth
          size="small"
          label={t('events.track', 'Track')}
          value={event.trackIndex ?? ''}
          onChange={(e) => updateEvent(index, { trackIndex: Number(e.target.value) })}
        >
          {draft.tracks.map((track, trackIndex) => (
            <MenuItem key={trackIndex} value={trackIndex}>{track.label || trackTypeLabel(track.type)}</MenuItem>
          ))}
        </TextField>
      </Grid>
      <Grid size={{ xs: 6, md: 2 }}>
        <DateField label={t('events.date', 'Date')} value={event.date} onChange={(value) => updateEvent(index, { date: value || '' })} required />
      </Grid>
      {event.type === 'prepay_partial' ? (
        <>
          <Grid size={{ xs: 6, md: 2 }}>
            <NumberField label={t('events.amount', 'Amount')} value={event.amount} onChange={(value) => updateEvent(index, { amount: value })} required step="1000" adornment="₪" />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <TextField
              select
              fullWidth
              size="small"
              label={t('events.mode', 'Then')}
              value={event.mode || 'reduce_payment'}
              onChange={(e) => updateEvent(index, { mode: e.target.value as MortgageEvent['mode'] })}
            >
              <MenuItem value="reduce_payment">{t('events.reduce_payment', 'Lower the payment')}</MenuItem>
              <MenuItem value="reduce_term">{t('events.reduce_term', 'Shorten the term')}</MenuItem>
            </TextField>
          </Grid>
        </>
      ) : null}
      {event.type === 'rate_override' ? (
        <Grid size={{ xs: 6, md: 2 }}>
          <NumberField label={t('events.rate', 'New rate')} value={event.rate} onChange={(value) => updateEvent(index, { rate: value })} required step="0.01" adornment="%" />
        </Grid>
      ) : null}
      {event.type !== 'rate_override' ? (
        <Grid size={{ xs: 5, md: event.type === 'prepay_partial' ? 0.5 : 2 }}>
          {event.type === 'prepay_full' ? (
            <NumberField label={t('events.fee', 'Fee paid')} value={event.fee} onChange={(value) => updateEvent(index, { fee: value })} step="100" adornment="₪" />
          ) : null}
        </Grid>
      ) : null}
      <Grid size={{ xs: 1, md: 0.5 }}>
        <IconButton size="small" onClick={() => setDraft((previous) => ({ ...previous, events: previous.events.filter((_, position) => position !== index) }))}>
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Grid>
    </Grid>
  );

  const summary = preview.data?.summary;
  const warnings = (summary?.warnings || []).filter((warning) => warning.code !== 'anchor_applied');

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{title || t('editorTitle', 'Mortgage tracks')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('editorIntro', 'Enter each track (מסלול) as it appears in your mortgage contract. Prime follows the Bank of Israel rate and CPI-linked tracks follow the published index automatically.')}
          </Typography>
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                size="small"
                label={t('fields.lender', 'Lender')}
                value={draft.lender || ''}
                onChange={(event) => setDraft((previous) => ({ ...previous, lender: event.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <NumberField
                label={t('fields.approvedAmount', 'Approved loan amount')}
                value={draft.approvedAmount}
                onChange={(value) => setDraft((previous) => ({ ...previous, approvedAmount: value }))}
                step="1000"
                adornment="₪"
                helperText={t('fields.drawnSummary', 'Drawn {{drawn}} · planned {{planned}}', { drawn: money(totals.drawn), planned: money(totals.planned) })}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                select
                fullWidth
                size="small"
                label={t('fields.brokenPeriod', 'First-period interest')}
                value={draft.options?.brokenPeriodInterest || 'monthly'}
                onChange={(event) => setDraft((previous) => ({
                  ...previous,
                  options: { ...previous.options, brokenPeriodInterest: event.target.value as 'monthly' | 'actual_days' | 'separate' },
                }))}
              >
                <MenuItem value="monthly">{t('brokenPeriod.monthly', 'Regular month')}</MenuItem>
                <MenuItem value="actual_days">{t('brokenPeriod.actual_days', 'Actual days since the draw')}</MenuItem>
                <MenuItem value="separate">{t('brokenPeriod.separate', 'Charged apart on the next payment day (interest only)')}</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Tooltip title={t('fields.primeLagHint', 'Some banks reprice prime only from the installment after a Bank of Israel decision. Compare with your debits.')}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label={t('fields.primeLag', 'Prime changes apply')}
                  value={String(draft.options?.primeChangeLagMonths ?? 0)}
                  onChange={(event) => setDraft((previous) => ({
                    ...previous,
                    options: { ...previous.options, primeChangeLagMonths: event.target.value === '1' ? 1 : 0 },
                  }))}
                >
                  <MenuItem value="0">{t('primeLag.next', 'From the next payment')}</MenuItem>
                  <MenuItem value="1">{t('primeLag.later', 'One payment later')}</MenuItem>
                </TextField>
              </Tooltip>
            </Grid>
          </Grid>

          {draft.tracks.map(renderTrack)}
          <Box>
            <Button startIcon={<AddIcon />} onClick={() => setDraft((previous) => ({ ...previous, tracks: [...previous.tracks, createTrackLike(previous.tracks[0], 'fixed_unlinked')] }))}>
              {t('actions.addTrack', 'Add track')}
            </Button>
          </Box>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{t('offPlan.title', 'Buying off-plan? Add the remaining drawdown')}</Typography>
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1.5 }}>
              {t('offPlan.hint', 'Splits the amount across tracks in the same proportions as what was already drawn. Fixed tracks without a rate are priced at the Bank of Israel market average.')}
            </Typography>
            {planned.total > 0 ? (
              <Alert
                severity="info"
                sx={{ mb: 1.5 }}
                action={delivery.date ? (
                  <Button color="inherit" size="small" onClick={() => setDraft((previous) => resplitPlannedDrawdowns(previous, delivery.date as string))}>
                    {t('offPlan.resplit', 'Re-split with the same mix')}
                  </Button>
                ) : undefined}
              >
                {t('offPlan.alreadyPlanned', '{{amount}} is already planned: {{split}}. Re-split it to follow the mix of what was drawn, on the delivery date below.', {
                  amount: money(planned.total),
                  split: planned.byTrack.map((item) => `${draft.tracks[item.index].label || trackTypeLabel(draft.tracks[item.index].type)} ${money(item.amount)}`).join(', '),
                })}
              </Alert>
            ) : null}
            <Grid container spacing={1.5} sx={{ alignItems: 'center' }}>
              <Grid size={{ xs: 6, md: 4 }}>
                <DateField label={t('offPlan.date', 'Expected delivery')} value={delivery.date} onChange={(value) => setDelivery((previous) => ({ ...previous, date: value }))} />
              </Grid>
              <Grid size={{ xs: 6, md: 4 }}>
                <NumberField
                  label={t('offPlan.amount', 'Amount still to draw')}
                  value={delivery.amount ?? remainingToDraw}
                  onChange={(value) => setDelivery((previous) => ({ ...previous, amount: value }))}
                  step="1000"
                  adornment="₪"
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Button
                  variant="outlined"
                  disabled={!delivery.date || !((delivery.amount ?? remainingToDraw ?? 0) > 0) || totals.drawn <= 0}
                  onClick={() => setDraft((previous) => addRemainingAtDelivery(previous, delivery.date as string, (delivery.amount ?? remainingToDraw) as number))}
                >
                  {t('offPlan.apply', 'Add with the same mix')}
                </Button>
              </Grid>
            </Grid>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{t('events.title', 'Prepayments and changes')}</Typography>
            <Stack spacing={1}>{draft.events.map(renderEvent)}</Stack>
            <Button
              size="small"
              startIcon={<AddIcon />}
              sx={{ mt: 1 }}
              onClick={() => setDraft((previous) => ({
                ...previous,
                events: [...previous.events, { type: 'prepay_partial', date: todayIso(), trackIndex: 0, amount: null, mode: 'reduce_payment' }],
              }))}
            >
              {t('events.add', 'Add event')}
            </Button>
          </Paper>
        </Stack>
      </DialogContent>
      <Divider />
      <Box sx={{ px: 3, py: 1.5, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        {preview.loading ? <CircularProgress size={16} /> : null}
        {summary ? (
          <>
            <Typography variant="body2">
              {t('preview.nextPayment', 'Next payment')}: <strong>{money(summary.nextPayment)}</strong>
            </Typography>
            <Typography variant="body2">
              {t('preview.balance', 'Balance')}: <strong>{money(summary.balance)}</strong>
            </Typography>
            <Typography variant="body2">
              {t('preview.totalCost', 'Total interest + indexation')}: <strong>{money(summary.totalCost)}</strong>
            </Typography>
          </>
        ) : !preview.computable ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('preview.incomplete', 'Fill in the required fields to see the payment.')}
          </Typography>
        ) : null}
        {preview.error ? <Typography variant="body2" color="error">{preview.error}</Typography> : null}
      </Box>
      {warnings.length > 0 ? (
        <Alert severity="info" sx={{ mx: 3, mb: 1 }}>
          {warnings.map((warning) => warning.message).join(' · ')}
        </Alert>
      ) : null}
      {saveError ? <Alert severity="error" sx={{ mx: 3, mb: 1 }}>{saveError}</Alert> : null}
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('actions.cancel', 'Cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !preview.computable}>
          {saving ? <CircularProgress size={18} /> : t('actions.save', 'Save mortgage')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MortgageTracksDialog;
