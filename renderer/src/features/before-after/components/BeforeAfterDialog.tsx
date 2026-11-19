import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import {
  categoryLabel, formatDay, formatPeriodLabel, toAppLocale,
} from '@renderer/features/analysis/components/rhythm/rhythm-format';
import { useBeforeAfter } from '../hooks/useBeforeAfter';
import type {
  BeforeAfterCategory, BeforeAfterMetrics, BeforeAfterMonth, BeforeAfterResponse, BeforeAfterVerdict, RecurringChange,
} from '../types';

interface BeforeAfterDialogProps {
  open: boolean;
  onClose: () => void;
}

const REQUIRED_MONTHS_AFTER = 2;
const INCOME_CHANGE_NOTE_PERCENT = 10;

function VerdictChip({ verdict }: { verdict: BeforeAfterVerdict }) {
  const { t } = useTranslation('translation', { keyPrefix: 'beforeAfter.verdict' });
  const color = verdict === 'better' ? 'success' : verdict === 'worse' ? 'warning' : 'default';
  return <Chip size="small" color={color} variant={verdict === 'unchanged' || verdict === 'insufficient' ? 'outlined' : 'filled'} label={t(verdict)} />;
}

interface MetricTileProps {
  title: string;
  caption: string;
  before: string;
  after: string;
  verdict: BeforeAfterVerdict;
  detail?: string | null;
  beforeLabel?: string;
  afterLabel?: string;
}

function MetricTile({ title, caption, before, after, verdict, detail, beforeLabel, afterLabel }: MetricTileProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'beforeAfter' });
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{title}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{caption}</Typography>
        </Box>
        <VerdictChip verdict={verdict} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap', mt: 'auto' }}>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{beforeLabel ?? t('before')}</Typography>
          <Typography variant="h6" sx={{ color: 'text.secondary', fontWeight: 600 }}>{before}</Typography>
        </Box>
        <ArrowForwardIcon fontSize="small" sx={{ color: 'text.disabled', alignSelf: 'center', transform: (theme) => theme.direction === 'rtl' ? 'scaleX(-1)' : 'none' }} />
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{afterLabel ?? t('after')}</Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>{after}</Typography>
        </Box>
      </Box>
      {detail && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{detail}</Typography>}
    </Paper>
  );
}

function RecurringList({ title, items, empty, dateKey }: {
  title: string;
  items: RecurringChange[];
  empty: string;
  dateKey: 'lastCharge' | 'firstCharge';
}) {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'beforeAfter.subscriptions' });
  const { formatCurrency } = useFinancePrivacy();
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{title}</Typography>
      {items.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{empty}</Typography>
      ) : items.map((item) => (
        <Box key={`${item.name}-${item[dateKey]}`} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.5 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>{item.name}</Typography>
            {item[dateKey] && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t(dateKey, { date: formatDay(item[dateKey] as string, i18n.language) })}
              </Typography>
            )}
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            {t('perYear', { amount: formatCurrency(item.yearlyAmount, { absolute: true }) })}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function LargePayments({ largeOneOffs }: { largeOneOffs: BeforeAfterMetrics['controllableSpend']['largeOneOffs'] }) {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'beforeAfter' });
  const { formatCurrency } = useFinancePrivacy();
  const locale = toAppLocale(i18n.language);
  if (!largeOneOffs.items.length) return null;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('largePayments.title')}</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
        {t('largePayments.subtitle', { threshold: formatCurrency(largeOneOffs.threshold, { absolute: true }) })}
      </Typography>
      {largeOneOffs.items.map((item) => (
        <Box key={`${item.day}-${item.name}-${item.amount}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
          <Chip size="small" variant="outlined" label={t(item.phase)} sx={{ minWidth: 56 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap>{item.name || t('largePayments.unnamed')}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {`${formatDay(item.day, i18n.language)} · ${categoryLabel({ name: item.categoryName, nameEn: item.categoryNameEn, nameFr: item.categoryNameFr }, locale, t('needed.uncategorized'))}`}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            {formatCurrency(item.amount, { absolute: true })}
          </Typography>
        </Box>
      ))}
    </Paper>
  );
}

function NeededCategories({ categories, saving, onToggle, onReset }: {
  categories: BeforeAfterCategory[];
  saving: boolean;
  onToggle: (key: string, needed: boolean) => void;
  onReset: () => void;
}) {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'beforeAfter.needed' });
  const { formatCurrency } = useFinancePrivacy();
  const [expanded, setExpanded] = useState(false);
  const locale = toAppLocale(i18n.language);
  const money = (value: number) => formatCurrency(value, { absolute: true });
  const hasOverrides = categories.some((category) => category.overridden);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box
        component="button"
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        sx={{
          all: 'unset', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
        }}
      >
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('title')}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('subtitle')}</Typography>
        </Box>
        <ExpandMoreIcon sx={{ transition: 'transform 160ms ease', transform: expanded ? 'rotate(180deg)' : 'none' }} />
      </Box>
      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ mt: 1.5 }}>
          {categories.map((category) => (
            <Box key={category.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
              <Checkbox
                size="small"
                checked={category.needed}
                disabled={saving}
                onChange={(event) => onToggle(category.key, event.target.checked)}
                slotProps={{ input: { 'aria-label': categoryLabel(category, locale, t('uncategorized')) } }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>{categoryLabel(category, locale, t('uncategorized'))}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t(`reason.${category.defaultReason ?? 'none'}`)}
                  {category.overridden ? ` · ${t('changedByYou')}` : ''}
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                {t('monthly', { before: money(category.beforeMonthly), after: money(category.afterMonthly) })}
              </Typography>
            </Box>
          ))}
          {hasOverrides && (
            <Button size="small" onClick={onReset} disabled={saving} sx={{ mt: 1 }}>{t('reset')}</Button>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

function MonthlyChart({ monthly }: { monthly: BeforeAfterMonth[] }) {
  const theme = useTheme();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'beforeAfter' });
  const { formatCurrency } = useFinancePrivacy();
  const rows = monthly.map((month) => ({ ...month, label: formatPeriodLabel(month.month, 'month', i18n.language) }));
  const colorOf = (phase: BeforeAfterMonth['phase']) => (phase === 'after' ? theme.palette.primary.main : alpha(theme.palette.text.secondary, 0.45));

  const ChartTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as BeforeAfterMonth & { label: string };
    return (
      <Paper sx={{ p: 1.25 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{`${row.label} · ${t(row.phase)}`}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatCurrency(row.controllableSpend, { absolute: true })}</Typography>
      </Paper>
    );
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('chart.title')}</Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {(['before', 'after'] as const).map((phase) => (
            <Box key={phase} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: colorOf(phase) }} />
              <Typography variant="caption">{t(phase)}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
      <ResponsiveContainer width="100%" height={200} minHeight={200}>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.4)} vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} stroke={theme.palette.text.secondary} style={{ fontSize: '0.75rem' }} interval={0} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            stroke={theme.palette.text.secondary}
            style={{ fontSize: '0.75rem' }}
            tickFormatter={(value: number) => formatCurrency(value, { absolute: true, compact: true })}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: alpha(theme.palette.primary.main, 0.06) }} />
          <Bar dataKey="controllableSpend" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.month} fill={colorOf(row.phase)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Paper>
  );
}

function ReadyView({ data, saving, onToggle, onReset }: {
  data: BeforeAfterResponse;
  saving: boolean;
  onToggle: (key: string, needed: boolean) => void;
  onReset: () => void;
}) {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'beforeAfter' });
  const { formatCurrency } = useFinancePrivacy();
  const metrics = data.metrics!;
  const windows = data.windows!;
  const money = (value: number | null | undefined) => (value == null ? '—' : formatCurrency(value, { absolute: value >= 0 }));
  const monthLabel = (month: string) => formatPeriodLabel(month, 'month', i18n.language);
  const range = (months: string[]) => (months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}`);
  const { controllableSpend, kept, fees, subscriptions, income } = metrics;
  const incomeShift = income.deltaPercent != null && Math.abs(income.deltaPercent) >= INCOME_CHANGE_NOTE_PERCENT;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t('subtitle', { before: range(windows.before!.months), after: range(windows.after!.months), months: windows.months })}
      </Typography>

      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <MetricTile
            title={t('metrics.controllable.title')}
            caption={t('metrics.controllable.caption')}
            before={money(controllableSpend.before)}
            after={money(controllableSpend.after)}
            verdict={controllableSpend.verdict}
            detail={[
              controllableSpend.shareBefore != null && controllableSpend.shareAfter != null
                ? t('metrics.shareOfIncome', { before: Math.round(controllableSpend.shareBefore), after: Math.round(controllableSpend.shareAfter) })
                : null,
              controllableSpend.largeOneOffs.beforeCount + controllableSpend.largeOneOffs.afterCount > 0
                ? t('metrics.controllable.largeLeftOut', {
                  before: controllableSpend.largeOneOffs.beforeCount,
                  after: controllableSpend.largeOneOffs.afterCount,
                })
                : null,
            ].filter(Boolean).join(' · ') || null}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <MetricTile
            title={t('metrics.kept.title')}
            caption={t('metrics.kept.caption')}
            before={money(kept.before)}
            after={money(kept.after)}
            verdict={kept.verdict}
            detail={kept.rateBefore != null && kept.rateAfter != null
              ? t('metrics.shareOfIncome', { before: Math.round(kept.rateBefore), after: Math.round(kept.rateAfter) })
              : null}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <MetricTile
            title={t('metrics.fees.title')}
            caption={t('metrics.fees.caption')}
            before={money(fees.before)}
            after={money(fees.after)}
            verdict={fees.verdict}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <MetricTile
            title={t('metrics.subscriptions.title')}
            caption={t('metrics.subscriptions.caption')}
            before={String(subscriptions.stopped.length)}
            after={String(subscriptions.started.length)}
            beforeLabel={t('metrics.subscriptions.stopped')}
            afterLabel={t('metrics.subscriptions.started')}
            verdict={subscriptions.verdict}
            detail={subscriptions.stopped.length || subscriptions.started.length
              ? t('metrics.subscriptions.net', { amount: formatCurrency(subscriptions.netYearly, { showSign: true }) })
              : null}
          />
        </Grid>
      </Grid>

      {incomeShift && (
        <Alert severity="info" variant="outlined">
          {t('incomeNote', { before: money(income.before), after: money(income.after), percent: income.deltaPercent })}
        </Alert>
      )}

      <MonthlyChart monthly={data.monthly} />

      <LargePayments largeOneOffs={controllableSpend.largeOneOffs} />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <RecurringList title={t('subscriptions.stoppedTitle')} items={subscriptions.stopped} empty={t('subscriptions.noneStopped')} dateKey="lastCharge" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <RecurringList title={t('subscriptions.startedTitle')} items={subscriptions.started} empty={t('subscriptions.noneStarted')} dateKey="firstCharge" />
          </Grid>
        </Grid>
      </Paper>

      <NeededCategories categories={data.categories} saving={saving} onToggle={onToggle} onReset={onReset} />

      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('method', { months: windows.months })}
      </Typography>
    </Box>
  );
}

function PendingView({ data }: { data: BeforeAfterResponse }) {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'beforeAfter' });
  const date = (day: string | null | undefined) => (day ? formatDay(day, i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const firstSync = date(data.frontier?.day);

  if (data.status === 'no_sync') {
    return <Alert severity="info">{t('states.noSync')}</Alert>;
  }
  if (data.status === 'no_history') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t('states.noHistory.title')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('states.noHistory.body', { date: firstSync })}</Typography>
      </Box>
    );
  }
  const done = Math.min(data.windows?.fullMonthsAfter ?? 0, REQUIRED_MONTHS_AFTER);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t('states.waiting.title')}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t('states.waiting.body', { date: firstSync, readyOn: date(data.windows?.readyOn) })}
      </Typography>
      <LinearProgress variant="determinate" value={(done / REQUIRED_MONTHS_AFTER) * 100} sx={{ height: 8, borderRadius: 4 }} />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('states.waiting.progress', { done, total: REQUIRED_MONTHS_AFTER })}
      </Typography>
    </Box>
  );
}

const BeforeAfterDialog: React.FC<BeforeAfterDialogProps> = ({ open, onClose }) => {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'beforeAfter' });
  const { data, loading, saving, error, reload, setNeeded, resetNeeded } = useBeforeAfter(open);
  const firstSync = useMemo(() => (data?.frontier?.day
    ? formatDay(data.frontier.day, i18n.language, { day: 'numeric', month: 'long', year: 'numeric' })
    : null), [data?.frontier?.day, i18n.language]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth aria-labelledby="before-after-title">
      <DialogTitle id="before-after-title" sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography variant="h6" component="span" sx={{ fontWeight: 800, display: 'block' }}>{t('title')}</Typography>
          {firstSync && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('firstSync', { date: firstSync })}</Typography>
          )}
        </Box>
        <IconButton onClick={onClose} size="small" aria-label={t('close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {loading && !data && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} aria-label={t('loading')} />
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={reload}>{t('retry')}</Button>}>
            {t('error')}
          </Alert>
        )}
        {data && data.status === 'ready' && data.metrics && (
          <ReadyView data={data} saving={saving} onToggle={setNeeded} onReset={resetNeeded} />
        )}
        {data && data.status !== 'ready' && <PendingView data={data} />}
      </DialogContent>
    </Dialog>
  );
};

export default BeforeAfterDialog;
