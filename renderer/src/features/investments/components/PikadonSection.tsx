import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Card,
  Grid,
  Typography,
  Skeleton,
  useTheme,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Tooltip,
  Button,
  Collapse,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Divider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import {
  Savings as SavingsIcon,
  TrendingUp as TrendingUpIcon,
  Schedule as ScheduleIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Link as LinkIcon,
  Refresh as RefreshIcon,
  Autorenew as AutorenewIcon,
  AccountTree as AccountTreeIcon,
  Search as SearchIcon,
  Add as AddIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { apiClient } from '@/lib/api-client';
import type {
  PikadonHolding,
  PikadonSummary,
  UpcomingMaturity,
  PikadonDetectResponse,
  RolloverSuggestion,
} from '@/types/investments';

interface PikadonSectionProps {
  onRefresh?: () => void;
}

const PikadonSection: React.FC<PikadonSectionProps> = ({ onRefresh }) => {
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PikadonSummary | null>(null);
  const [upcomingMaturities, setUpcomingMaturities] = useState<UpcomingMaturity[]>([]);
  const [pikadonList, setPikadonList] = useState<PikadonHolding[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [listLoading, setListLoading] = useState(false);

  // Detection dialog state
  const [detectDialogOpen, setDetectDialogOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectionResult, setDetectionResult] = useState<PikadonDetectResponse | null>(null);
  const [accounts, setAccounts] = useState<Array<{ id: number; account_name: string }>>([]);
  const [selectedAccount, setSelectedAccount] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  // Fetch investment accounts for the dropdown
  const fetchAccounts = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/investments/accounts');
      if (response.ok && response.data) {
        const data = response.data as { accounts: Array<{ id: number; account_name: string; account_type: string }> };
        // Filter to savings accounts
        const savingsAccounts = data.accounts.filter(a =>
          a.account_type === 'savings' || a.account_type === 'bank_balance'
        );
        setAccounts(savingsAccounts);
        if (savingsAccounts.length > 0) {
          setSelectedAccount(savingsAccounts[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching accounts:', err);
    }
  }, []);

  // Detect pikadon pairs from transactions
  const handleDetect = async () => {
    setDetecting(true);
    setDetectionResult(null);
    try {
      const response = await apiClient.get('/api/investments/pikadon/detect');
      if (response.ok) {
        setDetectionResult(response.data as PikadonDetectResponse);
      } else {
        throw new Error('Detection failed');
      }
    } catch (err) {
      console.error('Error detecting pikadon:', err);
      setError('Failed to detect pikadon transactions');
    } finally {
      setDetecting(false);
    }
  };

  // Create a pikadon from a detected suggestion
  const handleCreateFromSuggestion = async (suggestion: PikadonDetectResponse['suggestions'][0]) => {
    if (!selectedAccount) {
      alert('Please select an account');
      return;
    }

    setCreating(true);
    try {
      const payload = {
        account_id: selectedAccount,
        cost_basis: suggestion.deposit_amount,
        as_of_date: suggestion.deposit_date.split('T')[0],
        deposit_transaction_id: suggestion.deposit_transaction.identifier,
        deposit_transaction_vendor: suggestion.deposit_transaction.vendor,
        maturity_date: suggestion.best_match ? suggestion.best_match.return_transaction.date.split('T')[0] : null,
        interest_rate: suggestion.best_match ? suggestion.best_match.interest_rate : null,
      };

      const createResponse = await apiClient.post('/api/investments/pikadon', payload);

      if (createResponse.ok && suggestion.best_match) {
        // Link the return transaction
        const pikadon = (createResponse.data as { pikadon: PikadonHolding }).pikadon;
        await apiClient.put(`/api/investments/pikadon/${pikadon.id}/link-return`, {
          return_transaction_id: suggestion.best_match.return_transaction.identifier,
          return_transaction_vendor: suggestion.best_match.return_transaction.vendor,
          return_amount: suggestion.best_match.return_amount,
        });
      }

      // Refresh data
      await fetchSummary();
      if (expanded) {
        await fetchPikadonList();
      }

      // Re-detect to update the list
      await handleDetect();

      onRefresh?.();
    } catch (err) {
      console.error('Error creating pikadon:', err);
      setError('Failed to create pikadon');
    } finally {
      setCreating(false);
    }
  };

  // Create pikadon with rollover
  const handleCreateRollover = async (rollover: RolloverSuggestion) => {
    if (!selectedAccount) {
      alert('Please select an account');
      return;
    }

    setCreating(true);
    try {
      // First create the original pikadon
      const originalPayload = {
        account_id: selectedAccount,
        cost_basis: rollover.original_deposit_amount,
        as_of_date: rollover.original_deposit.date.split('T')[0],
        deposit_transaction_id: rollover.original_deposit.identifier,
        deposit_transaction_vendor: rollover.original_deposit.vendor,
        interest_rate: (rollover.interest_earned / rollover.original_deposit_amount) * 100,
      };

      const createResponse = await apiClient.post('/api/investments/pikadon', originalPayload);

      if (createResponse.ok && rollover.best_rollover) {
        const originalPikadon = (createResponse.data as { pikadon: PikadonHolding }).pikadon;

        // Now perform the rollover
        await apiClient.post(`/api/investments/pikadon/${originalPikadon.id}/rollover`, {
          return_transaction_id: rollover.return_transaction.identifier,
          return_transaction_vendor: rollover.return_transaction.vendor,
          return_amount: rollover.return_amount,
          new_principal: rollover.best_rollover.new_deposit_amount,
          new_as_of_date: rollover.best_rollover.new_deposit_date.split('T')[0],
          new_deposit_transaction_id: rollover.best_rollover.new_deposit_transaction.identifier,
          new_deposit_transaction_vendor: rollover.best_rollover.new_deposit_transaction.vendor,
        });
      }

      // Refresh data
      await fetchSummary();
      if (expanded) {
        await fetchPikadonList();
      }

      // Re-detect to update the list
      await handleDetect();

      onRefresh?.();
    } catch (err) {
      console.error('Error creating rollover:', err);
      setError('Failed to create rollover');
    } finally {
      setCreating(false);
    }
  };

  // Open detection dialog
  const openDetectDialog = async () => {
    setDetectDialogOpen(true);
    await fetchAccounts();
    await handleDetect();
  };

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get('/api/investments/pikadon/summary');
      if (response.ok) {
        const data = response.data as {
          summary: PikadonSummary;
          upcoming_maturities: UpcomingMaturity[];
        };
        setSummary(data.summary);
        setUpcomingMaturities(data.upcoming_maturities || []);
      } else {
        throw new Error('Failed to fetch pikadon summary');
      }
    } catch (err) {
      console.error('Error fetching pikadon summary:', err);
      setError('Failed to load pikadon data');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPikadonList = useCallback(async () => {
    setListLoading(true);
    try {
      const response = await apiClient.get('/api/investments/pikadon');
      if (response.ok) {
        const data = response.data as { pikadon: PikadonHolding[] };
        setPikadonList(data.pikadon || []);
      }
    } catch (err) {
      console.error('Error fetching pikadon list:', err);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    if (expanded && pikadonList.length === 0) {
      fetchPikadonList();
    }
  }, [expanded, pikadonList.length, fetchPikadonList]);

  const handleRefresh = async () => {
    await fetchSummary();
    if (expanded) {
      await fetchPikadonList();
    }
    onRefresh?.();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'info';
      case 'matured':
        return 'success';
      case 'rolled_over':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return 'Active';
      case 'matured':
        return 'Matured';
      case 'rolled_over':
        return 'Rolled Over';
      default:
        return status;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getDaysUntilMaturity = (maturityDate: string) => {
    const now = new Date();
    const maturity = new Date(maturityDate);
    const diffTime = maturity.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  if (loading) {
    return (
      <Card sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Skeleton variant="circular" width={28} height={28} sx={{ mr: 2 }} />
          <Skeleton variant="text" width={200} height={32} />
        </Box>
        <Grid container spacing={3}>
          {[1, 2, 3, 4].map((i) => (
            <Grid item xs={6} md={3} key={i}>
              <Skeleton variant="text" width={80} height={16} />
              <Skeleton variant="text" width={120} height={40} />
            </Grid>
          ))}
        </Grid>
      </Card>
    );
  }

  if (error) {
    return (
      <Card sx={{ p: 3, mb: 3 }}>
        <Alert severity="error" action={
          <Button color="inherit" size="small" onClick={handleRefresh}>
            Retry
          </Button>
        }>
          {error}
        </Alert>
      </Card>
    );
  }

  // Show empty state with setup option when no pikadon entries
  if (!summary || summary.total_count === 0) {
    return (
      <Card sx={{ p: 3, mb: 3, border: '2px solid', borderColor: 'warning.light' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <SavingsIcon sx={{ mr: 2, fontSize: 28, color: 'warning.main' }} />
            <Box>
              <Typography variant="h5" fontWeight="bold">
                Term Deposits (Pikadon)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Track your term deposits and interest earned
              </Typography>
            </Box>
          </Box>
        </Box>
        <Box sx={{ textAlign: 'center', py: 3 }}>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            No term deposits found. Detect pikadon transactions from your bank data.
          </Typography>
          <Button
            variant="contained"
            startIcon={<SearchIcon />}
            onClick={openDetectDialog}
            sx={{ textTransform: 'none' }}
          >
            Detect & Setup Pikadon
          </Button>
        </Box>

        {/* Detection Dialog */}
        <Dialog
          open={detectDialogOpen}
          onClose={() => setDetectDialogOpen(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SearchIcon />
              Detect Pikadon Transactions
            </Box>
          </DialogTitle>
          <DialogContent>
            {/* Account Selection */}
            <FormControl fullWidth sx={{ mb: 3, mt: 1 }}>
              <InputLabel>Investment Account</InputLabel>
              <Select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value as number)}
                label="Investment Account"
              >
                {accounts.map((account) => (
                  <MenuItem key={account.id} value={account.id}>
                    {account.account_name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {detecting ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : detectionResult ? (
              <>
                {/* Rollover Suggestions */}
                {detectionResult.rollover_suggestions.length > 0 && (
                  <>
                    <Typography variant="h6" gutterBottom color="primary">
                      Rollover Chains Detected
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      These are deposits that matured and were rolled over into new deposits.
                    </Typography>
                    {detectionResult.rollover_suggestions.map((rollover, idx) => (
                      <Card key={idx} variant="outlined" sx={{ mb: 2, p: 2, bgcolor: 'action.hover' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="subtitle2" fontWeight="bold">
                              {rollover.original_deposit.name}
                            </Typography>
                            <Grid container spacing={2} sx={{ mt: 1 }}>
                              <Grid item xs={4}>
                                <Typography variant="caption" color="text.secondary">
                                  Original Deposit
                                </Typography>
                                <Typography variant="body2">
                                  {formatCurrencyValue(rollover.original_deposit_amount)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {formatDate(rollover.original_deposit.date)}
                                </Typography>
                              </Grid>
                              <Grid item xs={4}>
                                <Typography variant="caption" color="text.secondary">
                                  Return (Principal + Interest)
                                </Typography>
                                <Typography variant="body2">
                                  {formatCurrencyValue(rollover.return_amount)}
                                </Typography>
                                <Typography variant="body2" color="success.main">
                                  +{formatCurrencyValue(rollover.interest_earned)} interest
                                </Typography>
                              </Grid>
                              {rollover.best_rollover && (
                                <Grid item xs={4}>
                                  <Typography variant="caption" color="text.secondary">
                                    New Deposit
                                  </Typography>
                                  <Typography variant="body2">
                                    {formatCurrencyValue(rollover.best_rollover.new_deposit_amount)}
                                  </Typography>
                                  <Typography variant="body2" color="info.main">
                                    {rollover.best_rollover.interest_reinvested > 0
                                      ? `+${formatCurrencyValue(rollover.best_rollover.interest_reinvested)} reinvested`
                                      : `${formatCurrencyValue(rollover.best_rollover.interest_withdrawn)} withdrawn`}
                                  </Typography>
                                </Grid>
                              )}
                            </Grid>
                          </Box>
                          <Button
                            variant="contained"
                            size="small"
                            startIcon={creating ? <CircularProgress size={16} /> : <AddIcon />}
                            onClick={() => handleCreateRollover(rollover)}
                            disabled={creating || !selectedAccount}
                          >
                            Create Chain
                          </Button>
                        </Box>
                      </Card>
                    ))}
                    <Divider sx={{ my: 3 }} />
                  </>
                )}

                {/* Regular Suggestions */}
                {detectionResult.suggestions.length > 0 && (
                  <>
                    <Typography variant="h6" gutterBottom>
                      Detected Pikadon Pairs
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Found {detectionResult.suggestions.length} potential pikadon deposit/return pairs.
                    </Typography>
                    {detectionResult.suggestions.map((suggestion, idx) => (
                      <Card key={idx} variant="outlined" sx={{ mb: 2, p: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="subtitle2" fontWeight="bold">
                              {suggestion.deposit_transaction.name}
                            </Typography>
                            <Grid container spacing={2} sx={{ mt: 1 }}>
                              <Grid item xs={6}>
                                <Typography variant="caption" color="text.secondary">
                                  Deposit
                                </Typography>
                                <Typography variant="body2">
                                  {formatCurrencyValue(suggestion.deposit_amount)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {formatDate(suggestion.deposit_date)}
                                </Typography>
                              </Grid>
                              {suggestion.best_match && (
                                <Grid item xs={6}>
                                  <Typography variant="caption" color="text.secondary">
                                    Return
                                  </Typography>
                                  <Typography variant="body2">
                                    {formatCurrencyValue(suggestion.best_match.return_amount)}
                                  </Typography>
                                  <Typography variant="body2" color="success.main">
                                    +{formatCurrencyValue(suggestion.best_match.interest_earned)} ({suggestion.best_match.interest_rate.toFixed(2)}%)
                                  </Typography>
                                </Grid>
                              )}
                            </Grid>
                          </Box>
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={creating ? <CircularProgress size={16} /> : <AddIcon />}
                            onClick={() => handleCreateFromSuggestion(suggestion)}
                            disabled={creating || !selectedAccount}
                          >
                            Create
                          </Button>
                        </Box>
                      </Card>
                    ))}
                  </>
                )}

                {detectionResult.suggestions.length === 0 &&
                  detectionResult.rollover_suggestions.length === 0 && (
                    <Alert severity="info">
                      No pikadon transactions detected. Make sure you have transactions with pikadon keywords (פיקדון, פקדון, etc.)
                    </Alert>
                  )}
              </>
            ) : (
              <Alert severity="info">
                Click detect to find pikadon transactions
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDetectDialogOpen(false)}>Close</Button>
            <Button
              variant="outlined"
              onClick={handleDetect}
              disabled={detecting}
              startIcon={detecting ? <CircularProgress size={16} /> : <RefreshIcon />}
            >
              Re-detect
            </Button>
          </DialogActions>
        </Dialog>
      </Card>
    );
  }

  return (
    <Card sx={{ p: 3, mb: 3, border: '2px solid', borderColor: 'warning.light' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <SavingsIcon sx={{ mr: 2, fontSize: 28, color: 'warning.main' }} />
          <Box>
            <Typography variant="h5" fontWeight="bold">
              Term Deposits (Pikadon)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {summary.active_count} active • {summary.matured_count} matured
              {summary.rolled_over_count > 0 && ` • ${summary.rolled_over_count} rolled over`}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Detect & Setup Pikadon">
            <IconButton size="small" onClick={openDetectDialog} color="primary">
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={handleRefresh}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={expanded ? 'Collapse' : 'Expand details'}>
            <IconButton size="small" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Summary Stats */}
      <Grid container spacing={3} sx={{ mb: upcomingMaturities.length > 0 ? 3 : 0 }}>
        <Grid item xs={6} md={3}>
          <Typography variant="caption" color="text.secondary">
            ACTIVE PRINCIPAL
          </Typography>
          <Typography variant="h5" fontWeight="bold" color="primary.main">
            {formatCurrencyValue(summary.active_principal)}
          </Typography>
        </Grid>
        <Grid item xs={6} md={3}>
          <Typography variant="caption" color="text.secondary">
            TOTAL INTEREST EARNED
          </Typography>
          <Typography variant="h5" fontWeight="medium" color="success.main">
            +{formatCurrencyValue(summary.total_interest_earned)}
          </Typography>
        </Grid>
        <Grid item xs={6} md={3}>
          <Typography variant="caption" color="text.secondary">
            AVG INTEREST RATE
          </Typography>
          <Typography variant="h5" fontWeight="medium">
            {summary.avg_interest_rate.toFixed(2)}%
          </Typography>
        </Grid>
        <Grid item xs={6} md={3}>
          <Typography variant="caption" color="text.secondary">
            TOTAL PRINCIPAL
          </Typography>
          <Typography variant="h5" fontWeight="medium">
            {formatCurrencyValue(summary.total_principal)}
          </Typography>
        </Grid>
      </Grid>

      {/* Upcoming Maturities Alert */}
      {upcomingMaturities.length > 0 && (
        <Alert
          severity="info"
          icon={<ScheduleIcon />}
          sx={{ mb: expanded ? 3 : 0 }}
        >
          <Typography variant="body2" fontWeight="medium">
            {upcomingMaturities.length} deposit{upcomingMaturities.length > 1 ? 's' : ''} maturing in the next 30 days
          </Typography>
          <Box sx={{ mt: 1 }}>
            {upcomingMaturities.slice(0, 3).map((maturity) => (
              <Typography key={maturity.id} variant="body2" color="text.secondary">
                {formatDate(maturity.maturity_date)} - {formatCurrencyValue(maturity.cost_basis)} ({getDaysUntilMaturity(maturity.maturity_date)} days)
              </Typography>
            ))}
            {upcomingMaturities.length > 3 && (
              <Typography variant="body2" color="text.secondary">
                +{upcomingMaturities.length - 3} more...
              </Typography>
            )}
          </Box>
        </Alert>
      )}

      {/* Expanded Details */}
      <Collapse in={expanded}>
        {listLoading ? (
          <Box sx={{ py: 2 }}>
            <Skeleton variant="rectangular" height={200} />
          </Box>
        ) : (
          <TableContainer sx={{ mt: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Account</TableCell>
                  <TableCell align="right">Principal</TableCell>
                  <TableCell align="right">Interest</TableCell>
                  <TableCell align="right">Rate</TableCell>
                  <TableCell>Deposit Date</TableCell>
                  <TableCell>Maturity</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Linked</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pikadonList.map((pikadon) => (
                  <TableRow
                    key={pikadon.id}
                    hover
                    sx={{
                      // Highlight rolled over items with a subtle background
                      backgroundColor: pikadon.status === 'rolled_over'
                        ? 'action.hover'
                        : 'inherit',
                    }}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {pikadon.parent_pikadon_id && (
                          <Tooltip title="Rolled over from previous pikadon">
                            <AutorenewIcon fontSize="small" color="info" sx={{ fontSize: 16 }} />
                          </Tooltip>
                        )}
                        <Typography variant="body2" fontWeight="medium">
                          {pikadon.account_name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2">
                        {formatCurrencyValue(pikadon.cost_basis)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        color={pikadon.interest_earned > 0 ? 'success.main' : 'text.secondary'}
                      >
                        {pikadon.interest_earned > 0 ? '+' : ''}
                        {formatCurrencyValue(pikadon.interest_earned)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2">
                        {pikadon.interest_rate ? `${pikadon.interest_rate.toFixed(2)}%` : '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {formatDate(pikadon.as_of_date)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {formatDate(pikadon.maturity_date)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Chip
                          label={getStatusLabel(pikadon.status)}
                          color={getStatusColor(pikadon.status) as any}
                          size="small"
                        />
                        {pikadon.status === 'rolled_over' && (
                          <Tooltip title="View rollover chain">
                            <AccountTreeIcon fontSize="small" color="action" sx={{ fontSize: 14 }} />
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                        {pikadon.deposit_transaction_id && (
                          <Tooltip title="Deposit linked">
                            <LinkIcon fontSize="small" color="success" />
                          </Tooltip>
                        )}
                        {pikadon.return_transaction_id && (
                          <Tooltip title="Return linked">
                            <TrendingUpIcon fontSize="small" color="success" />
                          </Tooltip>
                        )}
                        {!pikadon.deposit_transaction_id && !pikadon.return_transaction_id && (
                          <Typography variant="body2" color="text.disabled">
                            -
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
                {pikadonList.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        No pikadon deposits found
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Collapse>

      {/* Detection Dialog */}
      <Dialog
        open={detectDialogOpen}
        onClose={() => setDetectDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SearchIcon />
            Detect Pikadon Transactions
          </Box>
        </DialogTitle>
        <DialogContent>
          {/* Account Selection */}
          <FormControl fullWidth sx={{ mb: 3, mt: 1 }}>
            <InputLabel>Investment Account</InputLabel>
            <Select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value as number)}
              label="Investment Account"
            >
              {accounts.map((account) => (
                <MenuItem key={account.id} value={account.id}>
                  {account.account_name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {detecting ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : detectionResult ? (
            <>
              {/* Rollover Suggestions - Most Important */}
              {detectionResult.rollover_suggestions.length > 0 && (
                <>
                  <Typography variant="h6" gutterBottom color="primary">
                    Rollover Chains Detected
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    These are deposits that matured and were rolled over into new deposits.
                  </Typography>
                  {detectionResult.rollover_suggestions.map((rollover, idx) => (
                    <Card key={idx} variant="outlined" sx={{ mb: 2, p: 2, bgcolor: 'action.hover' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="subtitle2" fontWeight="bold">
                            {rollover.original_deposit.name}
                          </Typography>
                          <Grid container spacing={2} sx={{ mt: 1 }}>
                            <Grid item xs={4}>
                              <Typography variant="caption" color="text.secondary">
                                Original Deposit
                              </Typography>
                              <Typography variant="body2">
                                {formatCurrencyValue(rollover.original_deposit_amount)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {formatDate(rollover.original_deposit.date)}
                              </Typography>
                            </Grid>
                            <Grid item xs={4}>
                              <Typography variant="caption" color="text.secondary">
                                Return (Principal + Interest)
                              </Typography>
                              <Typography variant="body2">
                                {formatCurrencyValue(rollover.return_amount)}
                              </Typography>
                              <Typography variant="body2" color="success.main">
                                +{formatCurrencyValue(rollover.interest_earned)} interest
                              </Typography>
                            </Grid>
                            {rollover.best_rollover && (
                              <Grid item xs={4}>
                                <Typography variant="caption" color="text.secondary">
                                  New Deposit
                                </Typography>
                                <Typography variant="body2">
                                  {formatCurrencyValue(rollover.best_rollover.new_deposit_amount)}
                                </Typography>
                                <Typography variant="body2" color="info.main">
                                  {rollover.best_rollover.interest_reinvested > 0
                                    ? `+${formatCurrencyValue(rollover.best_rollover.interest_reinvested)} reinvested`
                                    : `${formatCurrencyValue(rollover.best_rollover.interest_withdrawn)} withdrawn`}
                                </Typography>
                              </Grid>
                            )}
                          </Grid>
                        </Box>
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={creating ? <CircularProgress size={16} /> : <AddIcon />}
                          onClick={() => handleCreateRollover(rollover)}
                          disabled={creating || !selectedAccount}
                        >
                          Create Chain
                        </Button>
                      </Box>
                    </Card>
                  ))}
                  <Divider sx={{ my: 3 }} />
                </>
              )}

              {/* Regular Suggestions */}
              {detectionResult.suggestions.length > 0 && (
                <>
                  <Typography variant="h6" gutterBottom>
                    Detected Pikadon Pairs
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Found {detectionResult.suggestions.length} potential pikadon deposit/return pairs.
                  </Typography>
                  {detectionResult.suggestions.map((suggestion, idx) => (
                    <Card key={idx} variant="outlined" sx={{ mb: 2, p: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="subtitle2" fontWeight="bold">
                            {suggestion.deposit_transaction.name}
                          </Typography>
                          <Grid container spacing={2} sx={{ mt: 1 }}>
                            <Grid item xs={6}>
                              <Typography variant="caption" color="text.secondary">
                                Deposit
                              </Typography>
                              <Typography variant="body2">
                                {formatCurrencyValue(suggestion.deposit_amount)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {formatDate(suggestion.deposit_date)}
                              </Typography>
                            </Grid>
                            {suggestion.best_match && (
                              <Grid item xs={6}>
                                <Typography variant="caption" color="text.secondary">
                                  Return
                                </Typography>
                                <Typography variant="body2">
                                  {formatCurrencyValue(suggestion.best_match.return_amount)}
                                </Typography>
                                <Typography variant="body2" color="success.main">
                                  +{formatCurrencyValue(suggestion.best_match.interest_earned)} ({suggestion.best_match.interest_rate.toFixed(2)}%)
                                </Typography>
                              </Grid>
                            )}
                          </Grid>
                        </Box>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={creating ? <CircularProgress size={16} /> : <AddIcon />}
                          onClick={() => handleCreateFromSuggestion(suggestion)}
                          disabled={creating || !selectedAccount}
                        >
                          Create
                        </Button>
                      </Box>
                    </Card>
                  ))}
                </>
              )}

              {detectionResult.suggestions.length === 0 &&
                detectionResult.rollover_suggestions.length === 0 && (
                  <Alert severity="info">
                    No pikadon transactions detected. Make sure you have transactions with pikadon keywords (פיקדון, פקדון, etc.)
                  </Alert>
                )}
            </>
          ) : (
            <Alert severity="info">
              Click detect to find pikadon transactions
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetectDialogOpen(false)}>Close</Button>
          <Button
            variant="outlined"
            onClick={handleDetect}
            disabled={detecting}
            startIcon={detecting ? <CircularProgress size={16} /> : <RefreshIcon />}
          >
            Re-detect
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
};

export default PikadonSection;
