import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Dialog, DialogTitle, DialogContent, IconButton, Box, Typography,
  CircularProgress, Grid, Paper, useTheme, Alert, Button, alpha,
  Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup,
  Menu, MenuItem, Checkbox, ListItemText, ListSubheader, Chip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useTranslation } from 'react-i18next';
import { format, subMonths } from 'date-fns';
import { apiClient } from '@renderer/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { PLANNING_CHANGED_EVENT } from '@renderer/features/planning/types';
import {
  applyPlanOverlay, hasActivePlans, isPlanOverlay, overlayHorizon,
  type PlanOverlay, type PlanSelection,
} from '../utils/plan-overlay';

interface PersonalizedFutureModalProps {
  open: boolean;
  onClose: () => void;
}

const CACHE_DURATION_MS = 60 * 1000;
const HISTORY_RANGES = ['3', '6', 'all'] as const;
type HistoryRange = typeof HISTORY_RANGES[number];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const PLAN_SELECTION_KEY = 'shekelsync.cashFlowOutlook.plans';
const DEFAULT_PLAN_SELECTION: PlanSelection = { goals: true, scenarioIds: [] };

function readPlanSelection(): PlanSelection {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAN_SELECTION_KEY) || 'null');
    if (parsed && typeof parsed.goals === 'boolean' && Array.isArray(parsed.scenarioIds)) {
      return { goals: parsed.goals, scenarioIds: parsed.scenarioIds.filter((id: unknown) => Number.isInteger(id)) };
    }
  } catch { /* storage unavailable */ }
  return DEFAULT_PLAN_SELECTION;
}

const PersonalizedFutureModal: React.FC<PersonalizedFutureModalProps> = ({ open, onClose }) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.modals.future' });
  const { formatCurrency } = useFinancePrivacy();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState(0);
  const [investmentBasis, setInvestmentBasis] = useState<'before' | 'after'>('after');
  const [historyRange, setHistoryRange] = useState<HistoryRange>('3');
  const requestSequence = useRef(0);
  const [planSelection, setPlanSelection] = useState<PlanSelection>(readPlanSelection);
  const [overlay, setOverlay] = useState<PlanOverlay | null>(null);
  const [overlayFailed, setOverlayFailed] = useState(false);
  const [planRevision, setPlanRevision] = useState(0);
  const [plansMenuAnchor, setPlansMenuAnchor] = useState<HTMLElement | null>(null);
  const overlaySequence = useRef(0);

  const fetchData = useCallback(async (force = false) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get('/api/analytics/forecast-extended', {
        ...(force ? { params: { noCache: 'true' }, cacheMode: 'reload' as const } : {}),
      });
      if (!response.ok) throw new Error(t('fetchFailed'));
      if (sequence !== requestSequence.current) return;
      setData(response.data);
      setLastFetch(Date.now());
    } catch (err) {
      if (sequence === requestSequence.current) setError(err instanceof Error ? err.message : t('fetchFailed'));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open && (!data || Date.now() - lastFetch > CACHE_DURATION_MS)) void fetchData();
  }, [data, fetchData, lastFetch, open]);

  useEffect(() => {
    const changed = () => {
      if (open) void fetchData(true);
      else {
        requestSequence.current++;
        setData(null);
        setLastFetch(0);
      }
    };
    window.addEventListener('financialTruthChanged', changed);
    // Mortgage and account edits change the forecast without a truth revision.
    window.addEventListener('dataRefresh', changed);
    return () => {
      window.removeEventListener('financialTruthChanged', changed);
      window.removeEventListener('dataRefresh', changed);
    };
  }, [fetchData, open]);

  useEffect(() => {
    const changed = () => setPlanRevision(revision => revision + 1);
    window.addEventListener(PLANNING_CHANGED_EVENT, changed);
    return () => window.removeEventListener(PLANNING_CHANGED_EVENT, changed);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(PLAN_SELECTION_KEY, JSON.stringify(planSelection)); } catch { /* storage unavailable */ }
  }, [planSelection]);

  // Plans are layered on the forecast: refetch with each forecast, selection or plan edit.
  const forecastPeriod = data?.forecastPeriod;
  useEffect(() => {
    if (!open || !data) return;
    const sequence = ++overlaySequence.current;
    const params: Record<string, string> = {
      horizon_days: String(overlayHorizon(forecastPeriod)),
      goals: planSelection.goals ? '1' : '0',
      ...(planSelection.scenarioIds.length ? { scenario_ids: planSelection.scenarioIds.join(',') } : {}),
    };
    apiClient.get('/api/planning/forecast-overlay', { params, cacheMode: 'no-store' as const })
      .then((response) => {
        if (sequence !== overlaySequence.current) return;
        const valid = response.ok && isPlanOverlay(response.data);
        setOverlay(valid ? response.data as PlanOverlay : null);
        setOverlayFailed(!valid);
      })
      .catch(() => {
        if (sequence !== overlaySequence.current) return;
        setOverlay(null);
        setOverlayFailed(true);
      });
  }, [data, forecastPeriod, open, planRevision, planSelection]);

  const currency = (value: unknown) => finite(value)
    ? formatCurrency(value, { absolute: false, maximumFractionDigits: 0 }) : t('unavailable');
  const dateLabel = (date: string, full = false) => {
    const parsed = new Date(`${date}T12:00:00`);
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString(i18n.language, {
      month: 'short', day: 'numeric', ...(full ? { year: 'numeric' as const } : {}),
    }) : date;
  };
  // Older payloads carry a single basis at the top level.
  const view = (data?.hasInvestments && data.investmentBases?.[investmentBasis]) || data;
  // History is anchored backwards from today, so trimming its start changes no value.
  const historyStart = historyRange === 'all' ? null : format(subMonths(new Date(), Number(historyRange)), 'yyyy-MM-dd');
  const chartData = (view?.combinedData || [])
    .filter((day: any) => !historyStart || day.historicalCumulative === null || day.date >= historyStart)
    .map((day: any) => ({
    ...day,
    forecastRange: finite(day.p10Cumulative) && finite(day.p90Cumulative)
      ? [day.p10Cumulative, day.p90Cumulative] : null,
  }));
  const hasExpected = chartData.some((day: any) => finite(day.expectedCumulative));
  const hasRange = chartData.some((day: any) => day.historicalCumulative === null && day.forecastRange);
  const historicalEnd = [...chartData].reverse().find((day: any) => finite(day.historicalCumulative));
  const startingBalance = finite(data?.startingBalance) ? data.startingBalance : historicalEnd?.historicalCumulative;
  const closing = (summary: any) => finite(summary?.endingBalance) ? summary.endingBalance
    : finite(summary?.netCashFlow) && finite(startingBalance) ? startingBalance + summary.netCashFlow : null;
  const balanceWarning = data?.balanceStatus === 'missing_exchange_rate' ? 'missingExchangeRate'
    : data?.balanceStatus === 'incomplete' ? 'incompleteBalance' : 'missingBalance';
  const plansActive = data?.hasCurrentBalance !== false && hasActivePlans(overlay, planSelection);
  const planned = applyPlanOverlay(chartData, plansActive ? overlay : null, startingBalance);
  const plotData = plansActive ? planned.rows : chartData;
  const showFloor = plansActive && planned.rows.some((day: any) => finite(day.reservedFloor) && day.reservedFloor > 0);
  const knownScenarioIds = new Set((overlay?.scenarios || []).map(scenario => scenario.id));
  const selectedScenarios = planSelection.scenarioIds.filter(id => knownScenarioIds.has(id));
  const selectedPlanCount = (planSelection.goals && overlay?.goals.length ? 1 : 0) + selectedScenarios.length;
  const hasPlans = Boolean(overlay && (overlay.goals.length || overlay.scenarios.length));
  const toggleScenario = (id: number) => setPlanSelection(current => ({
    ...current,
    scenarioIds: current.scenarioIds.includes(id) ? current.scenarioIds.filter(item => item !== id) : [...current.scenarioIds, id],
  }));
  const availableDelta = overlay && selectedScenarios.length && finite(overlay.available_spend) && finite(overlay.available_spend_baseline)
    ? overlay.available_spend - overlay.available_spend_baseline : 0;
  const summaries = [
    { key: 'pessimistic', title: t('scenarios.bad'), description: t('scenarios.lowerDescription'), color: theme.palette.text.secondary },
    { key: 'base', title: t('scenarios.normal'), description: t('scenarios.expectedDescription'), color: theme.palette.primary.main },
    { key: 'optimistic', title: t('scenarios.good'), description: t('scenarios.upperDescription'), color: theme.palette.text.secondary },
  ];

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    return <Paper sx={{ p: 1.5 }}>
      <Typography variant="caption" color="text.secondary">{dateLabel(payload[0].payload.date, true)}</Typography>
      {payload.map((entry: any) => <Typography key={entry.dataKey} variant="body2" sx={{ color: entry.color, mt: 0.5 }}>
        {entry.name}: {Array.isArray(entry.value) ? `${currency(entry.value[0])} – ${currency(entry.value[1])}` : currency(entry.value)}
      </Typography>)}
    </Paper>;
  };

  return <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
    <DialogTitle>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
        <Box>
          <Typography variant="h5" component="span" sx={{ fontWeight: 700 }}>{t('title')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t('subtitle')}</Typography>
        </Box>
        <Box sx={{ display: 'flex' }}>
          <IconButton aria-label={t('refresh')} onClick={() => void fetchData(true)} disabled={loading}><RefreshIcon /></IconButton>
          <IconButton aria-label={t('close')} onClick={onClose}><CloseIcon /></IconButton>
        </Box>
      </Box>
    </DialogTitle>
    <DialogContent dividers sx={{ p: { xs: 2, sm: 3 } }}>
      {loading ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
        : error ? <Alert severity="error" action={<Button onClick={() => void fetchData(true)}>{t('retry')}</Button>}>{error}</Alert>
        : data ? <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="body2">{t('startingPosition')}: <strong>{data.hasCurrentBalance === false ? t('unavailable') : currency(startingBalance)}</strong></Typography>
              {data.forecastPeriod?.end && <Typography variant="body2" color="text.secondary">{t('through', { date: dateLabel(data.forecastPeriod.end, true) })}</Typography>}
            </Box>
          </Grid>
          {data.hasCurrentBalance === false && <Grid size={{ xs: 12 }}><Alert severity="info">{t(balanceWarning)}</Alert></Grid>}
          <Grid size={{ xs: 12 }}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t(data.hasCurrentBalance === false ? 'cashFlowChange' : 'netPosition.title')}</Typography>
                  <Typography variant="caption" color="text.secondary">{t('netPosition.subtitle')}</Typography>
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  <ToggleButtonGroup
                    value={historyRange}
                    exclusive
                    size="small"
                    aria-label={t('historyRange.label')}
                    onChange={(_, range: HistoryRange | null) => range && setHistoryRange(range)}
                  >
                    {HISTORY_RANGES.map(range => <ToggleButton key={range} value={range}>{t(`historyRange.${range}`)}</ToggleButton>)}
                  </ToggleButtonGroup>
                  {data.hasInvestments && data.investmentBases && <ToggleButtonGroup
                    value={investmentBasis}
                    exclusive
                    size="small"
                    aria-label={t('investmentBasis.label')}
                    onChange={(_, basis: 'before' | 'after' | null) => basis && setInvestmentBasis(basis)}
                  >
                    <ToggleButton value="before">{t('investmentBasis.before')}</ToggleButton>
                    <ToggleButton value="after">{t('investmentBasis.after')}</ToggleButton>
                  </ToggleButtonGroup>}
                  {hasPlans && data.hasCurrentBalance !== false && <>
                    <Button
                      size="small"
                      variant={selectedPlanCount ? 'contained' : 'outlined'}
                      aria-haspopup="menu"
                      aria-expanded={Boolean(plansMenuAnchor)}
                      onClick={(event) => setPlansMenuAnchor(event.currentTarget)}
                    >
                      {selectedPlanCount ? t('plans.buttonCount', { count: String(selectedPlanCount) }) : t('plans.button')}
                    </Button>
                    <Menu
                      anchorEl={plansMenuAnchor}
                      open={Boolean(plansMenuAnchor)}
                      onClose={() => setPlansMenuAnchor(null)}
                      slotProps={{ list: { 'aria-label': t('plans.menuLabel'), dense: true } }}
                    >
                      <MenuItem
                        disabled={!overlay?.goals.length}
                        onClick={() => setPlanSelection(current => ({ ...current, goals: !current.goals }))}
                      >
                        <Checkbox size="small" edge="start" checked={planSelection.goals && Boolean(overlay?.goals.length)} tabIndex={-1} disableRipple />
                        <ListItemText primary={t('plans.goals')} secondary={t('plans.goalsHint', { count: String(overlay?.goals.length || 0) })} />
                      </MenuItem>
                      <ListSubheader>{t('plans.scenariosTitle')}</ListSubheader>
                      {overlay?.scenarios.length ? overlay.scenarios.map(scenario => <MenuItem key={scenario.id} onClick={() => toggleScenario(scenario.id)}>
                        <Checkbox size="small" edge="start" checked={selectedScenarios.includes(scenario.id)} tabIndex={-1} disableRipple />
                        <ListItemText primary={scenario.name} />
                      </MenuItem>) : <MenuItem disabled>{t('plans.noScenarios')}</MenuItem>}
                    </Menu>
                  </>}
                </Box>
              </Box>
              <ResponsiveContainer width="100%" height={300} minHeight={300}>
                <ComposedChart data={plotData} margin={{ top: 15, right: 12, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.5)} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={date => dateLabel(date)} minTickGap={45} tickLine={false} axisLine={false} style={{ fontSize: '0.75rem' }} />
                  <YAxis tickFormatter={currency} domain={['auto', 'auto']} width={90} tickLine={false} axisLine={false} style={{ fontSize: '0.75rem' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '0.875rem' }} />
                  <ReferenceLine y={0} stroke={theme.palette.text.secondary} strokeDasharray="3 3" />
                  {hasRange && <Area type="linear" dataKey="forecastRange" stroke="none" fill={theme.palette.primary.main} fillOpacity={0.13} name={t('netPosition.range')} isAnimationActive={false} />}
                  <Line type="linear" dataKey="historicalCumulative" stroke={theme.palette.text.secondary} strokeWidth={2} name={t('netPosition.historical')} dot={false} isAnimationActive={false} />
                  <Line type="linear" dataKey={hasExpected ? 'expectedCumulative' : 'p50Cumulative'} stroke={theme.palette.primary.main} strokeWidth={2.5} strokeDasharray="5 4" name={t('scenarios.normal')} dot={false} isAnimationActive={false} />
                  {plansActive && <Line type="linear" dataKey="plannedCumulative" stroke={theme.palette.secondary.main} strokeWidth={2.5} strokeDasharray="2 3" name={t('plans.line')} dot={false} connectNulls isAnimationActive={false} />}
                  {showFloor && <Line type="stepAfter" dataKey="reservedFloor" stroke={theme.palette.text.disabled} strokeWidth={1.5} strokeDasharray="1 4" name={t('plans.floor')} dot={false} connectNulls isAnimationActive={false} />}
                </ComposedChart>
              </ResponsiveContainer>
              <Typography variant="caption" color="text.secondary">{t('rangeNote')}</Typography>
            </Paper>
          </Grid>
          {data.hasCurrentBalance !== false && (overlay || overlayFailed) && <Grid size={{ xs: 12 }}>
            <Paper variant="outlined" data-testid="outlook-plans" sx={{ p: 2, borderRadius: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('plans.title')}</Typography>
                <Button size="small" component={RouterLink} to="/plan?tab=planning" onClick={onClose}>{t('plans.manage')}</Button>
              </Box>
              {overlayFailed ? <Typography variant="body2" color="text.secondary">{t('plans.loadFailed')}</Typography> : overlay && <>
                {!hasPlans && <Typography variant="body2" color="text.secondary">{t('plans.empty')}</Typography>}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, mt: 1 }}>
                  {plansActive && finite(planned.plannedEnding) && <Box>
                    <Typography variant="caption" color="text.secondary">{t('plans.closing')}</Typography>
                    <Typography variant="h6" data-testid="plans-closing" sx={{ fontWeight: 700 }}>{currency(planned.plannedEnding)}</Typography>
                    {finite(planned.expectedEnding) && <Typography variant="body2" color="text.secondary">
                      {t('plans.difference', { amount: currency(planned.plannedEnding - planned.expectedEnding) })}
                    </Typography>}
                  </Box>}
                  {plansActive && planned.plannedLowest && <Box>
                    <Typography variant="caption" color="text.secondary">{t('plans.lowest')}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>{currency(planned.plannedLowest.value)}</Typography>
                    <Typography variant="body2" color="text.secondary">{dateLabel(planned.plannedLowest.date, true)}</Typography>
                  </Box>}
                  <Box>
                    <Typography variant="caption" color="text.secondary">{t('plans.available')}</Typography>
                    {finite(overlay.available_spend) ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Chip color="primary" variant="outlined" data-testid="plans-available"
                        label={overlay.spending_period_end
                          ? t('plans.availableUntil', { amount: currency(overlay.available_spend), date: dateLabel(overlay.spending_period_end) })
                          : currency(overlay.available_spend)} />
                      {availableDelta !== 0 && <Typography variant="body2" color="text.secondary">
                        {t('plans.availableDelta', { amount: currency(availableDelta) })}
                      </Typography>}
                    </Box> : <Typography variant="body2" color="text.secondary">{t('plans.availableUnavailable')}</Typography>}
                  </Box>
                </Box>
                {plansActive && planned.dipDate && <Alert severity="warning" sx={{ mt: 1.5 }}>{t('plans.dip', { date: dateLabel(planned.dipDate, true) })}</Alert>}
                {showFloor && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{t('plans.floorNote')}</Typography>}
              </>}
            </Paper>
          </Grid>}
          {summaries.map(({ key, title, description, color }) => {
            const summary = view.summaries?.[key];
            return <Grid key={key} size={{ xs: 12, md: 4 }}>
              <Paper variant="outlined" sx={{ p: 2.5, height: '100%', boxSizing: 'border-box', borderRadius: 2,
                borderColor: key === 'base' ? theme.palette.primary.main : theme.palette.divider,
                bgcolor: key === 'base' ? alpha(theme.palette.primary.main, 0.04) : 'background.paper' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color }}>{title}</Typography>
                <Typography variant="caption" color="text.secondary">{description}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>{t(data.hasCurrentBalance === false ? 'cashFlowChange' : 'closingPosition')}</Typography>
                <Typography variant="h5" data-testid={`forecast-closing-${key}`} sx={{ fontWeight: 700 }}>{currency(data.hasCurrentBalance === false ? summary?.netCashFlow : closing(summary))}</Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>{t('cashFlowChange')}: {currency(summary?.netCashFlow)}</Typography>
                {key === 'base' && <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                  <Typography variant="body2">{t('income')}: {currency(summary?.income)}</Typography>
                  <Typography variant="body2">{t('expenses')}: {currency(summary?.expenses)}</Typography>
                </Box>}
              </Paper>
            </Grid>;
          })}
          {data.incomeDrivers?.length > 0 && <Grid size={{ xs: 12 }}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('incomeSources.title')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('incomeSources.subtitle')}</Typography>
              {data.incomeDrivers.some((driver: any) => driver.awaitingReceipt) && <Alert severity="info" sx={{ mb: 1 }}>{t('incomeSources.awaitingNote')}</Alert>}
              <Box sx={{ overflowX: 'auto' }}><Table size="small" aria-label={t('incomeSources.title')}>
                <TableHead><TableRow><TableCell>{t('incomeSources.source')}</TableCell><TableCell>{t('incomeSources.next')}</TableCell><TableCell align="right">{t('incomeSources.amount')}</TableCell></TableRow></TableHead>
                <TableBody>{data.incomeDrivers.slice(0, 5).map((driver: any, index: number) => <TableRow key={index}>
                  <TableCell>{driver.source}</TableCell>
                  <TableCell>{driver.awaitingReceipt ? `${t('incomeSources.awaiting')} · ${dateLabel(driver.expectedPaymentDate)}` : dateLabel(driver.nextDate)}</TableCell>
                  <TableCell align="right">{currency(driver.amount)}</TableCell>
                </TableRow>)}</TableBody>
              </Table></Box>
            </Paper>
          </Grid>}
          {data.expenseDrivers?.length > 0 && <Grid size={{ xs: 12 }}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('drivers.title')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('drivers.subtitle')}</Typography>
              <Box sx={{ overflowX: 'auto' }}><Table size="small" aria-label={t('drivers.title')}>
                <TableHead><TableRow><TableCell>{t('drivers.category')}</TableCell><TableCell>{t('drivers.basis')}</TableCell><TableCell align="right">{t('drivers.amount')}</TableCell></TableRow></TableHead>
                <TableBody>{data.expenseDrivers.slice(0, 5).map((driver: any, index: number) => <TableRow key={driver.categoryDefinitionId ?? index}>
                  <TableCell>{i18n.language.startsWith('en') ? driver.categoryNameEn || driver.category : driver.category}</TableCell>
                  <TableCell>{[
                    driver.scheduled > 0 ? t('drivers.scheduled') : null,
                    driver.typical > 0 ? t('drivers.typical') : null,
                    driver.occasional > 0 ? t('drivers.occasional') : null,
                  ].filter(Boolean).join(' · ')}</TableCell>
                  <TableCell align="right">{currency(driver.amount)}</TableCell>
                </TableRow>)}</TableBody>
              </Table></Box>
            </Paper>
          </Grid>}
          <Grid size={{ xs: 12 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="caption" color="text.secondary">{t('assumptionsNote')}</Typography>
              <Button component={RouterLink} to="/review" onClick={onClose}>{t('reviewAssumptions')}</Button>
            </Box>
          </Grid>
        </Grid> : <Typography align="center" color="text.secondary">{t('noData')}</Typography>}
    </DialogContent>
  </Dialog>;
};

export default PersonalizedFutureModal;
