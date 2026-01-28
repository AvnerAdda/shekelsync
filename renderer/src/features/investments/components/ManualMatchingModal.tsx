import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Checkbox,
  CircularProgress,
  Alert,
  AlertTitle,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  Select,
  MenuItem,
  FormControl,
  InputLabel
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ModalHeader from '@renderer/shared/modals/ModalHeader';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import { apiClient } from '@/lib/api-client';
import MatchingTimeSeriesChart from './MatchingTimeSeriesChart';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '@renderer/shared/components/LicenseReadOnlyAlert';
import type {
  ProcessedDate,
  BankRepaymentsForDateResponse,
} from '@renderer/types/manual-matching';

interface Pairing {
  id: number;
  creditCardVendor: string;
  creditCardAccountNumber: string | null;
  bankVendor: string;
  bankAccountNumber: string | null;
  matchPatterns?: string[];
}

interface Repayment {
  identifier: string;
  vendor: string;
  date: string;
  name: string;
  price: number;
  accountNumber: string | null;
  matchedAmount: number;
  remainingAmount: number;
  isPartiallyMatched: boolean;
}

interface Expense {
  identifier: string;
  vendor: string;
  date: string;
  name: string;
  price: number;
  accountNumber: string | null;
  categoryId: number | null;
  categoryName: string | null;
  processedDate?: string | null;
  isMatched?: boolean;
}

interface ManualMatchingModalProps {
  isOpen: boolean;
  onClose: () => void;
  pairing: Pairing | null;
}

interface RepaymentMatchStatus extends Repayment {
  isFullyMatched: boolean;
}

interface Combination {
  expenses: Expense[];
  totalAmount: number;
  difference: number;
  count: number;
}

interface UnmatchedRepaymentsResponse {
  repayments: Repayment[];
}

interface ProcessedDatesResponse {
  processedDates: ProcessedDate[];
}

interface AvailableExpensesResponse {
  expenses: Expense[];
  smartDateUsed?: boolean;
}

interface FindCombinationResponse {
  combinations: Combination[];
}

interface ApiErrorResponse {
  error?: string;
}

export default function ManualMatchingModal({
  isOpen,
  onClose,
  pairing
}: ManualMatchingModalProps) {
  const [repayments, setRepayments] = useState<RepaymentMatchStatus[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [selectedRepayment, setSelectedRepayment] = useState<RepaymentMatchStatus | null>(null);
  const [selectedExpenses, setSelectedExpenses] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [savingMatch, setSavingMatch] = useState(false);
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [combinations, setCombinations] = useState<Combination[]>([]);
  const [findingCombinations, setFindingCombinations] = useState(false);
  const [showCombinations, setShowCombinations] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticInfo, setDiagnosticInfo] = useState<any>(null);
  const [licenseAlertOpen, setLicenseAlertOpen] = useState(false);
  const [licenseAlertReason, setLicenseAlertReason] = useState<string | undefined>();
  const { showNotification } = useNotification();

  // NEW: Smart matching state
  const [processedDates, setProcessedDates] = useState<ProcessedDate[]>([]);
  const [selectedProcessedDate, setSelectedProcessedDate] = useState<string>('');
  const [smartMatchingSuggestion, setSmartMatchingSuggestion] = useState<BankRepaymentsForDateResponse | null>(null);
  const [useSmartMatching, setUseSmartMatching] = useState(true); // Default to smart matching

  // Fetch unmatched repayments when modal opens
  useEffect(() => {
    if (isOpen && pairing) {
      fetchUnmatchedRepayments();
    } else {
      // Reset state when modal closes
      setRepayments([]);
      setExpenses([]);
      setSelectedRepayment(null);
      setSelectedExpenses(new Set());
    }
  }, [isOpen, pairing]);

  // NEW: Fetch processed dates when modal opens
  useEffect(() => {
    if (isOpen && pairing && useSmartMatching) {
      fetchProcessedDates();
    }
  }, [isOpen, pairing, useSmartMatching]);

  // NEW: Auto-select processed date when repayment is selected (smart matching)
  useEffect(() => {
    if (selectedRepayment && useSmartMatching && processedDates.length > 0) {
      // Try to find a processed date that matches the repayment date
      const matchingProcessedDate = processedDates.find(
        pd => pd.processedDate === selectedRepayment.date
      );

      if (matchingProcessedDate) {
        setSelectedProcessedDate(matchingProcessedDate.processedDate);
        fetchSmartMatchingSuggestion(matchingProcessedDate.processedDate);
      } else {
        // Select the most recent processed date by default
        const mostRecent = processedDates[0];
        if (mostRecent) {
          setSelectedProcessedDate(mostRecent.processedDate);
          fetchSmartMatchingSuggestion(mostRecent.processedDate);
        }
      }
    }
  }, [selectedRepayment, processedDates, useSmartMatching]);

  // Fetch expenses when a repayment is selected or processed date changes
  useEffect(() => {
    if (selectedRepayment) {
      fetchAvailableExpenses(selectedRepayment);
    } else {
      setExpenses([]);
      setSelectedExpenses(new Set());
    }
  }, [selectedRepayment, selectedProcessedDate, useSmartMatching]);

  const fetchUnmatchedRepayments = async () => {
    if (!pairing) return;

    setLoading(true);
    try {
      // Build query params with matchPatterns
      const params = new URLSearchParams({
        creditCardAccountNumber: pairing.creditCardAccountNumber || '',
        creditCardVendor: pairing.creditCardVendor,
        bankVendor: pairing.bankVendor,
        bankAccountNumber: pairing.bankAccountNumber || ''
      });

      // Add matchPatterns if available
      if (pairing.matchPatterns && pairing.matchPatterns.length > 0) {
        params.append('matchPatterns', JSON.stringify(pairing.matchPatterns));
      }

      const response = await apiClient.get<UnmatchedRepaymentsResponse>(
        `/api/investments/manual-matching/unmatched-repayments?${params.toString()}`
      );

      if (response.ok) {
        const repaymentsData = response.data?.repayments || [];
        // Mark repayments as fully matched if remaining amount is <= 2
        const repaymentsWithStatus = repaymentsData.map((rep: Repayment) => ({
          ...rep,
          isFullyMatched: rep.remainingAmount <= 2
        }));
        setRepayments(repaymentsWithStatus);
      } else {
        showNotification('Failed to load repayments', 'error');
      }
    } catch (error) {
      console.error('Error fetching unmatched repayments:', error);
      showNotification('Error loading repayments', 'error');
    } finally {
      setLoading(false);
    }
  };

  // NEW: Fetch available processed dates for smart matching
  const fetchProcessedDates = async () => {
    if (!pairing) return;

    try {
      const response = await apiClient.get<ProcessedDatesResponse>(
        `/api/investments/manual-matching/processed-dates?creditCardAccountNumber=${pairing.creditCardAccountNumber || ''}&creditCardVendor=${pairing.creditCardVendor}`
      );

      if (response.ok) {
        setProcessedDates(response.data?.processedDates || []);
      }
    } catch (error) {
      console.error('Error fetching processed dates:', error);
    }
  };

  // NEW: Fetch smart matching suggestion for a processed date
  const fetchSmartMatchingSuggestion = async (processedDate: string) => {
    if (!pairing) return;

    try {
      const response = await apiClient.get<BankRepaymentsForDateResponse>(
        `/api/investments/manual-matching/bank-repayments-for-date?processedDate=${processedDate}&bankVendor=${pairing.bankVendor}&bankAccountNumber=${pairing.bankAccountNumber || ''}&matchPatterns=${JSON.stringify(pairing.matchPatterns || [])}`
      );

      if (response.ok) {
        setSmartMatchingSuggestion(response.data);
      }
    } catch (error) {
      console.error('Error fetching smart matching suggestion:', error);
    }
  };

  const fetchAvailableExpenses = async (repayment: Repayment) => {
    if (!pairing) return;

    setExpensesLoading(true);
    setSelectedExpenses(new Set());
    try {
      // Build URL with smart matching parameter if enabled
      let url = `/api/investments/manual-matching/available-expenses?repaymentDate=${repayment.date}&creditCardAccountNumber=${pairing.creditCardAccountNumber || ''}&creditCardVendor=${pairing.creditCardVendor}`;

      // NEW: Add processedDate parameter for smart matching
      if (useSmartMatching && selectedProcessedDate) {
        url += `&processedDate=${selectedProcessedDate}`;
      }

      const response = await apiClient.get<AvailableExpensesResponse>(url);

      if (response.ok) {
        setExpenses(response.data?.expenses || []);

        // Show notification if smart matching was used
        if (response.data?.smartDateUsed) {
          const matchedDate = new Date(selectedProcessedDate).toLocaleDateString();
          showNotification(`Smart matching: Showing expenses from ${matchedDate} billing cycle`, 'info');
        }
      } else {
        showNotification('Failed to load expenses', 'error');
      }
    } catch (error) {
      console.error('Error fetching available expenses:', error);
      showNotification('Error loading expenses', 'error');
    } finally {
      setExpensesLoading(false);
    }
  };

  const toggleExpense = (identifier: string) => {
    setSelectedExpenses(prev => {
      const next = new Set(prev);
      if (next.has(identifier)) {
        next.delete(identifier);
      } else {
        next.add(identifier);
      }
      return next;
    });
  };

  const toggleAllExpenses = () => {
    if (selectedExpenses.size === expenses.length) {
      setSelectedExpenses(new Set());
    } else {
      setSelectedExpenses(new Set(expenses.map(e => e.identifier)));
    }
  };

  const calculateSelectedSum = () => {
    return expenses
      .filter(e => selectedExpenses.has(e.identifier))
      .reduce((sum, e) => sum + Math.abs(e.price), 0);
  };

  const getMatchStatus = () => {
    if (!selectedRepayment || selectedExpenses.size === 0) {
      return { color: 'default' as const, label: 'Select expenses', canSave: false, difference: 0 };
    }

    const selectedSum = calculateSelectedSum();
    const repaymentAmount = Math.abs(selectedRepayment.price);
    const difference = Math.abs(repaymentAmount - selectedSum);

    // NEW: Smart matching with fees/interest tolerance
    // If using smart matching and difference is within typical fees range (₪0-₪50)
    const isSmartMatch = useSmartMatching && selectedProcessedDate;
    const isFeeRange = difference > 2 && difference <= 50;

    if (difference <= 2) {
      return { color: 'success' as const, label: `Perfect match! (diff: ₪${difference.toFixed(2)})`, canSave: true, difference };
    } else if (isSmartMatch && isFeeRange) {
      // Allow saving with fees/interest acknowledgment
      return {
        color: 'warning' as const,
        label: `Match with fees (₪${difference.toFixed(2)} fees/interest)`,
        canSave: true,  // NEW: Allow saving with acknowledged fees
        difference
      };
    } else if (difference <= 10) {
      return { color: 'warning' as const, label: `Near match (diff: ₪${difference.toFixed(2)})`, canSave: false, difference };
    } else {
      return { color: 'error' as const, label: `Mismatch (diff: ₪${difference.toFixed(2)})`, canSave: false, difference };
    }
  };

  const handleSaveMatch = async () => {
    if (!selectedRepayment || !pairing || selectedExpenses.size === 0) return;

    const matchStatus = getMatchStatus();
    if (!matchStatus.canSave) {
      const message = useSmartMatching && selectedProcessedDate
        ? 'Cannot save: difference must be ≤ ₪2 or ≤ ₪50 with smart matching'
        : 'Cannot save: difference must be ≤ ₪2';
      showNotification(message, 'error');
      return;
    }

    setSavingMatch(true);
    try {
      const selectedExpenseObjects = expenses.filter(e => selectedExpenses.has(e.identifier));

      // Calculate tolerance: if smart matching with fees, allow up to 50, otherwise strict 2
      const selectedSum = calculateSelectedSum();
      const repaymentAmount = Math.abs(selectedRepayment.price);
      const difference = Math.abs(repaymentAmount - selectedSum);
      const isSmartMatch = useSmartMatching && selectedProcessedDate;
      const isFeeRange = difference > 2 && difference <= 50;
      const tolerance = (isSmartMatch && isFeeRange) ? 50 : 2;

      const response = await apiClient.post<ApiErrorResponse>('/api/investments/manual-matching/save-match', {
        repaymentTxnId: selectedRepayment.identifier,
        repaymentVendor: selectedRepayment.vendor,
        repaymentDate: selectedRepayment.date,
        repaymentAmount: selectedRepayment.price,
        cardNumber: pairing.creditCardAccountNumber,
        ccVendor: pairing.creditCardVendor,
        expenses: selectedExpenseObjects.map(e => ({
          identifier: e.identifier,
          vendor: e.vendor,
          date: e.date,
          price: e.price
        })),
        tolerance  // NEW: Send tolerance parameter (2 or 50)
      });

      if (response.ok) {
        showNotification(`Successfully matched ${selectedExpenses.size} expenses!`, 'success');

        // Refresh repayments list to update matched status
        await fetchUnmatchedRepayments();

        // Clear selected repayment to force user to manually select next one
        setSelectedRepayment(null);
        setExpenses([]);
        setSelectedExpenses(new Set());
      } else {
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(response.data);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        showNotification(response.data?.error || 'Failed to save match', 'error');
      }
    } catch (error) {
      console.error('Error saving match:', error);
      showNotification('Error saving match', 'error');
    } finally {
      setSavingMatch(false);
    }
  };

  const handleFindCombinations = async (extended = false) => {
    if (!selectedRepayment || !pairing) return;

    setFindingCombinations(true);
    setCombinations([]);
    try {
      // For extended search, temporarily modify the repayment date to look back 120 days
      // AND include already matched expenses
      let searchDate = selectedRepayment.date;
      if (extended) {
        const date = new Date(selectedRepayment.date);
        date.setDate(date.getDate() + 60); // Add 60 days to look back 120 total
        searchDate = date.toISOString();
      }

      let url = `/api/investments/manual-matching/find-combinations?` +
        `repaymentTxnId=${selectedRepayment.identifier}&` +
        `repaymentDate=${searchDate}&` +
        `repaymentAmount=${selectedRepayment.price}&` +
        `creditCardAccountNumber=${pairing.creditCardAccountNumber || ''}&` +
        `creditCardVendor=${pairing.creditCardVendor}&` +
        `includeMatched=${extended ? 'true' : 'false'}`;  // Include matched expenses for extended search

      // NEW: Add processedDate for smart matching (unless extended search)
      if (!extended && useSmartMatching && selectedProcessedDate) {
        url += `&processedDate=${selectedProcessedDate}`;
      }

      const response = await apiClient.get<FindCombinationResponse>(url);

      if (response.ok) {
        const combos = response.data?.combinations || [];
        setCombinations(combos);
        setShowCombinations(true);
        if (combos.length === 0) {
          showNotification(
            extended
              ? 'No perfect match found even with extended search (120 days)'
              : 'No perfect match combinations found (60-day window)',
            'warning'
          );
        } else {
          showNotification(
            `Found ${combos.length} perfect match combination${combos.length > 1 ? 's' : ''}!${extended ? ' (Extended search: 120 days)' : ''}`,
            'success'
          );
        }
      } else {
        showNotification('Failed to find combinations', 'error');
      }
    } catch (error) {
      console.error('Error finding combinations:', error);
      showNotification('Error finding combinations', 'error');
    } finally {
      setFindingCombinations(false);
    }
  };

  const handleSelectCombination = (combo: Combination) => {
    const expenseIds = combo.expenses.map(e => e.identifier);
    setSelectedExpenses(new Set(expenseIds));
    setShowCombinations(false);
    showNotification(`Selected combination with ${combo.count} expenses (diff: ₪${combo.difference.toFixed(2)})`, 'info');
  };

  const handleDiagnose = () => {
    if (!selectedRepayment || !pairing) return;

    // Calculate diagnostics
    const repaymentAmount = Math.abs(selectedRepayment.price);
    const repaymentDate = new Date(selectedRepayment.date);
    const lookbackStart = new Date(repaymentDate);
    lookbackStart.setDate(lookbackStart.getDate() - 60);

    const totalAvailableExpenses = expenses.length;
    const totalExpensesAmount = expenses.reduce((sum, e) => sum + Math.abs(e.price), 0);

    const oldestExpense = expenses.length > 0
      ? new Date(Math.min(...expenses.map(e => new Date(e.date).getTime())))
      : null;

    const newestExpense = expenses.length > 0
      ? new Date(Math.max(...expenses.map(e => new Date(e.date).getTime())))
      : null;

    // Check if lookback period is before earliest transactions
    const dateGap = oldestExpense && lookbackStart < oldestExpense
      ? Math.round((oldestExpense.getTime() - lookbackStart.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    setDiagnosticInfo({
      repaymentAmount,
      repaymentDate: repaymentDate.toLocaleDateString(),
      lookbackStart: lookbackStart.toLocaleDateString(),
      lookbackEnd: repaymentDate.toLocaleDateString(),
      totalAvailableExpenses,
      totalExpensesAmount,
      difference: Math.abs(repaymentAmount - totalExpensesAmount),
      oldestExpense: oldestExpense?.toLocaleDateString(),
      newestExpense: newestExpense?.toLocaleDateString(),
      dateGap,
      hasGap: dateGap > 0,
      cardInfo: `${pairing.creditCardVendor} ${pairing.creditCardAccountNumber || 'All'}`
    });

    setShowDiagnostics(true);
  };

  const handleClose = () => {
    setSelectedRepayment(null);
    setExpenses([]);
    setSelectedExpenses(new Set());
    setCombinations([]);
    setShowCombinations(false);
    setSelectedProcessedDate('');
    setSmartMatchingSuggestion(null);
    onClose();
  };

  const matchStatus = getMatchStatus();

  return (
    <Dialog open={isOpen} onClose={handleClose} maxWidth="xl" fullWidth>
      <ModalHeader
        title="Manual Transaction Matching"
        onClose={handleClose}
      />

      <DialogContent>
        {pairing && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Pairing:</strong> {pairing.creditCardVendor} ({pairing.creditCardAccountNumber || 'All'}) → {pairing.bankVendor} ({pairing.bankAccountNumber || 'All'})
            </Typography>
            {pairing.matchPatterns && pairing.matchPatterns.length > 0 && (
              <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                <strong>Filtering repayments by patterns:</strong> {pairing.matchPatterns.join(', ')}
              </Typography>
            )}
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
              Match bank repayments with their corresponding credit card expenses. Only unmatched repayments matching the patterns are shown.
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic', color: 'text.secondary' }}>
              ⓘ Repayments older than 30 days from the first 10 days of the month are hidden (incomplete expense data)
            </Typography>
          </Alert>
        )}

        {/* Time Series Chart */}
        {pairing && (
          <Box sx={{ mb: 2 }}>
            <MatchingTimeSeriesChart pairing={pairing} compact={false} />
          </Box>
        )}

        <Box sx={{ display: 'flex', gap: 2, height: '600px' }}>
          {/* Left Panel: Repayments */}
          <Box sx={{ width: '30%', display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Bank Repayments
            </Typography>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : repayments.length === 0 ? (
              <Alert severity="success">
                All repayments are fully matched! 🎉
              </Alert>
            ) : (
              <TableContainer component={Paper} sx={{ flex: 1, overflow: 'auto' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell align="center">Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {repayments.map((repayment) => (
                      <TableRow
                        key={repayment.identifier}
                        hover={!repayment.isFullyMatched}
                        selected={selectedRepayment?.identifier === repayment.identifier}
                        onClick={() => !repayment.isFullyMatched && setSelectedRepayment(repayment)}
                        sx={{
                          cursor: repayment.isFullyMatched ? 'default' : 'pointer',
                          bgcolor: repayment.isFullyMatched ? 'success.light' : 'inherit',
                          opacity: repayment.isFullyMatched ? 0.6 : 1,
                          '&:hover': {
                            bgcolor: repayment.isFullyMatched ? 'success.light' : 'action.hover'
                          }
                        }}
                      >
                        <TableCell>
                          <Typography variant="body2">
                            {new Date(repayment.date).toLocaleDateString()}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {repayment.name.substring(0, 20)}...
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            ₪{Math.abs(repayment.price).toLocaleString()}
                          </Typography>
                          {repayment.isPartiallyMatched && !repayment.isFullyMatched && (
                            <Typography variant="caption" color="warning.main">
                              ₪{repayment.remainingAmount.toFixed(2)} left
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="center">
                          {repayment.isFullyMatched && (
                            <CheckCircleIcon color="success" fontSize="small" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>

          <Divider orientation="vertical" flexItem />

          {/* Right Panel: Expenses */}
          <Box sx={{ width: '70%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="h6">
                  Credit Card Expenses
                </Typography>
                {useSmartMatching && <Chip icon={<AutoFixHighIcon />} label="Smart" size="small" color="success" />}
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {selectedRepayment && (
                  <>
                    <Chip
                      label={`Repayment: ₪${Math.abs(selectedRepayment.price).toLocaleString()}`}
                      color="primary"
                      size="small"
                    />
                    <Button
                      variant={useSmartMatching ? "contained" : "outlined"}
                      size="small"
                      onClick={() => handleFindCombinations(false)}
                      disabled={findingCombinations || expenses.length === 0}
                      startIcon={findingCombinations ? <CircularProgress size={16} /> : useSmartMatching ? <AutoFixHighIcon /> : null}
                      color={useSmartMatching ? "success" : "primary"}
                    >
                      {findingCombinations ? 'Finding...' : useSmartMatching ? 'Smart Match' : 'Find Match (60d)'}
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      color="warning"
                      onClick={() => handleFindCombinations(true)}
                      disabled={findingCombinations || expenses.length === 0}
                      startIcon={findingCombinations ? <CircularProgress size={16} /> : null}
                    >
                      Extended (120d)
                    </Button>
                    <Button
                      variant="text"
                      size="small"
                      color="info"
                      onClick={handleDiagnose}
                    >
                      Diagnose
                    </Button>
                  </>
                )}
              </Box>
            </Box>

            {!selectedRepayment ? (
              <Alert severity="info">
                Select a repayment from the left to view available expenses
              </Alert>
            ) : (
              <>
                {/* NEW: Smart matching controls */}
                {useSmartMatching && processedDates.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Billing Cycle (Smart Match)</InputLabel>
                      <Select
                        value={selectedProcessedDate}
                        label="Billing Cycle (Smart Match)"
                        onChange={(e) => {
                          setSelectedProcessedDate(e.target.value);
                          if (e.target.value) {
                            fetchSmartMatchingSuggestion(e.target.value);
                          }
                        }}
                      >
                        <MenuItem value="">
                          <em>All expenses (60-day lookback)</em>
                        </MenuItem>
                        {processedDates.map((pd) => (
                          <MenuItem key={pd.processedDate} value={pd.processedDate}>
                            {new Date(pd.processedDate).toLocaleDateString()} - {pd.expenseCount} expenses (₪{pd.totalAmount.toLocaleString()})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    {/* Show smart matching suggestion */}
                    {smartMatchingSuggestion && smartMatchingSuggestion.repaymentCount > 0 && (
                      <Alert severity="success" sx={{ mt: 1 }}>
                        <AlertTitle>Smart Match Found!</AlertTitle>
                        Found {smartMatchingSuggestion.repaymentCount} bank repayment(s) totaling ₪{smartMatchingSuggestion.totalRepaymentAmount.toLocaleString()} on this date.
                        {smartMatchingSuggestion.repayments.map((repayment) => (
                          <Typography key={repayment.identifier} variant="caption" display="block">
                            • {repayment.name}: ₪{Math.abs(repayment.price).toLocaleString()}
                          </Typography>
                        ))}
                      </Alert>
                    )}
                  </Box>
                )}

                {expensesLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress />
                  </Box>
                ) : expenses.length === 0 ? (
                  <Alert severity="warning">
                    {useSmartMatching && selectedProcessedDate
                      ? `No expenses found for the selected billing cycle (${new Date(selectedProcessedDate).toLocaleDateString()})`
                      : 'No available expenses found in the 60-day period before this repayment'}
                  </Alert>
                ) : (
                  <>
                    <TableContainer component={Paper} sx={{ flex: 1, overflow: 'auto', mb: 2 }}>
                      <Table stickyHeader size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={selectedExpenses.size === expenses.length && expenses.length > 0}
                                indeterminate={selectedExpenses.size > 0 && selectedExpenses.size < expenses.length}
                                onChange={toggleAllExpenses}
                              />
                            </TableCell>
                            <TableCell>Date</TableCell>
                            <TableCell>Description</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell>Category</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {expenses.map((expense) => {
                            const isSelected = selectedExpenses.has(expense.identifier);
                            return (
                              <TableRow
                                key={expense.identifier}
                                hover
                                selected={isSelected}
                                onClick={() => toggleExpense(expense.identifier)}
                                sx={{ cursor: 'pointer' }}
                              >
                                <TableCell padding="checkbox">
                                  <Checkbox
                                    checked={isSelected}
                                    onChange={() => toggleExpense(expense.identifier)}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Typography variant="body2">
                                    {new Date(expense.date).toLocaleDateString()}
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  <Typography variant="body2" sx={{ fontWeight: isSelected ? 600 : 400 }}>
                                    {expense.name}
                                  </Typography>
                                </TableCell>
                                <TableCell align="right">
                                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: isSelected ? 600 : 400 }}>
                                    ₪{Math.abs(expense.price).toLocaleString()}
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  <Typography variant="caption" color="text.secondary">
                                    {expense.categoryName || 'N/A'}
                                  </Typography>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>

                    {/* Sum and Save Section */}
                    <Paper sx={{ p: 2, bgcolor: 'background.default' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                          <Typography variant="body2" color="text.secondary">
                            Selected Expenses: {selectedExpenses.size} items
                          </Typography>
                          <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
                            Sum: ₪{calculateSelectedSum().toLocaleString()}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                          <Chip
                            label={matchStatus.label}
                            color={matchStatus.color}
                            sx={{ fontWeight: 600 }}
                          />
                          <Button
                            variant="contained"
                            color="success"
                            onClick={handleSaveMatch}
                            disabled={!matchStatus.canSave || savingMatch}
                            startIcon={savingMatch ? <CircularProgress size={20} /> : <CheckCircleIcon />}
                          >
                            Save Match
                          </Button>
                        </Box>
                      </Box>
                    </Paper>
                  </>
                )}
              </>
            )}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={savingMatch}>
          Close
        </Button>
      </DialogActions>

      {/* Combinations Dialog */}
      <Dialog
        open={showCombinations}
        onClose={() => setShowCombinations(false)}
        maxWidth="md"
        fullWidth
      >
        <ModalHeader
          title="Matching Combinations Found"
          onClose={() => setShowCombinations(false)}
        />
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Found {combinations.length} perfect match combination{combinations.length > 1 ? 's' : ''} of expenses (0.00 NIS difference).
            Click on a combination to auto-select those expenses.
          </Alert>
          <List>
            {combinations.map((combo, index) => (
              <ListItem
                key={index}
                component="button"
                onClick={() => handleSelectCombination(combo)}
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  mb: 1,
                  '&:hover': { bgcolor: 'action.hover' }
                }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>
                        Combination #{index + 1}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Chip
                          label={`${combo.count} expenses`}
                          size="small"
                          color="primary"
                        />
                        <Chip
                          label={`₪${combo.totalAmount.toLocaleString()}`}
                          size="small"
                        />
                        <Chip
                          label={combo.difference === 0 ? 'Perfect Match ✓' : `Diff: ₪${combo.difference.toFixed(2)}`}
                          size="small"
                          color={combo.difference === 0 ? 'success' : 'error'}
                        />
                      </Box>
                    </Box>
                  }
                  secondary={
                    <Box sx={{ mt: 1 }}>
                      {combo.expenses.map((exp, i) => (
                        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                          <Typography variant="caption" color="text.secondary">
                            • {new Date(exp.date).toLocaleDateString()} - {exp.name} - ₪{Math.abs(exp.price).toLocaleString()}
                          </Typography>
                          {exp.isMatched && (
                            <Chip
                              component="span"
                              label="Already Matched"
                              size="small"
                              color="warning"
                              sx={{ ml: 1, height: 16, fontSize: '0.65rem' }}
                            />
                          )}
                        </Box>
                      ))}
                    </Box>
                  }
                  primaryTypographyProps={{ component: 'div' }}
                  secondaryTypographyProps={{ component: 'div' }}
                />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCombinations(false)}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* Diagnostics Dialog */}
      <Dialog
        open={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        maxWidth="sm"
        fullWidth
      >
        <ModalHeader
          title="Repayment Diagnostics"
          onClose={() => setShowDiagnostics(false)}
        />
        <DialogContent>
          {diagnosticInfo && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Repayment Analysis
              </Typography>

              <Paper sx={{ p: 2, mb: 2, bgcolor: 'background.default' }}>
                <Typography variant="body2" color="text.secondary">Card:</Typography>
                <Typography variant="body1" gutterBottom>{diagnosticInfo.cardInfo}</Typography>

                <Typography variant="body2" color="text.secondary">Repayment Amount:</Typography>
                <Typography variant="h6" gutterBottom>₪{diagnosticInfo.repaymentAmount.toLocaleString()}</Typography>

                <Typography variant="body2" color="text.secondary">Repayment Date:</Typography>
                <Typography variant="body1" gutterBottom>{diagnosticInfo.repaymentDate}</Typography>
              </Paper>

              <Divider sx={{ my: 2 }} />

              <Typography variant="h6" gutterBottom>
                Available Expenses (60-day window)
              </Typography>

              <Paper sx={{ p: 2, mb: 2, bgcolor: 'background.default' }}>
                <Typography variant="body2" color="text.secondary">Lookback Period:</Typography>
                <Typography variant="body1" gutterBottom>
                  {diagnosticInfo.lookbackStart} → {diagnosticInfo.lookbackEnd}
                </Typography>

                <Typography variant="body2" color="text.secondary">Available Expenses:</Typography>
                <Typography variant="h6" gutterBottom>{diagnosticInfo.totalAvailableExpenses} transactions</Typography>

                <Typography variant="body2" color="text.secondary">Total Available Amount:</Typography>
                <Typography variant="h6" gutterBottom>₪{diagnosticInfo.totalExpensesAmount.toLocaleString()}</Typography>

                {diagnosticInfo.totalAvailableExpenses > 0 && (
                  <>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Expense Date Range:</Typography>
                    <Typography variant="body1">
                      {diagnosticInfo.oldestExpense} → {diagnosticInfo.newestExpense}
                    </Typography>
                  </>
                )}
              </Paper>

              <Divider sx={{ my: 2 }} />

              {diagnosticInfo.hasGap ? (
                <Alert severity="error" sx={{ mb: 2 }}>
                  <AlertTitle>Data Gap Detected!</AlertTitle>
                  Your lookback period starts on <strong>{diagnosticInfo.lookbackStart}</strong>, but your oldest expense is from{' '}
                  <strong>{diagnosticInfo.oldestExpense}</strong> ({diagnosticInfo.dateGap} days gap).
                  <br /><br />
                  <strong>This repayment likely includes expenses from before you started tracking.</strong>
                  <br /><br />
                  Try the <strong>"Extended (120d)"</strong> search, or this repayment may need to be marked as pre-tracking.
                </Alert>
              ) : (
                <>
                  {diagnosticInfo.difference > 2 ? (
                    <Alert severity="warning">
                      <AlertTitle>Amount Mismatch</AlertTitle>
                      Difference: ₪{diagnosticInfo.difference.toLocaleString()}
                      <br /><br />
                      The available expenses don't match the repayment amount. Possible reasons:
                      <ul>
                        <li>Some expenses are already matched to other repayments</li>
                        <li>Multiple billing cycles combined in one repayment</li>
                        <li>Need to adjust date range (try Extended search)</li>
                      </ul>
                    </Alert>
                  ) : (
                    <Alert severity="success">
                      <AlertTitle>Data Looks Good!</AlertTitle>
                      You have {diagnosticInfo.totalAvailableExpenses} available expenses totaling ₪
                      {diagnosticInfo.totalExpensesAmount.toLocaleString()}.
                      <br /><br />
                      Try using <strong>"Find Match (60d)"</strong> to find matching combinations.
                    </Alert>
                  )}
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDiagnostics(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <LicenseReadOnlyAlert
        open={licenseAlertOpen}
        onClose={() => setLicenseAlertOpen(false)}
        reason={licenseAlertReason}
      />
    </Dialog>
  );
}
