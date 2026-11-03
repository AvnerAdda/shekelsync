import React from 'react';
import { Alert, Box, Grid, Paper, Stack, Typography, alpha, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { MortgageHealth, MortgageTrackType } from '@renderer/types/investments';
import HealthVerdictChip, { VERDICT_COLORS } from './HealthVerdictChip';
import { TRACK_TYPE_FALLBACK_LABELS } from './mortgage-utils';

interface MortgageHealthPanelProps {
  health: MortgageHealth;
}

function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${value.toFixed(digits)}%`;
}

function monthLabel(month: string | null | undefined): string {
  if (!month) return '-';
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const Metric: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode }> = ({ label, value, hint }) => (
  <Box>
    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, display: 'block' }}>{label}</Typography>
    <Typography variant="body1" sx={{ fontWeight: 800 }}>{value}</Typography>
    {hint ? <Typography variant="caption" sx={{ color: 'text.secondary' }}>{hint}</Typography> : null}
  </Box>
);

const Section: React.FC<{ title: string; verdict: MortgageHealth['overall']; summary: string; children: React.ReactNode }> = ({ title, verdict, summary, children }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%', borderTop: `3px solid ${VERDICT_COLORS[verdict]}` }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{title}</Typography>
      <HealthVerdictChip verdict={verdict} />
    </Box>
    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>{summary}</Typography>
    {children}
  </Paper>
);

/** Payment-to-income meter with comfortable / acceptable / regulatory-cap markers. */
const PtiMeter: React.FC<{ value: number | null; stressed: number | null }> = ({ value, stressed }) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.health' });
  const scale = 60;
  const position = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const markers = [{ at: 30, label: '30%' }, { at: 40, label: '40%' }, { at: 50, label: t('affordability.cap', '50% cap') }];
  return (
    <Box sx={{ position: 'relative', height: 44, mt: 1 }} role="img" aria-label={t('affordability.meterLabel', 'Payment-to-income {{value}}', { value: pct(value) })}>
      <Box sx={{ position: 'absolute', top: 10, left: 0, right: 0, height: 8, borderRadius: 4, bgcolor: alpha(theme.palette.text.primary, 0.08) }} />
      {value !== null ? (
        <Box sx={{ position: 'absolute', top: 10, left: 0, width: position(value), height: 8, borderRadius: 4, bgcolor: theme.palette.text.primary }} />
      ) : null}
      {stressed !== null ? (
        <Box
          title={t('affordability.stressedMarker', 'Worst case')}
          sx={{ position: 'absolute', top: 6, left: position(stressed), width: 2, height: 16, bgcolor: VERDICT_COLORS.risk, transform: 'translateX(-1px)' }}
        />
      ) : null}
      {markers.map((marker) => (
        <Box key={marker.at} sx={{ position: 'absolute', top: 20, left: position(marker.at), transform: 'translateX(-50%)', textAlign: 'center' }}>
          <Box sx={{ width: 1, height: 6, bgcolor: 'text.secondary', mx: 'auto' }} />
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>{marker.label}</Typography>
        </Box>
      ))}
    </Box>
  );
};

const MortgageHealthPanel: React.FC<MortgageHealthPanelProps> = ({ health }) => {
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.health' });
  const { t: tTrack } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.mortgage' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const money = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '-';
    return maskAmounts ? '***' : formatCurrency(value, { absolute: false, maximumFractionDigits: 0 });
  };
  const trackName = (type: MortgageTrackType) => tTrack(`trackTypes.${type}`, TRACK_TYPE_FALLBACK_LABELS[type]);
  const { rates, exposure, affordability, equity, prepayment } = health;
  const income = affordability.income;

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>{t('title', 'Credit health')}</Typography>
        <HealthVerdictChip verdict={health.overall} size="medium" />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('overallHint', 'The overall verdict is the weakest of the four areas below.')}
        </Typography>
      </Box>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Section
            title={t('rates.title', 'Your rates vs the market')}
            verdict={rates.verdict}
            summary={t('rates.summary', 'Compared with the Bank of Israel average for new mortgages of the same type.')}
          >
            <Stack spacing={1}>
              {rates.tracks.map((track) => (
                <Box key={track.trackId} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{trackName(track.type)}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {track.benchmark === null
                        ? t('rates.noBenchmark', 'No public market average for this track type')
                        : t(track.comparison === 'margin' ? 'rates.marginLine' : 'rates.rateLine', track.comparison === 'margin'
                          ? 'Margin {{yours}} vs market {{benchmark}} ({{period}})'
                          : 'Rate {{yours}} vs market {{benchmark}} ({{period}})', {
                          yours: pct(track.yours, 2),
                          benchmark: pct(track.benchmark, 2),
                          period: monthLabel(track.benchmarkPeriod),
                        })}
                    </Typography>
                  </Box>
                  <HealthVerdictChip verdict={track.verdict} />
                </Box>
              ))}
            </Stack>
          </Section>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Section
            title={t('exposure.title', 'Exposure to rates and inflation')}
            verdict={exposure.verdict}
            summary={t('exposure.summary', 'How much of your loan moves with prime or variable rates, and what a bad scenario would cost.')}
          >
            <Grid container spacing={1.5}>
              <Grid size={6}>
                <Metric
                  label={t('exposure.mix', 'Mix')}
                  value={`${pct(exposure.mix.fixedPct, 0)} ${t('exposure.fixed', 'fixed')}`}
                  hint={t('exposure.mixHint', 'Prime {{prime}} · variable {{variable}} · CPI-linked {{cpi}}', {
                    prime: pct(exposure.mix.primePct, 0),
                    variable: pct(exposure.mix.variablePct, 0),
                    cpi: pct(exposure.mix.cpiLinkedPct, 0),
                  })}
                />
              </Grid>
              <Grid size={6}>
                <Metric
                  label={t('exposure.perPrimePoint', 'Each +1% on prime')}
                  value={`+${money(exposure.perPrimePoint)}`}
                  hint={t('exposure.perMonth', 'per month')}
                />
              </Grid>
              <Grid size={6}>
                <Metric
                  label={t('exposure.steady', 'Monthly payment')}
                  value={money(exposure.steadyPayment)}
                  hint={t('exposure.steadyHint', 'from {{month}}', { month: monthLabel(exposure.steadyMonth) })}
                />
              </Grid>
              <Grid size={6}>
                <Metric
                  label={t('exposure.worst', 'Worst case')}
                  value={money(exposure.worstCasePayment)}
                  hint={t('exposure.worstHint', '+{{pct}} · prime +2% & inflation 4%', { pct: pct(exposure.worstIncreasePct, 0) })}
                />
              </Grid>
            </Grid>
            {exposure.meetsFixedThird === false ? (
              <Alert severity="warning" sx={{ mt: 1.5 }}>{t('exposure.fixedThird', 'Less than a third of the loan is at a fixed rate (Bank of Israel guideline).')}</Alert>
            ) : null}
          </Section>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Section
            title={t('affordability.title', 'Affordability')}
            verdict={affordability.verdict}
            summary={t('affordability.summary', 'Mortgage payment as a share of your net household income. Banks may lend up to 50%; 30% or less is comfortable.')}
          >
            {affordability.paymentToIncomePct === null ? (
              <Typography variant="body2">{t('affordability.noIncome', 'No income detected yet. Categorize your salary as income, or enter it in the assumptions.')}</Typography>
            ) : (
              <>
                <Grid container spacing={1.5}>
                  <Grid size={6}>
                    <Metric label={t('affordability.pti', 'Payment / income')} value={pct(affordability.paymentToIncomePct)} />
                  </Grid>
                  <Grid size={6}>
                    <Metric label={t('affordability.stressed', 'In the worst case')} value={pct(affordability.stressedPaymentToIncomePct)} />
                  </Grid>
                </Grid>
                <PtiMeter value={affordability.paymentToIncomePct} stressed={affordability.stressedPaymentToIncomePct} />
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                  {income?.source === 'manual'
                    ? t('affordability.incomeManual', 'Income: {{amount}} per month (entered manually)', { amount: money(income.monthly) })
                    : t('affordability.incomeDetected', 'Income: {{amount}} per month, median of the last {{count}} months with income in your transactions', {
                      amount: money(income?.monthly),
                      count: income?.monthsWithIncome ?? 0,
                    })}
                </Typography>
              </>
            )}
          </Section>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Section
            title={t('equity.title', 'Equity')}
            verdict={equity.verdict}
            summary={t('equity.summary', 'How much of the property you own, counting drawdowns still to come as debt.')}
          >
            <Grid container spacing={1.5}>
              <Grid size={6}>
                <Metric label={t('equity.ltv', 'Loan to value')} value={pct(equity.loanToValuePct)} />
              </Grid>
              <Grid size={6}>
                <Metric
                  label={t('equity.cushion', 'Price drop that wipes your equity')}
                  value={pct(equity.priceDropToZeroEquityPct, 0)}
                  hint={t('equity.cushionHint', 'before selling costs')}
                />
              </Grid>
              <Grid size={6}>
                <Metric
                  label={t('equity.principalShare', 'Principal in each payment')}
                  value={pct(equity.principalShareOfPaymentPct, 0)}
                  hint={t('equity.principalFrom', 'More principal than interest from {{month}}', { month: monthLabel(equity.principalExceedsInterestFrom) })}
                />
              </Grid>
              <Grid size={6}>
                <Metric
                  label={t('equity.ltv60', 'Below 60% LTV')}
                  value={monthLabel(equity.ltvBelow60)}
                  hint={t('equity.flatPrices', 'at today\'s price')}
                />
              </Grid>
            </Grid>
          </Section>
        </Grid>
      </Grid>

      {prepayment ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t('prepayment.title', 'What would an early repayment do?')}</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {t('prepayment.body', 'Repaying {{amount}} on your {{track}} track ({{rate}}) after the last drawdown would save about {{saved}} in interest and finish it {{months}} months earlier. Estimated early-repayment fee today: {{fee}}.', {
              amount: money(prepayment.amount),
              track: trackName(prepayment.type),
              rate: pct(prepayment.rate, 2),
              saved: money(prepayment.interestSaved),
              months: prepayment.monthsShortened ?? '-',
              fee: money(prepayment.feeEstimate),
            })}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('prepayment.caveat', 'Money used to prepay is not invested elsewhere: compare the saving with what that cash could earn.')}
          </Typography>
        </Paper>
      ) : null}
    </Stack>
  );
};

export default MortgageHealthPanel;
