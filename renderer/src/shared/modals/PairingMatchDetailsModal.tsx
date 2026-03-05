import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Button,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import ModalHeader from './ModalHeader';
import { apiClient } from '@/lib/api-client';
import type {
  CardTxnLinkMethod,
  PairingCycleDetails,
  PairingCycleStatus,
  PairingMatchDetailsResponse,
  RepaymentMatchSource,
  RepaymentMatchStatus,
} from '@renderer/types/accounts';

interface PairingReference {
  id: number;
  creditCardVendor: string;
  creditCardAccountNumber: string | null;
  bankVendor: string;
  bankAccountNumber: string | null;
}

interface PairingMatchDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  pairing: PairingReference | null;
}

const RELOAD_MONTHS_BACK = 6;

const repaymentStatusMeta: Record<RepaymentMatchStatus, { label: string; color: 'success' | 'warning' | 'error' | 'default' | 'info' }> = {
  matched: { label: 'Matched', color: 'success' },
  partial: { label: 'Partial', color: 'warning' },
  unmatched: { label: 'Unmatched', color: 'error' },
  ambiguous: { label: 'Ambiguous', color: 'info' },
};

const cycleStatusMeta: Record<PairingCycleStatus, { label: string; color: 'success' | 'warning' | 'error' | 'default' | 'info' }> = {
  matched: { label: 'Matched', color: 'success' },
  missing_cc_cycle: { label: 'Missing CC Cycle', color: 'warning' },
  fee_candidate: { label: 'Fee Candidate', color: 'warning' },
  large_discrepancy: { label: 'Large Discrepancy', color: 'error' },
  cc_over_bank: { label: 'CC > Bank', color: 'warning' },
  incomplete_history: { label: 'Incomplete History', color: 'info' },
  ambiguous: { label: 'Ambiguous', color: 'info' },
};

function formatRepaymentMatchSource(source: RepaymentMatchSource): string {
  if (source === 'inferred_amount_cycle') return 'Auto (Amount+Cycle)';
  return 'Not Linked';
}

function formatCardLinkMethod(method: CardTxnLinkMethod): string {
  if (method === 'inferred_amount_cycle') return 'Auto (Amount+Cycle)';
  return 'Not Linked';
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) {
    return '—';
  }
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateValue: string | null | undefined): string {
  if (!dateValue) {
    return '—';
  }
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return String(dateValue).slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

export default function PairingMatchDetailsModal({
  isOpen,
  onClose,
  pairing,
}: PairingMatchDetailsModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<PairingMatchDetailsResponse | null>(null);
  const [selectedCycleDate, setSelectedCycleDate] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;

    if (!isOpen || !pairing) {
      setLoading(false);
      setError(null);
      setDetails(null);
      setSelectedCycleDate('all');
      return () => {
        cancelled = true;
      };
    }

    const fetchDetails = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await apiClient.get<PairingMatchDetailsResponse | { error?: string }>(
          `/api/accounts/pairing/${pairing.id}/match-details?monthsBack=${RELOAD_MONTHS_BACK}`,
        );

        if (!response.ok) {
          const apiError = typeof response.data === 'object' && response.data && 'error' in response.data
            ? String(response.data.error || 'Failed to load pairing details')
            : 'Failed to load pairing details';
          throw new Error(apiError);
        }

        if (!cancelled) {
          setDetails(response.data as PairingMatchDetailsResponse);
        }
      } catch (fetchError) {
        if (cancelled) {
          return;
        }
        const message = fetchError instanceof Error ? fetchError.message : 'Failed to load pairing details';
        setError(message);
        setDetails(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchDetails();
    return () => {
      cancelled = true;
    };
  }, [isOpen, pairing]);

  const visibleCycles = useMemo<PairingCycleDetails[]>(() => {
    if (!details?.cycles?.length) {
      return [];
    }
    if (selectedCycleDate === 'all') {
      return details.cycles;
    }
    return details.cycles.filter((cycle) => cycle.cycleDate === selectedCycleDate);
  }, [details, selectedCycleDate]);

  const handleCycleDateChange = (event: SelectChangeEvent<string>) => {
    setSelectedCycleDate(event.target.value);
  };

  const title = pairing
    ? `Pairing Match Details - ${pairing.creditCardVendor}${pairing.creditCardAccountNumber ? ` • ${pairing.creditCardAccountNumber}` : ''}`
    : 'Pairing Match Details';

  const handleDialogClose = (
    _event: object,
    reason: 'backdropClick' | 'escapeKeyDown',
  ) => {
    if (reason === 'backdropClick') {
      return;
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onClose={handleDialogClose} maxWidth="lg" fullWidth>
      <ModalHeader title={title} onClose={onClose} />

      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 3 }}>
            <CircularProgress size={24} />
            <Typography variant="body2">Loading pairing transaction matches...</Typography>
          </Box>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : !details || details.cycles.length === 0 ? (
          <Alert severity="info">No pairing cycles found for this account yet.</Alert>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Chip label={`Cycles: ${details.summary.cyclesCount}`} size="small" />
              <Chip label={`Repayments: ${details.summary.repaymentCount}`} size="small" />
              <Chip label={`Card Txns: ${details.summary.cardTransactionCount}`} size="small" />
              <Chip label={`Bank Total: ${formatCurrency(details.summary.totalBankAmount)}`} size="small" />
              <Chip label={`Card Total: ${formatCurrency(details.summary.totalCardAmount)}`} size="small" />
              <Chip label={`Matched: ${details.summary.statusCounts.matched}`} size="small" color="success" variant="outlined" />
              <Chip label={`Partial: ${details.summary.statusCounts.partial}`} size="small" color="warning" variant="outlined" />
              <Chip label={`Unmatched: ${details.summary.statusCounts.unmatched}`} size="small" color="error" variant="outlined" />
              <Chip label={`Ambiguous: ${details.summary.statusCounts.ambiguous}`} size="small" color="info" variant="outlined" />
            </Box>

            <FormControl size="small" sx={{ maxWidth: 260 }}>
              <InputLabel id="pairing-cycle-select-label">Cycle</InputLabel>
              <Select
                labelId="pairing-cycle-select-label"
                value={selectedCycleDate}
                label="Cycle"
                onChange={handleCycleDateChange}
              >
                <MenuItem value="all">All cycles</MenuItem>
                {details.cycles.map((cycle) => (
                  <MenuItem key={cycle.cycleDate} value={cycle.cycleDate}>
                    {cycle.cycleDate}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {visibleCycles.map((cycle) => {
              const cycleStatus = cycleStatusMeta[cycle.cycleStatus] || cycleStatusMeta.matched;
              return (
                <Paper key={cycle.cycleDate} variant="outlined" sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                    <Typography variant="subtitle1" fontWeight={700}>{cycle.cycleDate}</Typography>
                    <Chip label={cycleStatus.label} color={cycleStatus.color} size="small" variant="outlined" />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Bank: {formatCurrency(cycle.bankTotal)} • Card: {formatCurrency(cycle.ccTotal)} • Difference: {formatCurrency(cycle.difference)}
                  </Typography>
                  {(cycle.pendingTransactionCount || 0) > 0 && (
                    <Typography variant="body2" color="warning.main" sx={{ mb: 1.5 }}>
                      With Pending ({cycle.pendingTransactionCount}): Card {formatCurrency(cycle.provisionalCardTotal)} • Difference {formatCurrency(cycle.provisionalDifference)} (Delta {formatCurrency(cycle.pendingCardDelta)})
                    </Typography>
                  )}

                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Bank repayments</Typography>
                  {cycle.repayments.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">No bank repayments in this cycle.</Typography>
                  ) : (
                    <TableContainer sx={{ mb: 2 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Date</TableCell>
                            <TableCell>Name</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell align="right">Matched</TableCell>
                            <TableCell align="right">Remaining</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Source</TableCell>
                            <TableCell>Shared Pairings</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {cycle.repayments.map((repayment) => {
                            const statusMeta = repaymentStatusMeta[repayment.status];
                            return (
                              <TableRow key={`${repayment.vendor}:${repayment.identifier}`}>
                                <TableCell>{formatDate(repayment.date)}</TableCell>
                                <TableCell>{repayment.name}</TableCell>
                                <TableCell align="right">{formatCurrency(repayment.absAmount)}</TableCell>
                                <TableCell align="right">{formatCurrency(repayment.matchedAmount)}</TableCell>
                                <TableCell align="right">{formatCurrency(repayment.remainingAmount)}</TableCell>
                                <TableCell>
                                  <Chip label={statusMeta.label} color={statusMeta.color} size="small" variant="outlined" />
                                </TableCell>
                                <TableCell>{formatRepaymentMatchSource(repayment.matchSource)}</TableCell>
                                <TableCell>
                                  {repayment.sharedPairingsCount > 1
                                    ? `${repayment.sharedPairingsCount} (${repayment.sharedPairingIds.join(', ')})`
                                    : String(repayment.sharedPairingsCount)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}

                  <Divider sx={{ my: 1.5 }} />

                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Card transactions</Typography>
                  {cycle.cardTransactions.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">No card transactions in this cycle.</Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Date</TableCell>
                            <TableCell>Processed</TableCell>
                            <TableCell>Name</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell>Linked Repayments</TableCell>
                            <TableCell>Link Method</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {cycle.cardTransactions.map((cardTxn) => (
                            <TableRow key={`${cardTxn.vendor}:${cardTxn.identifier}`}>
                              <TableCell>{formatDate(cardTxn.date)}</TableCell>
                              <TableCell>{formatDate(cardTxn.processedDate)}</TableCell>
                              <TableCell>{cardTxn.name}</TableCell>
                              <TableCell align="right">{formatCurrency(cardTxn.price)}</TableCell>
                              <TableCell>
                                {cardTxn.linkedRepaymentCount > 0
                                  ? cardTxn.linkedRepaymentIds.join(', ')
                                  : '—'}
                              </TableCell>
                              <TableCell>{formatCardLinkMethod(cardTxn.linkMethod)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Paper>
              );
            })}
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
