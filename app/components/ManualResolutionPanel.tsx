import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  Paper,
  Alert,
  CircularProgress,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  Tooltip,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  InputAdornment,
} from '@mui/material';
import {
  Search as SearchIcon,
  Info as InfoIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';

interface BankTransaction {
  identifier: string;
  vendor: string;
  date: string;
  name: string;
  price: number;
  category: string;
  account_number?: string;
  is_excluded: boolean;
  exclusion_reason?: string;
  override_category?: string;
  exclusion_notes?: string;
  exclusion_type?: 'manual' | 'duplicate';
}

interface ManualResolutionPanelProps {
  onTransactionsChanged: () => void;
}

const EXCLUSION_REASONS = [
  { value: 'duplicate', label: 'Duplicate', color: 'warning' },
  { value: 'investment', label: 'Investment', color: 'info' },
  { value: 'transfer', label: 'Transfer', color: 'primary' },
  { value: 'rent', label: 'Rent Payment', color: 'secondary' },
  { value: 'loan', label: 'Loan Payment', color: 'default' },
  { value: 'savings', label: 'Savings', color: 'success' },
  { value: 'other', label: 'Other', color: 'default' },
];

const CATEGORY_OVERRIDES = [
  'Investment',
  'Transfer',
  'Rent',
  'Loan',
  'Savings',
  'Insurance',
  'Tax Payment',
  'Other',
];

const ManualResolutionPanel: React.FC<ManualResolutionPanelProps> = ({ onTransactionsChanged }) => {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedTransactions, setSelectedTransactions] = useState<Set<string>>(new Set());
  const [showExcluded, setShowExcluded] = useState<'all' | 'active' | 'excluded'>('active');
  const [processingTxn, setProcessingTxn] = useState<string | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('duplicate');
  const [bulkCategory, setBulkCategory] = useState('');
  const { formatCurrency } = useFinancePrivacy();

  useEffect(() => {
    fetchTransactions();
  }, [search, showExcluded]);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search,
        includeExcluded: showExcluded === 'excluded' ? 'true' : showExcluded === 'all' ? 'true' : 'false',
        limit: '500',
      });

      const response = await fetch(`/api/transactions/bank?${params}`);
      const data = await response.json();

      let filtered = data.transactions || [];

      // Additional filtering based on showExcluded
      if (showExcluded === 'excluded') {
        filtered = filtered.filter((t: BankTransaction) => t.is_excluded);
      } else if (showExcluded === 'active') {
        filtered = filtered.filter((t: BankTransaction) => !t.is_excluded);
      }

      setTransactions(filtered);
    } catch (error) {
      console.error('Error fetching bank transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTxnKey = (txn: BankTransaction) => `${txn.identifier}-${txn.vendor}`;

  const handleToggleExclusion = async (txn: BankTransaction) => {
    const key = getTxnKey(txn);
    setProcessingTxn(key);

    try {
      if (txn.is_excluded && txn.exclusion_type === 'manual') {
        // Include the transaction
        const response = await fetch('/api/duplicates/manual-include', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionIdentifier: txn.identifier,
            transactionVendor: txn.vendor,
          }),
        });

        if (response.ok) {
          await fetchTransactions();
          onTransactionsChanged();
        } else {
          const error = await response.json();
          alert(`Failed to include: ${error.error}`);
        }
      } else if (!txn.is_excluded) {
        // Exclude the transaction
        const response = await fetch('/api/duplicates/manual-exclude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionIdentifier: txn.identifier,
            transactionVendor: txn.vendor,
            reason: 'duplicate',
          }),
        });

        if (response.ok) {
          await fetchTransactions();
          onTransactionsChanged();
        } else {
          const error = await response.json();
          alert(`Failed to exclude: ${error.error}`);
        }
      } else if (txn.exclusion_type === 'duplicate') {
        alert('This transaction is excluded as part of a duplicate pair. Use the Confirmed tab to manage it.');
      }
    } catch (error) {
      console.error('Error toggling exclusion:', error);
      alert('Error updating transaction');
    } finally {
      setProcessingTxn(null);
    }
  };

  const handleCategoryChange = async (txn: BankTransaction, newCategory: string) => {
    const key = getTxnKey(txn);
    setProcessingTxn(key);

    try {
      const response = await fetch('/api/duplicates/manual-exclude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionIdentifier: txn.identifier,
          transactionVendor: txn.vendor,
          reason: txn.exclusion_reason || 'duplicate',
          overrideCategory: newCategory || null,
        }),
      });

      if (response.ok) {
        await fetchTransactions();
        onTransactionsChanged();
      } else {
        const error = await response.json();
        alert(`Failed to update category: ${error.error}`);
      }
    } catch (error) {
      console.error('Error updating category:', error);
      alert('Error updating category');
    } finally {
      setProcessingTxn(null);
    }
  };

  const handleSelectTransaction = (txn: BankTransaction) => {
    const key = getTxnKey(txn);
    const newSelected = new Set(selectedTransactions);

    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }

    setSelectedTransactions(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedTransactions.size === transactions.length) {
      setSelectedTransactions(new Set());
    } else {
      setSelectedTransactions(new Set(transactions.map(getTxnKey)));
    }
  };

  const handleBulkExclude = async () => {
    if (selectedTransactions.size === 0) return;

    const txnsToExclude = transactions.filter(t =>
      selectedTransactions.has(getTxnKey(t)) && !t.is_excluded
    );

    try {
      for (const txn of txnsToExclude) {
        await fetch('/api/duplicates/manual-exclude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionIdentifier: txn.identifier,
            transactionVendor: txn.vendor,
            reason: bulkReason,
            overrideCategory: bulkCategory || null,
          }),
        });
      }

      await fetchTransactions();
      onTransactionsChanged();
      setSelectedTransactions(new Set());
      setBulkDialogOpen(false);
    } catch (error) {
      console.error('Error bulk excluding:', error);
      alert('Error excluding transactions');
    }
  };

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getExclusionChip = (txn: BankTransaction) => {
    if (!txn.is_excluded) return null;

    const reason = EXCLUSION_REASONS.find(r => r.value === txn.exclusion_reason) || EXCLUSION_REASONS[0];

    return (
      <Chip
        size="small"
        label={reason.label}
        color={reason.color as any}
        icon={txn.exclusion_type === 'duplicate' ? <InfoIcon /> : undefined}
      />
    );
  };

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2">
          Manually mark bank transactions as excluded to prevent double-counting.
          Excluded transactions will not appear in your expense/income totals.
          You can also reassign their category for organizational purposes.
        </Typography>
      </Alert>

      {/* Filters */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          placeholder="Search transactions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          sx={{ flexGrow: 1 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />

        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Show</InputLabel>
          <Select
            value={showExcluded}
            onChange={(e) => setShowExcluded(e.target.value as any)}
            label="Show"
          >
            <MenuItem value="all">All Transactions</MenuItem>
            <MenuItem value="active">Active Only</MenuItem>
            <MenuItem value="excluded">Excluded Only</MenuItem>
          </Select>
        </FormControl>

        <Tooltip title="Refresh">
          <IconButton onClick={fetchTransactions} size="small">
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Bulk Actions */}
      {selectedTransactions.size > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2">
              {selectedTransactions.size} transaction(s) selected
            </Typography>
            <Button
              size="small"
              variant="contained"
              onClick={() => setBulkDialogOpen(true)}
              startIcon={<CheckCircleIcon />}
            >
              Exclude Selected
            </Button>
          </Box>
        </Alert>
      )}

      {/* Transaction Table */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : transactions.length === 0 ? (
        <Alert severity="info">
          No bank transactions found. Try adjusting your filters.
        </Alert>
      ) : (
        <TableContainer component={Paper} sx={{ maxHeight: 500 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={selectedTransactions.size > 0 && selectedTransactions.size < transactions.length}
                    checked={transactions.length > 0 && selectedTransactions.size === transactions.length}
                    onChange={handleSelectAll}
                  />
                </TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Transaction Name</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Override Category</TableCell>
                <TableCell align="center">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transactions.map((txn) => {
                const key = getTxnKey(txn);
                const isProcessing = processingTxn === key;
                const isSelected = selectedTransactions.has(key);

                return (
                  <TableRow
                    key={key}
                    selected={isSelected}
                    sx={{
                      backgroundColor: txn.is_excluded ? 'action.hover' : 'inherit',
                      opacity: txn.is_excluded ? 0.7 : 1,
                    }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={isSelected}
                        onChange={() => handleSelectTransaction(txn)}
                        disabled={isProcessing}
                      />
                    </TableCell>
                    <TableCell>{formatDate(txn.date)}</TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
                        {txn.name}
                      </Typography>
                      {txn.account_number && (
                        <Typography variant="caption" color="text.secondary">
                          ****{txn.account_number}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight="medium">
                        {formatCurrencyValue(txn.price)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {getExclusionChip(txn)}
                    </TableCell>
                    <TableCell>
                      {txn.is_excluded && txn.exclusion_type === 'manual' ? (
                        <FormControl size="small" fullWidth disabled={isProcessing}>
                          <Select
                            value={txn.override_category || ''}
                            onChange={(e) => handleCategoryChange(txn, e.target.value)}
                            displayEmpty
                          >
                            <MenuItem value="">
                              <em>Original ({txn.category})</em>
                            </MenuItem>
                            {CATEGORY_OVERRIDES.map(cat => (
                              <MenuItem key={cat} value={cat}>{cat}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {txn.category}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {isProcessing ? (
                        <CircularProgress size={20} />
                      ) : txn.exclusion_type === 'duplicate' ? (
                        <Tooltip title="Managed in Confirmed tab">
                          <IconButton size="small" disabled>
                            <InfoIcon />
                          </IconButton>
                        </Tooltip>
                      ) : (
                        <Tooltip title={txn.is_excluded ? 'Include in totals' : 'Exclude from totals'}>
                          <IconButton
                            size="small"
                            color={txn.is_excluded ? 'success' : 'error'}
                            onClick={() => handleToggleExclusion(txn)}
                          >
                            {txn.is_excluded ? <CheckCircleIcon /> : <CancelIcon />}
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Bulk Exclude Dialog */}
      <Dialog open={bulkDialogOpen} onClose={() => setBulkDialogOpen(false)}>
        <DialogTitle>Exclude Selected Transactions</DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            Exclude {selectedTransactions.size} selected transaction(s) from totals:
          </Typography>

          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>Reason</InputLabel>
            <Select
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              label="Reason"
            >
              {EXCLUSION_REASONS.map(reason => (
                <MenuItem key={reason.value} value={reason.value}>
                  {reason.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>Override Category (Optional)</InputLabel>
            <Select
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
              label="Override Category (Optional)"
            >
              <MenuItem value="">
                <em>Keep Original</em>
              </MenuItem>
              {CATEGORY_OVERRIDES.map(cat => (
                <MenuItem key={cat} value={cat}>{cat}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleBulkExclude} variant="contained" color="primary">
            Exclude {selectedTransactions.size} Transaction(s)
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ManualResolutionPanel;
