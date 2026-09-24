import React from 'react';
import {
  Alert, Box, Button, Chip, Collapse, MenuItem, Paper, Skeleton, Table,
  TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { InvestmentLiability } from '@renderer/types/investments';
import { calculateDebtPlan, debtPayoffMonth, type DebtPlan, type DebtStrategy } from '../utils/debt-repayment';

interface Props {
  liabilities?: InvestmentLiability[];
  loading?: boolean;
  error?: string | Error | null;
}

export default function DebtRepaymentPlanner({ liabilities, loading = false, error }: Props) {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'debtPlanning' });
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const [currencyChoice, setCurrencyChoice] = React.useState('');
  const [extras, setExtras] = React.useState<Record<string, string>>({});
  const [strategy, setStrategy] = React.useState<DebtStrategy>('avalanche');
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const debts = React.useMemo(() => (liabilities || []).filter((debt) => debt.is_active !== false && debt.balance !== 0), [liabilities]);
  const currencies = React.useMemo(() => [...new Set(debts.map((debt) => debt.currency?.trim().toUpperCase() || ''))].sort(), [debts]);
  const currency = currencies.includes(currencyChoice) ? currencyChoice : currencies[0] ?? 'ILS';
  const currencyLabel = currency || t('missingCurrency');
  const scopedDebts = React.useMemo(() => debts.filter((debt) => (debt.currency?.trim().toUpperCase() || '') === currency), [debts, currency]);
  const extraDraft = extras[currency] ?? '0';
  const extraMonthly = Number(extraDraft);
  const extraValid = extraDraft.trim() !== '' && Number.isFinite(extraMonthly) && extraMonthly >= 0
    && Number.isSafeInteger(Math.round(extraMonthly * 100));
  const plans = React.useMemo(() => ({
    baseline: calculateDebtPlan(scopedDebts, { rollOverPayments: false }),
    avalanche: calculateDebtPlan(scopedDebts, { extraMonthly: extraValid ? extraMonthly : NaN, strategy: 'avalanche' }),
    snowball: calculateDebtPlan(scopedDebts, { extraMonthly: extraValid ? extraMonthly : NaN, strategy: 'snowball' }),
  }), [scopedDebts, extraMonthly, extraValid]);
  const selectedPlan = plans[strategy];
  const balanceDates = scopedDebts.map((debt) => debt.as_of_date).filter(Boolean).sort();
  const schedulePage = Math.min(page, Math.max(0, Math.ceil(selectedPlan.schedule.length / 12) - 1));
  const money = (amountCents: number) => maskAmounts ? '***' : formatCurrency(amountCents / 100, {
    absolute: true, minimumFractionDigits: 2, maximumFractionDigits: 2,
    currencySymbol: currency === 'ILS' ? '₪' : `${currency} `,
  });
  const payoffDate = (plan: DebtPlan) => plan.months == null ? '—' : debtPayoffMonth(plan.months).toLocaleDateString(i18n.language, { month: 'short', year: 'numeric' });
  const paidOff = selectedPlan.status === 'paid_off';
  const comparisonAvailable = paidOff && plans.baseline.status === 'paid_off';

  return (
    <Paper component="section" aria-label={t('title')} sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t('title')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('subtitle')}</Typography>
      </Box>
      {error ? <Alert severity="error">{t('loadError')}</Alert> : loading && !liabilities ? <Skeleton height={160} />
        : !liabilities ? <Alert severity="info">{t('unavailable')}</Alert>
          : debts.length === 0 ? <Alert severity="info">{t('empty')}</Alert> : (
            <>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                <TextField select size="small" label={t('currency')} value={currency} onChange={(event) => { setCurrencyChoice(event.target.value); setPage(0); }} sx={{ minWidth: 120 }}>
                  {currencies.map((item) => <MenuItem key={item} value={item}>{item || t('missingCurrency')}</MenuItem>)}
                </TextField>
                <TextField
                  size="small" type={maskAmounts ? 'password' : 'number'} label={t('extra', { currency: currencyLabel })} value={extraDraft}
                  onChange={(event) => { setExtras((current) => ({ ...current, [currency]: event.target.value })); setPage(0); }}
                  error={!extraValid} helperText={!extraValid ? t('invalidExtra') : t('extraHint')}
                  slotProps={{ htmlInput: { min: 0, step: 0.01, inputMode: 'decimal' } }} sx={{ minWidth: 210 }}
                />
                <TextField select size="small" label={t('strategy')} value={strategy} onChange={(event) => { setStrategy(event.target.value as DebtStrategy); setPage(0); }} sx={{ minWidth: 240 }}>
                  <MenuItem value="avalanche">{t('avalanche')}</MenuItem>
                  <MenuItem value="snowball">{t('snowball')}</MenuItem>
                </TextField>
              </Box>
              {currencies.length > 1 && <Alert severity="info">{t('separateCurrencies')}</Alert>}
              <Typography variant="caption" color="text.secondary">
                {t('balanceDates', { oldest: balanceDates[0] || '—', newest: balanceDates.at(-1) || '—', count: scopedDebts.length })}
              </Typography>
              {plans.baseline.issues.length > 0 ? (
                <Alert severity="warning">
                  {t('incomplete')}
                  <Box component="ul" sx={{ my: 0.5, pl: 2 }}>
                    {plans.baseline.issues.map((issue) => <li key={issue.debtId}>{issue.name}: {issue.fields.map((field) => t(`fields.${field}`)).join(', ')}</li>)}
                  </Box>
                </Alert>
              ) : extraValid && (
                <>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    <Chip label={t('startingBalance', { amount: money(selectedPlan.initialBalanceCents) })} />
                    <Chip label={t('monthlyBudget', { amount: money(selectedPlan.monthlyBudgetCents) })} />
                    {comparisonAvailable && (
                      <Chip color="success" variant="outlined" label={t('savings', {
                        amount: money(Math.max(0, plans.baseline.totalInterestCents - selectedPlan.totalInterestCents)),
                        months: Math.max(0, plans.baseline.months! - selectedPlan.months!),
                      })} />
                    )}
                  </Box>
                  {selectedPlan.status !== 'paid_off' && <Alert severity="warning">{t(`status.${selectedPlan.status}`)}</Alert>}
                  <TableContainer>
                    <Table size="small" aria-label={t('comparison')}>
                      <TableHead><TableRow>
                        <TableCell>{t('plan')}</TableCell><TableCell align="right">{t('payoff')}</TableCell>
                        <TableCell align="right">{t('months')}</TableCell><TableCell align="right">{t('totalInterest')}</TableCell>
                        <TableCell align="right">{t('totalPaid')}</TableCell>
                      </TableRow></TableHead>
                      <TableBody>
                        {(['baseline', 'avalanche', 'snowball'] as const).map((key) => {
                          const plan = plans[key];
                          return <TableRow key={key} selected={key === strategy}>
                            <TableCell>{t(key)}{key === strategy && <Typography variant="caption" sx={{ display: 'block' }}>{t('selected')}</Typography>}</TableCell>
                            <TableCell align="right">{plan.status === 'paid_off' ? payoffDate(plan) : t(`shortStatus.${plan.status}`)}</TableCell>
                            <TableCell align="right">{plan.months ?? '—'}</TableCell>
                            <TableCell align="right">{plan.status === 'paid_off' ? money(plan.totalInterestCents) : '—'}</TableCell>
                            <TableCell align="right">{plan.status === 'paid_off' ? money(plan.totalPaidCents) : '—'}</TableCell>
                          </TableRow>;
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Typography variant="caption" color="text.secondary">{t('baselineHint')}</Typography>
                  {selectedPlan.schedule.length > 0 && <>
                    <Button size="small" onClick={() => setScheduleOpen((open) => !open)} aria-expanded={scheduleOpen} sx={{ alignSelf: 'flex-start' }}>
                      {t(scheduleOpen ? 'hideSchedule' : 'showSchedule')}
                    </Button>
                    <Collapse in={scheduleOpen}>
                      <TableContainer>
                        <Table size="small" aria-label={t('schedule')}>
                          <TableHead><TableRow>
                            <TableCell>{t('month')}</TableCell><TableCell align="right">{t('payment')}</TableCell>
                            <TableCell align="right">{t('interest')}</TableCell><TableCell align="right">{t('remaining')}</TableCell>
                            <TableCell>{t('closed')}</TableCell>
                          </TableRow></TableHead>
                          <TableBody>{selectedPlan.schedule.slice(schedulePage * 12, schedulePage * 12 + 12).map((row) => <TableRow key={row.month}>
                            <TableCell>{debtPayoffMonth(row.month).toLocaleDateString(i18n.language, { month: 'short', year: 'numeric' })}</TableCell>
                            <TableCell align="right">{money(row.paymentCents)}</TableCell><TableCell align="right">{money(row.interestCents)}</TableCell>
                            <TableCell align="right">{money(row.remainingCents)}</TableCell><TableCell>{row.paidOffNames.join(', ') || '—'}</TableCell>
                          </TableRow>)}</TableBody>
                        </Table>
                      </TableContainer>
                      <TablePagination component="div" count={selectedPlan.schedule.length} page={schedulePage} rowsPerPage={12} rowsPerPageOptions={[]}
                        onPageChange={(_, next) => setPage(next)} labelDisplayedRows={({ from, to, count }) => t('pagination', { from, to, count })}
                        getItemAriaLabel={(type) => t(`paginationActions.${type}`)} />
                    </Collapse>
                  </>}
                </>
              )}
              <Alert severity="info">{t('assumptions')}</Alert>
            </>
          )}
    </Paper>
  );
}
