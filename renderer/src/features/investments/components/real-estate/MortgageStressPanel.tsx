import React from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Slider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { MortgageStressResponse } from '@renderer/types/investments';
import CustomTooltip from '../CustomTooltip';
import { seriesColor } from './mortgage-utils';

interface MortgageStressPanelProps {
  accountId: number;
  refreshKey?: number;
}

const FALLBACK_LABELS: Record<string, string> = {
  base: 'Base case',
  prime1: 'Prime +1%',
  prime2: 'Prime +2%',
  prime3: 'Prime +3%',
  cpi4: 'Inflation 4%/yr',
  combined: 'Prime +2% & inflation 4%',
  custom1: 'Your scenario',
};
// Fixed slot per scenario so colors never move when lines are toggled.
const SLOT: Record<string, number> = { base: 0, prime1: 1, prime2: 2, prime3: 3, cpi4: 4, combined: 7, custom1: 6 };
const DEFAULT_VISIBLE = ['base', 'prime2', 'combined', 'custom1'];

function compactCurrency(value: number): string {
  if (Math.abs(value) >= 1000) return `₪${(value / 1000).toFixed(1)}K`;
  return `₪${Math.round(value)}`;
}

function monthLabel(month: string | null): string {
  if (!month) return '-';
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const MortgageStressPanel: React.FC<MortgageStressPanelProps> = ({ accountId, refreshKey = 0 }) => {
  const theme = useTheme();
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light';
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.stress' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const [primeShift, setPrimeShift] = React.useState(1.5);
  const [inflation, setInflation] = React.useState(3);
  const [visible, setVisible] = React.useState<string[]>(DEFAULT_VISIBLE);
  const [data, setData] = React.useState<MortgageStressResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const money = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '-';
    return maskAmounts ? '***' : formatCurrency(value, { absolute: false, maximumFractionDigits: 0 });
  };
  const label = (key: string) => (key === 'custom1'
    ? t('custom', 'Your scenario: prime {{prime}}, inflation {{cpi}}%/yr', { prime: `${primeShift >= 0 ? '+' : ''}${primeShift}%`, cpi: inflation })
    : t(`presets.${key}`, FALLBACK_LABELS[key] || key));

  React.useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await apiClient.post<MortgageStressResponse>(
          `/api/investments/real-estate/properties/${accountId}/mortgage/stress`,
          { scenarios: [{ scenario: { primeShiftPct: primeShift, cpiAnnualOverridePct: inflation } }] },
        );
        if (!response.ok) throw new Error((response.data as { error?: string })?.error || response.statusText);
        if (active) {
          setData(response.data as MortgageStressResponse);
          setError(null);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Stress test failed');
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [accountId, primeShift, inflation, refreshKey]);

  const chartData = React.useMemo(() => {
    if (!data) return [];
    const byMonth = new Map<string, Record<string, number | string>>();
    for (const scenario of data.scenarios) {
      for (const point of scenario.payments) {
        // One point per quarter keeps 30-year charts readable.
        if (!['01', '04', '07', '10'].includes(point.month.slice(5, 7))) continue;
        const row = byMonth.get(point.month) || { month: point.month };
        row[scenario.key] = point.payment;
        byMonth.set(point.month, row);
      }
    }
    return [...byMonth.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  }, [data]);

  const grid = alpha(theme.palette.divider, 0.6);
  const axisTick = { fill: theme.palette.text.secondary, fontSize: 11 };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>{t('title', 'Stress test')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('subtitle', 'How your monthly payment moves if prime or inflation change from today on. The base case keeps prime at today\'s rate and uses market inflation expectations.')}
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{t('customTitle', 'Build your own scenario')}</Typography>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('primeShift', 'Prime change: {{value}}', { value: `${primeShift >= 0 ? '+' : ''}${primeShift}%` })}</Typography>
            <Slider
              value={primeShift}
              min={-2}
              max={5}
              step={0.25}
              marks={[{ value: 0, label: '0' }]}
              onChange={(_, value) => setPrimeShift(value as number)}
              aria-label={t('primeShiftLabel', 'Prime change')}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('inflation', 'Inflation: {{value}}% per year', { value: inflation })}</Typography>
            <Slider
              value={inflation}
              min={0}
              max={8}
              step={0.5}
              marks={[{ value: 2, label: '2%' }]}
              onChange={(_, value) => setInflation(value as number)}
              aria-label={t('inflationLabel', 'Inflation')}
            />
          </Grid>
        </Grid>
      </Paper>

      {error ? <Alert severity="warning">{error}</Alert> : null}
      {loading && !data ? <CircularProgress /> : null}

      {data ? (
        <>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, flex: 1 }}>{t('chartTitle', 'Monthly payment by scenario')}</Typography>
              {loading ? <CircularProgress size={16} /> : null}
            </Box>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1 }}>
              {data.scenarios.map((scenario) => {
                const on = visible.includes(scenario.key);
                return (
                  <Chip
                    key={scenario.key}
                    size="small"
                    label={label(scenario.key)}
                    variant={on ? 'filled' : 'outlined'}
                    onClick={() => setVisible((previous) => (on ? previous.filter((key) => key !== scenario.key) : [...previous, scenario.key]))}
                    icon={<Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: seriesColor(SLOT[scenario.key] ?? 5, mode), ml: '6px !important' }} />}
                  />
                );
              })}
            </Stack>
            <Box sx={{ height: 300 }} role="img" aria-label={t('chartTitle', 'Monthly payment by scenario')}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke={grid} vertical={false} />
                  <XAxis dataKey="month" tick={axisTick} tickFormatter={(month: string) => month.slice(0, 4)} minTickGap={40} stroke={grid} />
                  <YAxis tick={axisTick} tickFormatter={(value: number) => (maskAmounts ? '' : compactCurrency(value))} width={60} stroke={grid} domain={['auto', 'auto']} />
                  <RechartsTooltip
                    content={(props) => (
                      <CustomTooltip active={props.active} payload={props.payload as any[]} label={props.label ? monthLabel(String(props.label)) : undefined} />
                    )}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {data.scenarios.filter((scenario) => visible.includes(scenario.key)).map((scenario) => (
                    <Line
                      key={scenario.key}
                      type="monotone"
                      dataKey={scenario.key}
                      name={label(scenario.key)}
                      stroke={seriesColor(SLOT[scenario.key] ?? 5, mode)}
                      strokeWidth={2}
                      strokeDasharray={scenario.key === 'base' ? undefined : scenario.key === 'custom1' ? '2 3' : '6 3'}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t('nominalNote', 'Amounts in future shekels: CPI-linked payments grow with inflation even when nothing else changes.')}
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('table.scenario', 'Scenario')}</TableCell>
                  <TableCell align="right">{t('table.in1y', 'In 1 year')}</TableCell>
                  <TableCell align="right">{t('table.in5y', 'In 5 years')}</TableCell>
                  <TableCell align="right">{t('table.peak', 'Highest payment')}</TableCell>
                  <TableCell align="right">{t('table.costDelta', 'Extra cost over the loan')}</TableCell>
                  {data.monthlyIncome ? <TableCell align="right">{t('table.pti', 'Peak payment / income')}</TableCell> : null}
                </TableRow>
              </TableHead>
              <TableBody>
                {data.scenarios.map((scenario) => (
                  <TableRow key={scenario.key}>
                    <TableCell>{label(scenario.key)}</TableCell>
                    <TableCell align="right">{money(scenario.paymentIn1y)}</TableCell>
                    <TableCell align="right">{money(scenario.paymentIn5y)}</TableCell>
                    <TableCell align="right">
                      {money(scenario.peakPayment)}
                      <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 0.5 }}>{monthLabel(scenario.peakMonth)}</Typography>
                    </TableCell>
                    <TableCell align="right">{scenario.key === 'base' ? '-' : money(scenario.totalCostDelta)}</TableCell>
                    {data.monthlyIncome ? (
                      <TableCell align="right" sx={{ fontWeight: scenario.peakPaymentToIncomePct && scenario.peakPaymentToIncomePct > 50 ? 800 : 400 }}>
                        {scenario.peakPaymentToIncomePct === null ? '-' : `${scenario.peakPaymentToIncomePct.toFixed(1)}%`}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.monthlyIncome ? (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                {t('incomeNote', 'Against a net income of {{income}} per month. Banks cap new loans at 50%.', { income: money(data.monthlyIncome) })}
              </Typography>
            ) : null}
          </Paper>
        </>
      ) : null}
    </Stack>
  );
};

export default MortgageStressPanel;
