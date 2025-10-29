import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Box,
  Stepper,
  Step,
  StepLabel,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  Paper,
  Chip,
  Alert,
  AlertTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  CircularProgress,
  Divider
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useNotification } from './NotificationContext';
import ModalHeader from './ModalHeader';

interface Account {
  id: number;
  vendor: string;
  nickname?: string;
  card6_digits?: string;
  bank_account_number?: string;
  account_numbers?: string[]; // Actual account numbers from transactions
  account_number?: string; // Single account number when expanded
}

interface Pairing {
  id: number;
  creditCardVendor: string;
  creditCardAccountNumber: string | null;
  bankVendor: string;
  bankAccountNumber: string | null;
  matchPatterns: string[];
  isActive: boolean;
  createdAt: string;
}

interface CandidateTransaction {
  identifier: string;
  vendor: string;
  date: string;
  name: string;
  price: number;
  categoryId: number | null;
  categoryName: string | null;
  accountNumber: string | null;
  matchReason: string;
}

interface AccountPairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  creditCardAccounts: Account[];
  bankAccounts: Account[];
}

const steps = ['Select Accounts', 'Review Transactions', 'Confirm'];

export default function AccountPairingModal({
  isOpen,
  onClose,
  creditCardAccounts,
  bankAccounts
}: AccountPairingModalProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [selectedCreditCard, setSelectedCreditCard] = useState<Account | null>(null);
  const [selectedBank, setSelectedBank] = useState<Account | null>(null);
  const [candidates, setCandidates] = useState<CandidateTransaction[]>([]);
  const [selectedTransactions, setSelectedTransactions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [existingPairings, setExistingPairings] = useState<Pairing[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Account[]>([]);
  const { showNotification } = useNotification();

  useEffect(() => {
    if (isOpen) {
      fetchExistingPairings();
      expandAccountsByNumbers();
    }
  }, [isOpen, creditCardAccounts, bankAccounts]);

  const expandAccountsByNumbers = () => {
    // Expand accounts based on unique vendor+account_number combinations
    const expanded: Account[] = [];
    const seenCombinations = new Set<string>();

    [...creditCardAccounts, ...bankAccounts].forEach((account) => {
      // Get account numbers from appropriate field
      const accountNumbersStr = account.card6_digits || account.bank_account_number || '';

      if (accountNumbersStr) {
        // Split by semicolon and create separate entry for each unique combination
        const accountNumbers = accountNumbersStr.split(';').filter(Boolean);

        accountNumbers.forEach((accNum) => {
          const trimmedAccNum = accNum.trim();
          const combination = `${account.vendor}-${trimmedAccNum}`;

          // Only add if we haven't seen this vendor+account_number combination
          if (!seenCombinations.has(combination)) {
            seenCombinations.add(combination);
            expanded.push({
              ...account,
              account_number: trimmedAccNum
            });
          }
        });
      } else {
        // No account numbers yet - still add it
        const combination = `${account.vendor}-undefined`;
        if (!seenCombinations.has(combination)) {
          seenCombinations.add(combination);
          expanded.push({
            ...account,
            account_number: undefined
          });
        }
      }
    });

    setExpandedAccounts(expanded);
  };

  const fetchExistingPairings = async () => {
    try {
      const response = await fetch('/api/accounts/pairing');
      if (response.ok) {
        const data = await response.json();
        setExistingPairings(data.pairings);
      }
    } catch (error) {
      console.error('Error fetching pairings:', error);
    }
  };

  const handleNext = async () => {
    if (activeStep === 0) {
      // Validate selection
      if (!selectedCreditCard || !selectedBank) {
        showNotification('Please select both credit card and bank account', 'error');
        return;
      }

      // Fetch candidates
      setLoading(true);
      try {
        // Use the selected account number
        const creditCardNumber = selectedCreditCard.account_number || selectedCreditCard.card6_digits || '0000';
        const bankAccountNumber = selectedBank.account_number || selectedBank.bank_account_number || '';
        const response = await fetch(
          `/api/accounts/find-settlement-candidates?credit_card_account_number=${creditCardNumber}&bank_vendor=${selectedBank.vendor}&bank_account_number=${bankAccountNumber}`
        );

        if (response.ok) {
          const data = await response.json();
          setCandidates(data.candidates);
          setStats(data.stats);
          // Start with no transactions selected
          setSelectedTransactions(new Set());
        } else {
          showNotification('Failed to find candidate transactions', 'error');
          return;
        }
      } catch (error) {
        console.error('Error fetching candidates:', error);
        showNotification('Error finding candidates', 'error');
        return;
      } finally {
        setLoading(false);
      }
    }

    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/accounts/pairing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creditCardVendor: selectedCreditCard!.vendor,
          creditCardAccountNumber: selectedCreditCard!.account_number || selectedCreditCard!.card6_digits || null,
          bankVendor: selectedBank!.vendor,
          bankAccountNumber: selectedBank!.account_number || selectedBank!.bank_account_number || null,
          matchPatterns: [],
          selectedTransactionIds: Array.from(selectedTransactions)
        })
      });

      if (response.ok) {
        const data = await response.json();
        showNotification(
          `Pairing created! ${data.categorizedCount} transactions categorized.`,
          'success'
        );
        handleClose();
        // Trigger data refresh
        window.dispatchEvent(new CustomEvent('dataRefresh'));
      } else {
        const error = await response.json();
        showNotification(error.error || 'Failed to create pairing', 'error');
      }
    } catch (error) {
      console.error('Error creating pairing:', error);
      showNotification('Error creating pairing', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePairing = async (pairingId: number) => {
    try {
      const response = await fetch(`/api/accounts/pairing?id=${pairingId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        showNotification('Pairing deleted successfully', 'success');
        fetchExistingPairings();
      } else {
        showNotification('Failed to delete pairing', 'error');
      }
    } catch (error) {
      console.error('Error deleting pairing:', error);
      showNotification('Error deleting pairing', 'error');
    }
  };

  const handleClose = () => {
    setActiveStep(0);
    setSelectedCreditCard(null);
    setSelectedBank(null);
    setCandidates([]);
    setSelectedTransactions(new Set());
    setStats(null);
    onClose();
  };

  const toggleTransaction = (identifier: string) => {
    // Find the transaction to get its name
    const transaction = candidates.find(c => c.identifier === identifier);
    if (!transaction) return;

    setSelectedTransactions(prev => {
      const next = new Set(prev);
      const isCurrentlySelected = next.has(identifier);

      if (isCurrentlySelected) {
        // Deselect: remove only this transaction
        next.delete(identifier);
      } else {
        // Select: add all transactions with the same name
        candidates.forEach(c => {
          if (c.name === transaction.name) {
            next.add(c.identifier);
          }
        });
      }

      return next;
    });
  };

  const toggleAll = () => {
    if (selectedTransactions.size === candidates.length) {
      setSelectedTransactions(new Set());
    } else {
      setSelectedTransactions(new Set(candidates.map(c => c.identifier)));
    }
  };

  const getMatchReasonLabel = (reason: string) => {
    switch (reason) {
      case 'account_number_match':
        return 'Account #';
      case 'category_match':
        return 'Category';
      case 'keyword_match':
        return 'Keyword';
      default:
        return 'Other';
    }
  };

  const getMatchReasonColor = (reason: string): 'success' | 'info' | 'warning' => {
    switch (reason) {
      case 'account_number_match':
        return 'success';
      case 'category_match':
        return 'info';
      case 'keyword_match':
        return 'warning';
      default:
        return 'warning';
    }
  };

  return (
    <Dialog open={isOpen} onClose={handleClose} maxWidth="lg" fullWidth>
      <ModalHeader
        title="Account Pairing"
        onClose={handleClose}
      />

      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Stepper activeStep={activeStep}>
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>

        {/* Existing Pairings Section */}
        {activeStep === 0 && existingPairings.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Existing Pairings
            </Typography>
            <List>
              {existingPairings.map((pairing) => (
                <ListItem
                  key={pairing.id}
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    mb: 1,
                    bgcolor: pairing.isActive ? 'background.paper' : 'action.disabledBackground'
                  }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LinkIcon fontSize="small" />
                        <Typography variant="body1">
                          {pairing.creditCardVendor} → {pairing.bankVendor}
                        </Typography>
                        {pairing.isActive && (
                          <Chip label="Active" size="small" color="success" />
                        )}
                      </Box>
                    }
                    secondary={
                      <Typography variant="body2" color="text.secondary">
                        Credit Card: {pairing.creditCardAccountNumber || 'Any'} |
                        Bank: {pairing.bankAccountNumber || 'Any'} |
                        Created: {new Date(pairing.createdAt).toLocaleDateString()}
                      </Typography>
                    }
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      onClick={() => handleDeletePairing(pairing.id)}
                      color="error"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
            <Divider sx={{ my: 3 }} />
          </Box>
        )}

        {/* Step 1: Select Accounts */}
        {activeStep === 0 && (
          <Box>
            <Alert severity="info" sx={{ mb: 3 }}>
              <AlertTitle>Account Pairing</AlertTitle>
              Link your credit card to your bank account to automatically categorize
              credit card settlement transactions. This helps avoid double-counting expenses.
            </Alert>

            <TextField
              fullWidth
              select
              label="Select Credit Card Account"
              value={selectedCreditCard ? `${selectedCreditCard.id}-${selectedCreditCard.account_number}` : ''}
              onChange={(e) => {
                const [idStr, accNum] = e.target.value.split('-');
                const id = Number(idStr);
                const expandedAccount = expandedAccounts.find(
                  a => a.id === id && a.account_number === (accNum === 'undefined' ? undefined : accNum)
                );
                if (expandedAccount) {
                  setSelectedCreditCard(expandedAccount);
                }
              }}
              sx={{ mb: 2 }}
            >
              {expandedAccounts
                .filter(acc => creditCardAccounts.some(c => c.id === acc.id))
                .map((account, idx) => {
                  const accountNumberDisplay = account.account_number || 'No transactions yet';
                  const key = `${account.id}-${account.account_number || idx}`;

                  return (
                    <MenuItem key={key} value={`${account.id}-${account.account_number || 'undefined'}`}>
                      {account.vendor} ({accountNumberDisplay})
                      {account.nickname && ` - ${account.nickname}`}
                    </MenuItem>
                  );
                })}
            </TextField>

            <TextField
              fullWidth
              select
              label="Select Bank Account"
              value={selectedBank ? `${selectedBank.id}-${selectedBank.account_number}` : ''}
              onChange={(e) => {
                const [idStr, accNum] = e.target.value.split('-');
                const id = Number(idStr);
                const expandedAccount = expandedAccounts.find(
                  a => a.id === id && a.account_number === (accNum === 'undefined' ? undefined : accNum)
                );
                if (expandedAccount) {
                  setSelectedBank(expandedAccount);
                }
              }}
            >
              {expandedAccounts
                .filter(acc => bankAccounts.some(b => b.id === acc.id))
                .map((account, idx) => {
                  const accountNumberDisplay = account.account_number || 'No transactions yet';
                  const key = `${account.id}-${account.account_number || idx}`;

                  return (
                    <MenuItem key={key} value={`${account.id}-${account.account_number || 'undefined'}`}>
                      {account.vendor} ({accountNumberDisplay})
                      {account.nickname && ` - ${account.nickname}`}
                    </MenuItem>
                  );
                })}
            </TextField>
          </Box>
        )}

        {/* Step 2: Review Transactions */}
        {activeStep === 1 && (
          <Box>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                <Alert severity="info" sx={{ mb: 2 }}>
                  <AlertTitle>Selected Accounts</AlertTitle>
                  <Typography variant="body2">
                    <strong>Credit Card:</strong> {selectedCreditCard?.vendor} ({selectedCreditCard?.account_number || 'N/A'})
                    {selectedCreditCard?.nickname && ` - ${selectedCreditCard.nickname}`}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Bank Account:</strong> {selectedBank?.vendor} ({selectedBank?.account_number || 'N/A'})
                    {selectedBank?.nickname && ` - ${selectedBank.nickname}`}
                  </Typography>
                </Alert>

                {stats && (
                  <Alert severity="success" sx={{ mb: 2 }}>
                    Found {stats.total} candidate transactions
                    ({stats.totalNegative} payments, {stats.totalPositive} refunds)
                  </Alert>
                )}

                <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2">
                    {selectedTransactions.size} of {candidates.length} selected
                  </Typography>
                  <Button onClick={toggleAll} size="small">
                    {selectedTransactions.size === candidates.length ? 'Deselect All' : 'Select All'}
                  </Button>
                </Box>

                <TableContainer component={Paper} sx={{ maxHeight: 400 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={selectedTransactions.size === candidates.length && candidates.length > 0}
                            indeterminate={selectedTransactions.size > 0 && selectedTransactions.size < candidates.length}
                            onChange={toggleAll}
                          />
                        </TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell>Transaction Name</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell>Match Reason</TableCell>
                        <TableCell>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {candidates.map((txn) => {
                        const isSelected = selectedTransactions.has(txn.identifier);
                        return (
                          <TableRow
                            key={txn.identifier}
                            hover
                            sx={{
                              bgcolor: isSelected ? 'action.selected' : 'inherit',
                              '&:hover': {
                                bgcolor: isSelected ? 'action.selected' : 'action.hover',
                              }
                            }}
                          >
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={isSelected}
                                onChange={() => toggleTransaction(txn.identifier)}
                              />
                            </TableCell>
                            <TableCell>{new Date(txn.date).toLocaleDateString()}</TableCell>
                            <TableCell sx={{ fontWeight: isSelected ? 600 : 400 }}>
                              {txn.name}
                            </TableCell>
                            <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                              ₪{Math.abs(txn.price).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={getMatchReasonLabel(txn.matchReason)}
                                size="small"
                                color={getMatchReasonColor(txn.matchReason)}
                              />
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={txn.price < 0 ? '→ Credit Card Repayment' : '→ Refund'}
                                size="small"
                                variant="outlined"
                                color={txn.price < 0 ? 'primary' : 'success'}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </Box>
        )}

        {/* Step 3: Confirm */}
        {activeStep === 2 && (
          <Box>
            <Alert severity="success" sx={{ mb: 3 }}>
              <AlertTitle>Ready to Create Pairing</AlertTitle>
              <Typography variant="body2">
                <strong>Credit Card:</strong> {selectedCreditCard?.vendor} ({selectedCreditCard?.account_number || 'N/A'})
                {selectedCreditCard?.nickname && ` - ${selectedCreditCard.nickname}`}
              </Typography>
              <Typography variant="body2">
                <strong>Bank Account:</strong> {selectedBank?.vendor} ({selectedBank?.account_number || 'N/A'})
                {selectedBank?.nickname && ` - ${selectedBank.nickname}`}
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                {selectedTransactions.size} transactions will be categorized immediately.
              </Typography>
              <Typography variant="body2">
                Future bank transactions matching these patterns will be automatically categorized.
              </Typography>
            </Alert>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
              <CheckCircleIcon color="success" />
              <Typography variant="body1">
                This pairing will be active and applied automatically after each scrape.
              </Typography>
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        {activeStep > 0 && (
          <Button onClick={handleBack} disabled={loading}>
            Back
          </Button>
        )}
        {activeStep < steps.length - 1 ? (
          <Button
            onClick={handleNext}
            variant="contained"
            disabled={loading || (activeStep === 0 && (!selectedCreditCard || !selectedBank))}
          >
            Next
          </Button>
        ) : (
          <Button
            onClick={handleConfirm}
            variant="contained"
            color="primary"
            disabled={loading || selectedTransactions.size === 0}
            startIcon={loading ? <CircularProgress size={20} /> : <LinkIcon />}
          >
            Create Pairing
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
