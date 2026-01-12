import { useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from 'react-i18next';

interface RepaymentTxn {
  identifier: string;
  vendor: string;
  accountNumber: string | null;
  date: string;
  cycleDate: string;
  name: string;
  price: number;
}

interface DiscrepancyCycle {
  cycleDate: string;
  bankTotal: number;
  bankPaymentTotal?: number;
  bankRefundTotal?: number;
  ccTotal: number | null;
  difference: number | null;
  status: 'matched' | 'missing_cc_cycle' | 'fee_candidate' | 'large_discrepancy' | 'cc_over_bank' | 'incomplete_history';
  repayments: RepaymentTxn[];
}

interface Discrepancy {
  exists: boolean;
  acknowledged?: boolean;
  totalBankRepayments: number;
  totalCCExpenses: number;
  difference: number;
  differencePercentage: number;
  periodMonths?: number;
  matchedCycleCount?: number;
  matchPatternsUsed?: string[];
  method?: string;
  cycles?: DiscrepancyCycle[];
}

interface RepaymentDiscrepancyListProps {
  discrepancy: Discrepancy;
  canResolve: boolean;
  onIgnoreCycle: (cycleDate: string) => void;
  onAddFeeForCycle: (cycleDate: string, amount: number, feeName: string) => void;
  loading?: boolean;
  ccVendor?: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
}

function formatCurrencySigned(amount: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getCycleStatusLabel(status: DiscrepancyCycle['status'], t: (key: string, params?: any) => string): string {
  switch (status) {
    case 'matched':
      return t('discrepancy.cycleMatched');
    case 'missing_cc_cycle':
      return t('discrepancy.cycleMissing');
    case 'fee_candidate':
      return t('discrepancy.cycleFeeCandidate', { defaultValue: 'Fee candidate' });
    case 'large_discrepancy':
      return t('discrepancy.cycleLargeDiscrepancy', { defaultValue: 'Large discrepancy' });
    case 'cc_over_bank':
      return t('discrepancy.cycleCCOverBank', { defaultValue: 'CC > bank' });
    case 'incomplete_history':
      return t('discrepancy.cycleIncompleteHistory', { defaultValue: 'Incomplete history' });
    default:
      return status;
  }
}

function getCycleStatusColor(status: DiscrepancyCycle['status']): 'default' | 'warning' | 'error' | 'success' | 'info' {
  switch (status) {
    case 'matched':
      return 'success';
    case 'fee_candidate':
      return 'warning';
    case 'missing_cc_cycle':
      return 'warning';
    case 'cc_over_bank':
      return 'warning';
    case 'large_discrepancy':
      return 'error';
    case 'incomplete_history':
      return 'info';
    default:
      return 'default';
  }
}

export default function RepaymentDiscrepancyList({
  discrepancy,
  canResolve,
  onIgnoreCycle,
  onAddFeeForCycle,
  loading = false,
  ccVendor = '',
}: RepaymentDiscrepancyListProps) {
  const { t } = useTranslation();
  const [feeName, setFeeName] = useState(
    ccVendor ? t('discrepancy.defaultFeeName', { vendor: ccVendor }) : t('discrepancy.genericFeeName')
  );

  const cycles = useMemo(() => discrepancy.cycles || [], [discrepancy.cycles]);

  if (!cycles.length) {
    return null;
  }

  const hasMissingCycles = cycles.some((c) => c.status === 'missing_cc_cycle');
  const isAcknowledged = Boolean(discrepancy.acknowledged);
  const alertSeverity = isAcknowledged ? 'info' : (discrepancy.exists ? 'warning' : 'info');

  return (
    <Alert severity={alertSeverity} sx={{ mb: 2 }}>
      <AlertTitle>{t('discrepancy.title')}</AlertTitle>

      <Typography variant="body2" sx={{ mb: 1 }}>
        {isAcknowledged
          ? t('discrepancy.acknowledgedMessage', { defaultValue: 'Discrepancy acknowledged. This warning will reappear if new transactions change the totals.' })
          : discrepancy.exists
            ? (discrepancy.difference > 0
              ? t('discrepancy.overpaidMessage', { amount: formatCurrency(discrepancy.difference) })
              : t('discrepancy.underpaidMessage', { amount: formatCurrency(discrepancy.difference) }))
            : t('discrepancy.noDiscrepancyCycles', { cycles: discrepancy.matchedCycleCount || 0 })}
      </Typography>

      {hasMissingCycles && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {t('discrepancy.missingCyclesNote')}
        </Typography>
      )}

      {discrepancy.matchPatternsUsed && discrepancy.matchPatternsUsed.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
          {discrepancy.matchPatternsUsed.slice(0, 6).map((pattern) => (
            <Chip key={pattern} label={pattern} size="small" variant="outlined" />
          ))}
          {discrepancy.matchPatternsUsed.length > 6 && (
            <Chip label={`+${discrepancy.matchPatternsUsed.length - 6}`} size="small" variant="outlined" />
          )}
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
        <TextField
          size="small"
          value={feeName}
          onChange={(e) => setFeeName(e.target.value)}
          placeholder={t('discrepancy.feeNamePlaceholder')}
          sx={{ minWidth: 240 }}
          disabled={loading}
        />
        <Typography variant="caption" color="text.secondary">
          {t('discrepancy.feeNameHint')}
        </Typography>
      </Box>

      {cycles.map((cycle) => {
        const difference = cycle.difference;
        const canAddFee = canResolve && cycle.status === 'fee_candidate' && typeof difference === 'number' && difference > 0.01;
        const bankPaymentsTotal = cycle.bankPaymentTotal ?? cycle.repayments.reduce((sum, txn) => (
          txn.price < 0 ? sum + Math.abs(txn.price) : sum
        ), 0);
        const bankRefundsTotal = cycle.bankRefundTotal ?? cycle.repayments.reduce((sum, txn) => (
          txn.price > 0 ? sum + Math.abs(txn.price) : sum
        ), 0);
        const bankNetTotal = bankPaymentsTotal - bankRefundsTotal;

        return (
          <Accordion key={cycle.cycleDate} disableGutters sx={{ mb: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 0.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="body2" fontWeight="medium">
                    {cycle.cycleDate}
                  </Typography>
                  <Chip
                    size="small"
                    color={getCycleStatusColor(cycle.status)}
                    label={getCycleStatusLabel(cycle.status, t)}
                    variant="outlined"
                  />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {t('discrepancy.bankRepayments')}: {formatCurrencySigned(bankNetTotal)}{' '}
                  {bankRefundsTotal > 0 && (
                    <>({t('discrepancy.bankRepaymentsPay', { defaultValue: 'pay' })} {formatCurrency(bankPaymentsTotal)} • {t('discrepancy.bankRepaymentsRefund', { defaultValue: 'refund' })} {formatCurrency(bankRefundsTotal)})</>
                  )}
                  • {t('discrepancy.ccExpenses')}: {cycle.ccTotal === null ? '—' : formatCurrency(cycle.ccTotal)}
                  {difference !== null && (
                    <> • {t('discrepancy.difference')}: {formatCurrency(difference)}</>
                  )}
                </Typography>
              </Box>
            </AccordionSummary>

            <AccordionDetails>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={!canResolve || loading}
                    onClick={() => onIgnoreCycle(cycle.cycleDate)}
                  >
                    {t('discrepancy.ignore')}
                  </Button>

                  <Button
                    variant="contained"
                    size="small"
                    disabled={!canAddFee || loading || !feeName.trim()}
                    onClick={() => onAddFeeForCycle(cycle.cycleDate, Math.abs(difference || 0), feeName)}
                  >
                    {t('discrepancy.addAsFee')}
                  </Button>

                  {!canResolve && (
                    <Typography variant="caption" color="text.secondary">
                      {t('discrepancy.createPairingFirst')}
                    </Typography>
                  )}
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('discrepancy.repaymentsInCycle')}: {cycle.repayments.length}
                  </Typography>
                  {cycle.repayments.slice(0, 8).map((repayment) => (
                    <Typography key={repayment.identifier} variant="caption" display="block" color="text.secondary">
                      • {repayment.price < 0 ? t('discrepancy.repaymentLabel', { defaultValue: '→ Credit Card Repayment' }) : t('discrepancy.refundLabel', { defaultValue: '→ Refund' })}{' '}
                      {repayment.name} ({formatCurrency(repayment.price)}) — {new Date(repayment.date).toISOString().split('T')[0]}
                    </Typography>
                  ))}
                  {cycle.repayments.length > 8 && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {t('discrepancy.moreRepayments', { count: cycle.repayments.length - 8 })}
                    </Typography>
                  )}
                </Box>
              </Box>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Alert>
  );
}
