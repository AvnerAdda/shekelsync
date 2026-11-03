import React from 'react';
import {
  Alert,
  Box,
  Button,
  Collapse,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { MortgageSchedule, MortgageSummary, MortgageTrackType } from '@renderer/types/investments';
import CustomTooltip from '../CustomTooltip';
import {
  TRACK_TYPE_FALLBACK_LABELS,
  buildBalanceChartData,
  buildYearlyComposition,
  nominalToEffective,
  seriesColor,
  type PropertyValueContext,
} from './mortgage-utils';

interface MortgageSchedulePanelProps {
  summary: MortgageSummary;
  schedule: MortgageSchedule | null;
  property: PropertyValueContext | null;
}

function compactCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `₪${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `₪${Math.round(value / 1_000)}K`;
  return `₪${Math.round(value)}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function dateLabel(date: string | null): string {
  if (!date) return '-';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const MortgageSchedulePanel: React.FC<MortgageSchedulePanelProps> = ({ summary, schedule, property }) => {
  const theme = useTheme();
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light';
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.mortgage' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const [showTable, setShowTable] = React.useState(false);

  const money = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '-';
    return maskAmounts ? '***' : formatCurrency(value, { absolute: false, maximumFractionDigits: 0 });
  };
  const trackName = (trackId: string) => {
    const track = summary.tracks.find((item) => item.trackId === trackId);
    if (!track) return trackId;
    return track.label || t(`trackTypes.${track.type as MortgageTrackType}`, TRACK_TYPE_FALLBACK_LABELS[track.type]);
  };

  const balanceData = React.useMemo(() => buildBalanceChartData(schedule, property), [schedule, property]);
  const yearly = React.useMemo(() => buildYearlyComposition(schedule), [schedule]);
  const todayMonth = (schedule?.asOf || '').slice(0, 7);
  const trackIds = summary.tracks.map((track) => track.trackId);
  const equityColor = seriesColor(trackIds.length, mode);
  const compositionColors = { principal: seriesColor(0, mode), interest: seriesColor(1, mode), indexation: seriesColor(3, mode) };
  const grid = alpha(theme.palette.divider, 0.6);
  const axisTick = { fill: theme.palette.text.secondary, fontSize: 11 };

  const tiles = [
    { label: t('summary.balance', 'Balance today'), value: money(summary.balance), hint: summary.undrawn > 0 ? t('summary.undrawn', '+ {{amount}} still to draw', { amount: money(summary.undrawn) }) : null },
    { label: t('summary.nextPayment', 'Next payment'), value: money(summary.nextPayment), hint: dateLabel(summary.nextPaymentDate) },
    {
      label: t('summary.rate', 'Weighted rate'),
      value: summary.weightedRate === null ? '-' : `${summary.weightedRate.toFixed(2)}%`,
      hint: summary.weightedRate === null ? null : t('summary.rateEffective', '{{rate}}% effective', { rate: nominalToEffective(summary.weightedRate).toFixed(2) }),
    },
    { label: t('summary.interestPaid', 'Interest paid so far'), value: money(summary.interestPaid), hint: t('summary.interestRemaining', '{{amount}} still to come', { amount: money(summary.interestRemaining) }) },
    { label: t('summary.indexation', 'CPI indexation so far'), value: money(summary.indexationToDate), hint: t('summary.indexationHint', 'Added to linked balances') },
    { label: t('summary.totalCost', 'Cost of the loan'), value: money(summary.totalCost), hint: t('summary.totalCostHint', 'Interest + indexation over the full term') },
    { label: t('summary.payoff', 'Paid off'), value: dateLabel(summary.maturityDate), hint: null },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Grid container spacing={1.5}>
        {tiles.map((tile) => (
          <Grid key={tile.label} size={{ xs: 6, sm: 4, md: 3 }}>
            <Paper variant="outlined" sx={{ p: 1.5, height: '100%', borderRadius: 2 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>{tile.label}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.2 }}>{tile.value}</Typography>
              {tile.hint ? <Typography variant="caption" sx={{ color: 'text.secondary' }}>{tile.hint}</Typography> : null}
            </Paper>
          </Grid>
        ))}
      </Grid>

      {summary.warnings.length > 0 ? (
        <Alert severity="info">{summary.warnings.map((warning) => warning.message).join(' · ')}</Alert>
      ) : null}

      {balanceData.length > 0 ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t('charts.balanceTitle', 'Balance and equity over time')}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
            {t('charts.balanceSubtitle', 'Remaining balance per track (stacked) and your equity: property value grown at your assumption, minus the debt.')}
          </Typography>
          <Box sx={{ height: 300 }} role="img" aria-label={t('charts.balanceTitle', 'Balance and equity over time')}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={balanceData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={axisTick}
                  tickFormatter={(month: string) => month.slice(0, 4)}
                  minTickGap={40}
                  stroke={grid}
                />
                <YAxis
                  tick={axisTick}
                  tickFormatter={(value: number) => (maskAmounts ? '' : compactCurrency(value))}
                  width={64}
                  stroke={grid}
                />
                <RechartsTooltip
                  content={(props) => (
                    <CustomTooltip
                      active={props.active}
                      payload={props.payload as any[]}
                      label={props.label ? monthLabel(String(props.label)) : undefined}
                    />
                  )}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {trackIds.map((trackId, index) => (
                  <Area
                    key={trackId}
                    type="monotone"
                    dataKey={`track_${trackId}`}
                    name={trackName(trackId)}
                    stackId="balance"
                    stroke={seriesColor(index, mode)}
                    fill={alpha(seriesColor(index, mode), 0.35)}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                ))}
                {property?.marketValue ? (
                  <Line
                    type="monotone"
                    dataKey="equity"
                    name={t('charts.equity', 'Your equity')}
                    stroke={equityColor}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                ) : null}
                {todayMonth ? (
                  <ReferenceLine x={todayMonth} stroke={theme.palette.text.secondary} strokeDasharray="2 4" label={{ value: t('charts.today', 'Today'), fill: theme.palette.text.secondary, fontSize: 11, position: 'insideTopRight' }} />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      ) : null}

      {yearly.length > 0 ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t('charts.compositionTitle', 'Where your payments go, per year')}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
            {t('charts.compositionSubtitle', 'Principal repaid vs interest paid, plus CPI indexation added to linked balances.')}
          </Typography>
          <Box sx={{ height: 260 }} role="img" aria-label={t('charts.compositionTitle', 'Where your payments go, per year')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yearly} margin={{ top: 8, right: 16, left: 8, bottom: 0 }} barCategoryGap={2}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="year" tick={axisTick} minTickGap={16} stroke={grid} />
                <YAxis tick={axisTick} tickFormatter={(value: number) => (maskAmounts ? '' : compactCurrency(value))} width={64} stroke={grid} />
                <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: alpha(theme.palette.text.primary, 0.06) }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="principal" name={t('charts.principal', 'Principal')} stackId="pay" fill={compositionColors.principal} stroke={theme.palette.background.paper} strokeWidth={1} isAnimationActive={false} />
                <Bar dataKey="interest" name={t('charts.interest', 'Interest')} stackId="pay" fill={compositionColors.interest} stroke={theme.palette.background.paper} strokeWidth={1} isAnimationActive={false} />
                <Bar dataKey="indexation" name={t('charts.indexation', 'CPI indexation')} stackId="pay" fill={compositionColors.indexation} stroke={theme.palette.background.paper} strokeWidth={1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
          <Button size="small" sx={{ mt: 1 }} onClick={() => setShowTable((value) => !value)}>
            {showTable ? t('charts.hideTable', 'Hide yearly table') : t('charts.showTable', 'Show yearly table')}
          </Button>
          <Collapse in={showTable}>
            <TableContainer sx={{ maxHeight: 360, mt: 1 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('table.year', 'Year')}</TableCell>
                    <TableCell align="right">{t('table.payments', 'Payments')}</TableCell>
                    <TableCell align="right">{t('charts.principal', 'Principal')}</TableCell>
                    <TableCell align="right">{t('charts.interest', 'Interest')}</TableCell>
                    <TableCell align="right">{t('charts.indexation', 'CPI indexation')}</TableCell>
                    <TableCell align="right">{t('table.endBalance', 'Balance at year end')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {yearly.map((row) => (
                    <TableRow key={row.year} sx={{ opacity: row.projected ? 1 : 0.75 }}>
                      <TableCell>{row.year}</TableCell>
                      <TableCell align="right">{money(row.payment)}</TableCell>
                      <TableCell align="right">{money(row.principal)}</TableCell>
                      <TableCell align="right">{money(row.interest)}</TableCell>
                      <TableCell align="right">{money(row.indexation)}</TableCell>
                      <TableCell align="right">{money(row.endBalance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Collapse>
        </Paper>
      ) : null}
    </Box>
  );
};

export default MortgageSchedulePanel;
