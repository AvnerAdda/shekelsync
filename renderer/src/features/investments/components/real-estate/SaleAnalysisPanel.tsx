import React from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  Grid,
  Paper,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { SaleAnalysis } from '@renderer/types/investments';
import CustomTooltip from '../CustomTooltip';
import { seriesColor } from './mortgage-utils';

interface SaleAnalysisPanelProps {
  sale: SaleAnalysis;
  onEditAssumptions: () => void;
  /** Switch the property's valuation method to the CBS price index. */
  onUsePriceIndex?: () => Promise<void>;
  usingPriceIndex?: boolean;
}

function monthName(period: string | null | undefined): string {
  if (!period) return '-';
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function compactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}₪${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}₪${Math.round(abs / 1_000)}K`;
  return `${sign}₪${Math.round(abs)}`;
}

function signedPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

const SaleAnalysisPanel: React.FC<SaleAnalysisPanelProps> = ({ sale, onEditAssumptions, onUsePriceIndex, usingPriceIndex }) => {
  const [applyingIndex, setApplyingIndex] = React.useState(false);
  const theme = useTheme();
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light';
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.sale' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const money = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '-';
    return maskAmounts ? '***' : formatCurrency(value, { absolute: false, maximumFractionDigits: 0 });
  };
  const grid = alpha(theme.palette.divider, 0.6);
  const axisTick = { fill: theme.palette.text.secondary, fontSize: 11 };
  // Diverging pair (blue gain ↔ red loss), not status colors.
  const gain = mode === 'dark' ? '#3987e5' : '#2a78d6';
  const loss = mode === 'dark' ? '#e66767' : '#e34948';
  const ownColor = seriesColor(0, mode);
  const altColor = seriesColor(1, mode);

  const { breakEven, today, alternative, cashInvested } = sale;
  const value = sale.property.value;

  const cards = [
    {
      key: 'today',
      title: t('cards.today', 'If you sold today'),
      value: money(today?.netProceeds),
      lines: [
        t('cards.todayProfit', '{{amount}} vs the cash you put in', { amount: money(today?.profit) }),
      ],
      tone: today && today.profit >= 0 ? gain : loss,
    },
    {
      key: 'clear',
      title: t('cards.clearDebt', 'Price to clear all debt'),
      value: money(breakEven.clearDebtPrice),
      lines: [t('cards.vsValue', '{{pct}} vs today\'s value', { pct: signedPct(breakEven.clearDebtVsValuePct) })],
      tone: null,
    },
    {
      key: 'recover',
      title: t('cards.recoverCash', 'Price to get all your cash back'),
      value: money(breakEven.recoverCashPrice),
      lines: [
        t('cards.vsValue', '{{pct}} vs today\'s value', { pct: signedPct(breakEven.recoverCashVsValuePct) }),
        t('cards.cashInvested', 'Cash put in: {{amount}}', { amount: money(cashInvested.total) }),
      ],
      tone: null,
    },
    {
      key: 'alternative',
      title: t('cards.alternative', 'Owning vs renting & investing'),
      value: alternative?.crossoverYear
        ? t('cards.aheadFrom', 'Ahead from {{year}}', { year: alternative.crossoverYear })
        : alternative?.alwaysBehind ? t('cards.alwaysBehind', 'Behind over the loan term') : '-',
      lines: [
        sale.breakEvenAppreciationPct10y !== null
          ? t('cards.breakEvenAppreciation', 'Needs ≥ {{pct}}/yr price growth to win over 10 years', { pct: signedPct(sale.breakEvenAppreciationPct10y) })
          : '',
      ].filter(Boolean),
      tone: null,
    },
  ];

  const breakdown = today ? [
    { label: t('breakdown.price', 'Sale price (your share)'), amount: today.price },
    { label: t('breakdown.saleCosts', 'Broker, lawyer and VAT'), amount: -today.saleCosts },
    { label: t('breakdown.tax', 'Capital gains tax (מס שבח)'), amount: -today.capitalGainsTax },
    { label: t('breakdown.mortgage', 'Mortgage payoff (incl. accrued interest)'), amount: -today.mortgagePayoff },
    ...(today.undrawnCommitment ? [{ label: t('breakdown.undrawn', 'Still owed for drawdowns to come'), amount: -today.undrawnCommitment }] : []),
    { label: t('breakdown.fees', 'Early-repayment fees (estimate)'), amount: -today.prepaymentFees },
  ] : [];

  const assumptionNotes = sale.assumptions.map((key) => {
    if (key === 'down_payment_derived') return t('assumptions.downPaymentDerived', 'Down payment assumed = purchase price − loan. Add your real purchase costs for accurate figures.');
    if (key === 'purchase_tax_missing') return t('assumptions.purchaseTaxMissing', 'No purchase tax (מס רכישה) entered.');
    if (key === 'costs_from_linked_transactions') return t('assumptions.costsFromLinked', 'Cash put in is read from the payments linked to this property (down payment, lawyer…). Review them in the assumptions.');
    return key;
  });

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>{t('title', 'Sale & break-even')}</Typography>
        <Button size="small" variant="outlined" startIcon={<TuneIcon />} onClick={onEditAssumptions}>
          {t('editAssumptions', 'Assumptions & purchase costs')}
        </Button>
      </Box>
      {assumptionNotes.length > 0 ? <Alert severity="info">{assumptionNotes.join(' ')}</Alert> : null}

      {sale.indexedValue ? (
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 240 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{t('index.title', 'Value from the CBS dwelling-price index')}</Typography>
            <Typography variant="body2">
              {sale.indexedValue.noDataSincePurchase
                ? t('index.noData', 'No index data published since your purchase yet (latest: {{to}}). Indexed value = purchase price {{value}}.', {
                  to: monthName(sale.indexedValue.toPeriod), value: money(sale.indexedValue.value),
                })
                : t('index.body', '{{series}}: {{pct}} from {{from}} to {{to}}, so your purchase price is now worth about {{value}} (your current estimate: {{estimate}}).', {
                  series: t(`index.series.${sale.indexedValue.series}`, sale.indexedValue.series),
                  pct: signedPct((sale.indexedValue.ratio - 1) * 100),
                  from: monthName(sale.indexedValue.fromPeriod),
                  to: monthName(sale.indexedValue.toPeriod),
                  value: money(sale.indexedValue.value),
                  estimate: money(sale.property.value),
                })}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t('index.lag', 'The index is published about 3 months late and averages two months of deals.')}
            </Typography>
          </Box>
          {onUsePriceIndex ? (
            usingPriceIndex ? (
              <Typography variant="caption" sx={{ fontWeight: 700 }}>{t('index.active', 'Used for your valuation, updated automatically')}</Typography>
            ) : (
              <Button
                size="small"
                variant="outlined"
                disabled={applyingIndex}
                onClick={async () => {
                  setApplyingIndex(true);
                  try {
                    await onUsePriceIndex();
                  } finally {
                    setApplyingIndex(false);
                  }
                }}
              >
                {t('index.use', 'Use for my valuation')}
              </Button>
            )
          ) : null}
        </Paper>
      ) : null}

      <Grid container spacing={1.5}>
        {cards.map((card) => (
          <Grid key={card.key} size={{ xs: 12, sm: 6, md: 3 }}>
            <Paper variant="outlined" sx={{ p: 1.5, height: '100%', borderRadius: 2, borderLeft: card.tone ? `4px solid ${card.tone}` : undefined }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>{card.title}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.25 }}>{card.value}</Typography>
              {card.lines.map((line) => (
                <Typography key={line} variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{line}</Typography>
              ))}
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{t('breakdown.title', 'Selling today, step by step')}</Typography>
            <Stack spacing={0.75}>
              {breakdown.map((line) => (
                <Box key={line.label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                  <Typography variant="body2">{line.label}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(line.amount)}</Typography>
                </Box>
              ))}
              <Divider />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>{t('breakdown.net', 'In your pocket')}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 900 }}>{money(today?.netProceeds)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('breakdown.invested', 'Cash you put in (down payment, costs, payments)')}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{money(-cashInvested.total)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>{t('breakdown.result', 'Gain / loss')}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 900 }}>{money(today?.profit)}</Typography>
              </Box>
            </Stack>
            {value ? (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                {t('breakdown.valueNote', 'Based on an estimated value of {{value}}.', { value: money(value) })}
              </Typography>
            ) : null}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t('sensitivity.title', 'Gain or loss by sale price')}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              {t('sensitivity.subtitle', 'If sold today at a price above or below the estimated value.')}
            </Typography>
            <Box sx={{ height: 230 }} role="img" aria-label={t('sensitivity.title', 'Gain or loss by sale price')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sale.sensitivity} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap={2}>
                  <CartesianGrid stroke={grid} vertical={false} />
                  <XAxis dataKey="changePct" tick={axisTick} tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}%`} stroke={grid} />
                  <YAxis tick={axisTick} tickFormatter={(v: number) => (maskAmounts ? '' : compactCurrency(v))} width={64} stroke={grid} />
                  <ReferenceLine y={0} stroke={theme.palette.text.secondary} />
                  <RechartsTooltip
                    cursor={{ fill: alpha(theme.palette.text.primary, 0.06) }}
                    content={(props) => {
                      const point = props.payload?.[0]?.payload as SaleAnalysis['sensitivity'][number] | undefined;
                      if (!props.active || !point) return null;
                      return (
                        <CustomTooltip
                          active
                          title={`${t('sensitivity.price', 'Price')} ${money(point.price)}`}
                          items={[
                            { label: t('sensitivity.netProceeds', 'In your pocket'), value: point.netProceeds, type: 'currency' },
                            { label: t('sensitivity.profit', 'Gain / loss'), value: point.profit, type: 'currency' },
                          ]}
                        />
                      );
                    }}
                  />
                  <Bar dataKey="profit" name={t('sensitivity.profit', 'Gain / loss')} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {sale.sensitivity.map((point) => (
                      <Cell key={point.changePct} fill={point.profit >= 0 ? gain : loss} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Paper>
        </Grid>
      </Grid>

      {alternative && alternative.points.length > 1 ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t('alternative.title', 'Owning vs renting and investing the difference')}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
            {t('alternative.subtitle', 'Owning: what you would keep after selling that year. Alternative: the same cash (down payment, costs, payments minus rent) invested at {{rate}}/yr, after tax. Property grows at your growth assumption.', {
              rate: `${sale.settings.alternativeReturnPct}%`,
            })}
          </Typography>
          {!alternative.rentConfigured ? (
            <Alert severity="info" sx={{ mb: 1 }}>
              {t('alternative.noRent', 'Add the rent of an equivalent home in the assumptions: without it, owning gets no credit for the rent you save.')}
            </Alert>
          ) : null}
          <Box sx={{ height: 280 }} role="img" aria-label={t('alternative.title', 'Owning vs renting and investing the difference')}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={alternative.points} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="year" tick={axisTick} minTickGap={24} stroke={grid} />
                <YAxis tick={axisTick} tickFormatter={(v: number) => (maskAmounts ? '' : compactCurrency(v))} width={64} stroke={grid} />
                <RechartsTooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {alternative.crossoverYear ? (
                  <ReferenceLine x={alternative.crossoverYear} stroke={theme.palette.text.secondary} strokeDasharray="2 4" label={{ value: t('alternative.crossover', 'Owning pulls ahead'), fill: theme.palette.text.secondary, fontSize: 11, position: 'insideTopLeft' }} />
                ) : null}
                <Line type="monotone" dataKey="ownerWealth" name={t('alternative.own', 'Owning (net if sold)')} stroke={ownColor} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="alternativeWealth" name={t('alternative.alt', 'Renting + investing')} stroke={altColor} strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      ) : null}

      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('disclaimer', 'Estimates. Early-repayment fees are an upper bound (no discounts for loan age or notice); capital gains tax uses a simplified real-gain calculation. Check with your bank and a tax advisor before deciding.')}
      </Typography>
    </Stack>
  );
};

export default SaleAnalysisPanel;
