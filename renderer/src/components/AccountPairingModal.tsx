import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
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
  CircularProgress,
  Divider
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import { useNotification } from './NotificationContext';
import ModalHeader from './ModalHeader';
import UnpairedTransactionsDialog from './UnpairedTransactionsDialog';
import { apiClient } from '@/lib/api-client';

interface Account {
  id: number;
  vendor: string;
  nickname?: string;
  card6_digits?: string; // Deprecated - kept for backward compatibility
  bank_account_number?: string; // Deprecated - kept for backward compatibility
  accountNumbers?: string[]; // Actual account numbers from transactions
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
  creditCardInstitution?: {
    id: number;
    vendor_code: string;
    display_name_he: string;
    display_name_en: string;
    logo_url?: string;
    institution_type: string;
  };
  bankInstitution?: {
    id: number;
    vendor_code: string;
    display_name_he: string;
    display_name_en: string;
    logo_url?: string;
    institution_type: string;
  };
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
  creditCardAccounts?: Account[];
  bankAccounts?: Account[];
}

interface PairingStats {
  total: number;
  totalPositive: number;
  totalNegative: number;
  byMatchReason: Record<string, number>;
}

interface SettlementCandidatesResponse {
  candidates: CandidateTransaction[];
  stats: PairingStats;
}

interface PairingsResponse {
  pairings: Pairing[];
}

interface UnpairedTransactionsCountResponse {
  count: number;
}

interface SmartMatchResult {
  identifier: string;
  vendor: string;
  vendorNickname: string | null;
  date: string;
  name: string;
  price: number;
  categoryId: number | null;
  categoryName: string | null;
  accountNumber: string | null;
  confidence: number;
  matchedPatterns: string[];
}

interface SmartMatchResponse {
  matches: SmartMatchResult[];
}

type ApiErrorPayload = {
  error?: string;
} | null | undefined;

function extractApiError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const message = (data as ApiErrorPayload)?.error;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
}

const steps = ['Select Accounts', 'Review Transactions', 'Confirm'];

export default function AccountPairingModal({
  isOpen,
  onClose,
  creditCardAccounts = [],
  bankAccounts = [],
}: AccountPairingModalProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [selectedCreditCard, setSelectedCreditCard] = useState<Account | null>(null);
  const [selectedBank, setSelectedBank] = useState<Account | null>(null);
  const [candidates, setCandidates] = useState<CandidateTransaction[]>([]);
  const [selectedTransactions, setSelectedTransactions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [existingPairings, setExistingPairings] = useState<Pairing[]>([]);
  const [stats, setStats] = useState<PairingStats | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Account[]>([]);
  const [unpairableTransactionsCount, setUnpairableTransactionsCount] = useState<number>(0);
  const [editingPairing, setEditingPairing] = useState<Pairing | null>(null);
  const [editCreditCard, setEditCreditCard] = useState<Account | null>(null);
  const [editBank, setEditBank] = useState<Account | null>(null);
  const [editCandidates, setEditCandidates] = useState<CandidateTransaction[]>([]);
  const [editSelectedTransactions, setEditSelectedTransactions] = useState<Set<string>>(new Set());
  const [showEditReview, setShowEditReview] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [showUnpairedDialog, setShowUnpairedDialog] = useState(false);
  const [matchPatterns, setMatchPatterns] = useState<string[]>([]);
  const [editMatchPatterns, setEditMatchPatterns] = useState<string[]>([]);
  const [newPatternInput, setNewPatternInput] = useState('');
  const [editNewPatternInput, setEditNewPatternInput] = useState('');
  const [smartSelectLoading, setSmartSelectLoading] = useState(false);
  const { showNotification } = useNotification();

  // Helper function to get display name for an account
  const getAccountDisplayName = useCallback((account: Account, includeVendor: boolean = true): string => {
    const parts: string[] = [];

    // Part 1: Vendor (if requested)
    if (includeVendor) {
      parts.push(account.vendor);
    }

    // Part 2: Nickname (always show if available)
    if (account.nickname) {
      parts.push(account.nickname);
    }

    // Part 3: Account number with masking, or "Not yet scraped"
    if (account.account_number) {
      const masked = account.account_number.length > 4
        ? `****${account.account_number.slice(-4)}`
        : account.account_number;
      parts.push(masked);
    } else {
      parts.push('Not yet scraped');
    }

    return parts.join(' - ');
  }, []);

  const expandAccountsByNumbers = useCallback(() => {
    // Expand accounts based on unique credential ID + account_number combinations
    const expanded: Account[] = [];
    const seenCombinations = new Set<string>();

    [...creditCardAccounts, ...bankAccounts].forEach((account) => {
      // Get account numbers from the new accountNumbers field (from transactions)
      const accountNumbersArray = account.accountNumbers || [];

      if (accountNumbersArray.length > 0) {
        // Create separate entry for each unique account number
        accountNumbersArray.forEach((accNum) => {
          const trimmedAccNum = accNum.trim();
          const combination = `${account.id}-${trimmedAccNum}`;

          // Only add if we haven't seen this credential ID + account_number combination
          if (!seenCombinations.has(combination)) {
            seenCombinations.add(combination);
            expanded.push({
              ...account,
              account_number: trimmedAccNum
            });
          }
        });
      } else {
        // No account numbers yet - add as individual entry using credential ID
        const combination = `${account.id}-unscraped`;
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
  }, [bankAccounts, creditCardAccounts]);

  const fetchExistingPairings = useCallback(async () => {
    try {
      const response = await apiClient.get<PairingsResponse>('/api/accounts/pairing');
      if (response.ok) {
        setExistingPairings(response.data?.pairings ?? []);
      }
    } catch (error) {
      console.error('Error fetching pairings:', error);
    }
  }, []);

  const fetchUnpairableTransactionsCount = useCallback(async () => {
    try {
      // Get count of bank transactions that might need pairing (categories 25/75)
      const response = await apiClient.get<UnpairedTransactionsCountResponse>('/api/accounts/unpaired-transactions-count');
      if (response.ok) {
        setUnpairableTransactionsCount(response.data?.count ?? 0);
      }
    } catch (error) {
      console.error('Error fetching unpaired count:', error);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchExistingPairings();
      expandAccountsByNumbers();
      fetchUnpairableTransactionsCount();
    }
  }, [isOpen, creditCardAccounts, bankAccounts, expandAccountsByNumbers, fetchExistingPairings, fetchUnpairableTransactionsCount]);

  // Auto-extract unique transaction names from selected transactions
  useEffect(() => {
    const patterns = new Set<string>();

    // Add transaction names from selected transactions
    if (selectedTransactions.size > 0) {
      candidates.forEach(txn => {
        if (selectedTransactions.has(txn.identifier)) {
          patterns.add(txn.name);
        }
      });
    }

    // Add credit card nickname if available
    if (selectedCreditCard?.nickname) {
      patterns.add(selectedCreditCard.nickname);
      // Also add individual words from nickname if multi-word
      const words = selectedCreditCard.nickname.split(/\s+/).filter(w => w.length > 2);
      words.forEach(word => patterns.add(word));
    }

    // Add credit card account number if available
    if (selectedCreditCard?.account_number && selectedCreditCard.account_number !== 'undefined') {
      patterns.add(selectedCreditCard.account_number);
      // Add last 4 digits if longer
      if (selectedCreditCard.account_number.length > 4) {
        patterns.add(selectedCreditCard.account_number.slice(-4));
      }
    }

    // Add card6_digits if available
    if (selectedCreditCard?.card6_digits) {
      const digits = selectedCreditCard.card6_digits.split(';').filter(Boolean);
      digits.forEach(d => {
        const trimmed = d.trim();
        patterns.add(trimmed);
        if (trimmed.length > 4) {
          patterns.add(trimmed.slice(-4));
        }
      });
    }

    setMatchPatterns(Array.from(patterns).filter(p => p && p.length > 0));
  }, [selectedTransactions, candidates, selectedCreditCard]);

  // Auto-extract unique transaction names from edit selected transactions
  useEffect(() => {
    const patterns = new Set<string>();

    // Add transaction names from selected transactions
    if (editSelectedTransactions.size > 0) {
      editCandidates.forEach(txn => {
        if (editSelectedTransactions.has(txn.identifier)) {
          patterns.add(txn.name);
        }
      });
    }

    // Add credit card nickname if available
    if (editCreditCard?.nickname) {
      patterns.add(editCreditCard.nickname);
      const words = editCreditCard.nickname.split(/\s+/).filter(w => w.length > 2);
      words.forEach(word => patterns.add(word));
    }

    // Add credit card account number if available
    if (editCreditCard?.account_number && editCreditCard.account_number !== 'undefined') {
      patterns.add(editCreditCard.account_number);
      if (editCreditCard.account_number.length > 4) {
        patterns.add(editCreditCard.account_number.slice(-4));
      }
    }

    // Add card6_digits if available
    if (editCreditCard?.card6_digits) {
      const digits = editCreditCard.card6_digits.split(';').filter(Boolean);
      digits.forEach(d => {
        const trimmed = d.trim();
        patterns.add(trimmed);
        if (trimmed.length > 4) {
          patterns.add(trimmed.slice(-4));
        }
      });
    }

    setEditMatchPatterns(Array.from(patterns).filter(p => p && p.length > 0));
  }, [editSelectedTransactions, editCandidates, editCreditCard]);

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
        const response = await apiClient.get<SettlementCandidatesResponse>(
          `/api/accounts/find-settlement-candidates?credit_card_account_number=${creditCardNumber}&bank_vendor=${selectedBank.vendor}&bank_account_number=${bankAccountNumber}`
        );

        if (response.ok) {
          setCandidates(response.data?.candidates ?? []);
          setStats(response.data?.stats ?? null);
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
      const response = await apiClient.post('/api/accounts/pairing', {
        creditCardVendor: selectedCreditCard!.vendor,
        creditCardAccountNumber: selectedCreditCard!.account_number || selectedCreditCard!.card6_digits || null,
        bankVendor: selectedBank!.vendor,
        bankAccountNumber: selectedBank!.account_number || selectedBank!.bank_account_number || null,
        matchPatterns: matchPatterns
      });

      if (response.ok) {
        showNotification('Pairing created successfully!', 'success');
        handleClose();
        // Trigger data refresh
        window.dispatchEvent(new CustomEvent('dataRefresh'));
      } else {
        const errorMessage = extractApiError(response.data, 'Failed to create pairing');
        showNotification(errorMessage, 'error');
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
      const response = await apiClient.delete(`/api/accounts/pairing?id=${pairingId}`);

      if (response.ok) {
        showNotification('Pairing deleted successfully', 'success');
        fetchExistingPairings();
        fetchUnpairableTransactionsCount();
        expandAccountsByNumbers(); // Refresh to show newly unpaired accounts
      } else {
        showNotification('Failed to delete pairing', 'error');
      }
    } catch (error) {
      console.error('Error deleting pairing:', error);
      showNotification('Error deleting pairing', 'error');
    }
  };

  const handleUpdatePairing = async (pairingId: number, isActive: boolean) => {
    try {
      const response = await apiClient.put('/api/accounts/pairing', {
        id: pairingId,
        isActive
      });

      if (response.ok) {
        showNotification(
          isActive ? 'Pairing activated' : 'Pairing deactivated',
          'success'
        );
        fetchExistingPairings();
        setEditingPairing(null);
      } else {
        showNotification('Failed to update pairing', 'error');
      }
    } catch (error) {
      console.error('Error updating pairing:', error);
      showNotification('Error updating pairing', 'error');
    }
  };

  const handleStartEdit = (pairing: Pairing) => {
    setEditingPairing(pairing);
    setShowEditReview(false);

    // Find the corresponding accounts
    const creditCard = expandedAccounts.find(
      acc => acc.vendor === pairing.creditCardVendor &&
             acc.account_number === pairing.creditCardAccountNumber
    );
    const bank = expandedAccounts.find(
      acc => acc.vendor === pairing.bankVendor &&
             acc.account_number === pairing.bankAccountNumber
    );

    setEditCreditCard(creditCard || null);
    setEditBank(bank || null);
    setEditCandidates([]);
    setEditSelectedTransactions(new Set());
    setEditMatchPatterns(pairing.matchPatterns || []);
  };

  const handleEditReviewTransactions = async () => {
    if (!editCreditCard || !editBank) {
      showNotification('Please select both accounts', 'error');
      return;
    }

    setEditLoading(true);
    try {
      const creditCardNumber = editCreditCard.account_number || editCreditCard.card6_digits || '0000';
      const bankAccountNumber = editBank.account_number || editBank.bank_account_number || '';
      const response = await apiClient.get<SettlementCandidatesResponse>(
        `/api/accounts/find-settlement-candidates?credit_card_account_number=${creditCardNumber}&bank_vendor=${editBank.vendor}&bank_account_number=${bankAccountNumber}`
      );

      if (response.ok) {
        setEditCandidates(response.data?.candidates ?? []);
        setEditSelectedTransactions(new Set());
        setShowEditReview(true);
      } else {
        showNotification('Failed to find candidate transactions', 'error');
      }
    } catch (error) {
      console.error('Error fetching candidates:', error);
      showNotification('Error finding candidates', 'error');
    } finally {
      setEditLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingPairing) return;

    setEditLoading(true);
    try {
      // Delete old pairing
      await apiClient.delete(`/api/accounts/pairing?id=${editingPairing.id}`);

      // Create new pairing with updated values
      const response = await apiClient.post('/api/accounts/pairing', {
        creditCardVendor: editCreditCard!.vendor,
        creditCardAccountNumber: editCreditCard!.account_number || editCreditCard!.card6_digits || null,
        bankVendor: editBank!.vendor,
        bankAccountNumber: editBank!.account_number || editBank!.bank_account_number || null,
        matchPatterns: editMatchPatterns
      });

      if (response.ok) {
        showNotification('Pairing updated successfully!', 'success');
        setEditingPairing(null);
        setShowEditReview(false);
        fetchExistingPairings();
        fetchUnpairableTransactionsCount();
        expandAccountsByNumbers();
        window.dispatchEvent(new CustomEvent('dataRefresh'));
      } else {
        const errorMessage = extractApiError(response.data, 'Failed to update pairing');
        showNotification(errorMessage, 'error');
      }
    } catch (error) {
      console.error('Error updating pairing:', error);
      showNotification('Error updating pairing', 'error');
    } finally {
      setEditLoading(false);
    }
  };

  const toggleEditTransaction = (identifier: string) => {
    const transaction = editCandidates.find(c => c.identifier === identifier);
    if (!transaction) return;

    setEditSelectedTransactions(prev => {
      const next = new Set(prev);
      const isCurrentlySelected = next.has(identifier);

      if (isCurrentlySelected) {
        next.delete(identifier);
      } else {
        editCandidates.forEach(c => {
          if (c.name === transaction.name) {
            next.add(c.identifier);
          }
        });
      }

      return next;
    });
  };

  const toggleAllEditTransactions = () => {
    if (editSelectedTransactions.size === editCandidates.length) {
      setEditSelectedTransactions(new Set());
    } else {
      setEditSelectedTransactions(new Set(editCandidates.map(c => c.identifier)));
    }
  };

  const handleClose = () => {
    setActiveStep(0);
    setSelectedCreditCard(null);
    setSelectedBank(null);
    setCandidates([]);
    setSelectedTransactions(new Set());
    setStats(null);
    setMatchPatterns([]);
    setNewPatternInput('');
    onClose();
  };

  const handleAddPattern = () => {
    if (newPatternInput.trim() && !matchPatterns.includes(newPatternInput.trim())) {
      setMatchPatterns([...matchPatterns, newPatternInput.trim()]);
      setNewPatternInput('');
    }
  };

  const handleRemovePattern = (pattern: string) => {
    setMatchPatterns(matchPatterns.filter(p => p !== pattern));
  };

  const handleAddEditPattern = () => {
    if (editNewPatternInput.trim() && !editMatchPatterns.includes(editNewPatternInput.trim())) {
      setEditMatchPatterns([...editMatchPatterns, editNewPatternInput.trim()]);
      setEditNewPatternInput('');
    }
  };

  const handleRemoveEditPattern = (pattern: string) => {
    setEditMatchPatterns(editMatchPatterns.filter(p => p !== pattern));
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

  const handleSmartSelect = async () => {
    if (!selectedCreditCard || !selectedBank) {
      showNotification('Please select accounts first', 'error');
      return;
    }

    setSmartSelectLoading(true);
    try {
      const response = await apiClient.post<SmartMatchResponse>('/api/accounts/smart-match', {
        creditCardVendor: selectedCreditCard.vendor,
        creditCardAccountNumber: selectedCreditCard.account_number || selectedCreditCard.card6_digits || null,
        bankVendor: selectedBank.vendor,
        bankAccountNumber: selectedBank.account_number || selectedBank.bank_account_number || null,
        nickname: selectedCreditCard.nickname,
        card6_digits: selectedCreditCard.card6_digits,
      });

      if (response.ok) {
        const matches = response.data?.matches ?? [];
        const matchedIds = matches.map((match) => match.identifier);

        // Select the matched transactions
        setSelectedTransactions(new Set(matchedIds));

        // Show notification with count
        showNotification(
          `Smart Select found ${matchedIds.length} matching transaction${matchedIds.length !== 1 ? 's' : ''}`,
          'success'
        );
      } else {
        showNotification('Failed to perform smart match', 'error');
      }
    } catch (error) {
      console.error('Smart select error:', error);
      showNotification('Error during smart selection', 'error');
    } finally {
      setSmartSelectLoading(false);
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
    <>
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
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">
                Existing Pairings ({existingPairings.length})
              </Typography>
              {unpairableTransactionsCount > 0 && (
                <Chip
                  label={`${unpairableTransactionsCount} transactions may need pairing`}
                  color="warning"
                  size="small"
                  onClick={() => setShowUnpairedDialog(true)}
                  sx={{ cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
                />
              )}
            </Box>
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
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <LinkIcon fontSize="small" />
                        <Typography variant="body1">
                          {pairing.creditCardInstitution?.display_name_he || pairing.creditCardVendor} ({pairing.creditCardAccountNumber || 'Not specified'}) → {pairing.bankInstitution?.display_name_he || pairing.bankVendor} ({pairing.bankAccountNumber || 'All accounts'})
                        </Typography>
                        {pairing.isActive && (
                          <Chip label="Active" size="small" color="success" />
                        )}
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          Created: {new Date(pairing.createdAt).toLocaleDateString()}
                        </Typography>
                        {pairing.matchPatterns && pairing.matchPatterns.length > 0 && (
                          <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
                            <Typography variant="caption" color="text.secondary">
                              Patterns:
                            </Typography>
                            {pairing.matchPatterns.map((pattern) => (
                              <Chip key={pattern} label={pattern} size="small" variant="outlined" />
                            ))}
                          </Box>
                        )}
                      </Box>
                    }
                  />
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <IconButton
                      onClick={() => handleStartEdit(pairing)}
                      color="primary"
                      title="Edit pairing"
                    >
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      onClick={() => handleDeletePairing(pairing.id)}
                      color="error"
                      title="Delete pairing"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Box>
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
              helperText="Only showing credit cards that haven't been paired yet"
            >
              {expandedAccounts
                .filter(acc => {
                  // Only show credit cards
                  if (!creditCardAccounts.some(c => c.id === acc.id)) return false;

                  // Filter out already paired credit card accounts
                  const isPaired = existingPairings.some(p =>
                    p.creditCardVendor === acc.vendor &&
                    p.creditCardAccountNumber === acc.account_number
                  );
                  return !isPaired;
                })
                .map((account, idx) => {
                  const key = `${account.id}-${account.account_number || idx}`;

                  return (
                    <MenuItem key={key} value={`${account.id}-${account.account_number || 'undefined'}`}>
                      {getAccountDisplayName(account)}
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
                  const key = `${account.id}-${account.account_number || idx}`;

                  return (
                    <MenuItem key={key} value={`${account.id}-${account.account_number || 'undefined'}`}>
                      {getAccountDisplayName(account)}
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
                    <strong>Credit Card:</strong> {selectedCreditCard && getAccountDisplayName(selectedCreditCard)}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Bank Account:</strong> {selectedBank && getAccountDisplayName(selectedBank)}
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
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      onClick={handleSmartSelect}
                      size="small"
                      variant="outlined"
                      disabled={smartSelectLoading}
                    >
                      {smartSelectLoading ? 'Searching...' : 'Smart Select'}
                    </Button>
                    <Button onClick={toggleAll} size="small">
                      {selectedTransactions.size === candidates.length ? 'Deselect All' : 'Select All'}
                    </Button>
                  </Box>
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

                {/* Match Patterns Section */}
                <Box sx={{ mt: 3 }}>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Match Patterns
                  </Typography>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    These transaction names will be used to identify future settlement transactions.
                    Patterns are automatically extracted from selected transactions, but you can add or remove them manually.
                  </Alert>

                  <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                    {matchPatterns.map((pattern) => (
                      <Chip
                        key={pattern}
                        label={pattern}
                        onDelete={() => handleRemovePattern(pattern)}
                        color="primary"
                        variant="outlined"
                      />
                    ))}
                    {matchPatterns.length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        No patterns yet. Select transactions to auto-extract patterns.
                      </Typography>
                    )}
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField
                      size="small"
                      label="Add custom pattern"
                      value={newPatternInput}
                      onChange={(e) => setNewPatternInput(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleAddPattern();
                        }
                      }}
                      sx={{ flex: 1 }}
                    />
                    <Button onClick={handleAddPattern} variant="outlined">
                      Add
                    </Button>
                  </Box>
                </Box>
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
                <strong>Match Patterns ({matchPatterns.length}):</strong>
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                {matchPatterns.map((pattern) => (
                  <Chip key={pattern} label={pattern} size="small" color="primary" />
                ))}
              </Box>
              <Typography variant="body2" sx={{ mt: 1 }}>
                Future bank transactions matching these patterns will be automatically excluded from analytics.
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
            disabled={loading || matchPatterns.length === 0}
            startIcon={loading ? <CircularProgress size={20} /> : <LinkIcon />}
          >
            Create Pairing
          </Button>
        )}
      </DialogActions>
    </Dialog>

    {/* Edit Pairing Dialog */}
    <Dialog open={!!editingPairing} onClose={() => setEditingPairing(null)} maxWidth="lg" fullWidth>
      <ModalHeader
        title="Edit Pairing"
        onClose={() => {
          setEditingPairing(null);
          setShowEditReview(false);
        }}
      />
      <DialogContent>
        {editingPairing && (
          <Box>
            <Alert severity="info" sx={{ mb: 3 }}>
              <AlertTitle>Current Pairing</AlertTitle>
              <Typography variant="body2">
                <strong>Credit Card:</strong> {editingPairing.creditCardVendor} ({editingPairing.creditCardAccountNumber || 'N/A'})
              </Typography>
              <Typography variant="body2">
                <strong>Bank Account:</strong> {editingPairing.bankVendor} ({editingPairing.bankAccountNumber || 'N/A'})
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                <strong>Status:</strong> {editingPairing.isActive ? (
                  <Chip label="Active" size="small" color="success" sx={{ ml: 1 }} />
                ) : (
                  <Chip label="Inactive" size="small" color="default" sx={{ ml: 1 }} />
                )}
              </Typography>
            </Alert>

            {!showEditReview ? (
              <>
                <Typography variant="h6" sx={{ mb: 2 }}>Update Pairing Accounts</Typography>

                <TextField
                  fullWidth
                  select
                  label="Credit Card Account"
                  value={editCreditCard ? `${editCreditCard.id}-${editCreditCard.account_number}` : ''}
                  onChange={(e) => {
                    const [idStr, accNum] = e.target.value.split('-');
                    const id = Number(idStr);
                    const account = expandedAccounts.find(
                      a => a.id === id && a.account_number === (accNum === 'undefined' ? undefined : accNum)
                    );
                    if (account) setEditCreditCard(account);
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
                  label="Bank Account"
                  value={editBank ? `${editBank.id}-${editBank.account_number}` : ''}
                  onChange={(e) => {
                    const [idStr, accNum] = e.target.value.split('-');
                    const id = Number(idStr);
                    const account = expandedAccounts.find(
                      a => a.id === id && a.account_number === (accNum === 'undefined' ? undefined : accNum)
                    );
                    if (account) setEditBank(account);
                  }}
                  sx={{ mb: 3 }}
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

                <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                  <Button
                    variant="contained"
                    onClick={handleEditReviewTransactions}
                    disabled={!editCreditCard || !editBank || editLoading}
                    fullWidth
                  >
                    Review Transactions
                  </Button>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Typography variant="h6" sx={{ mb: 2 }}>Quick Actions</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {editingPairing.isActive ? (
                    <Button
                      variant="outlined"
                      color="warning"
                      onClick={() => handleUpdatePairing(editingPairing.id, false)}
                    >
                      Deactivate Pairing
                    </Button>
                  ) : (
                    <Button
                      variant="outlined"
                      color="success"
                      onClick={() => handleUpdatePairing(editingPairing.id, true)}
                    >
                      Activate Pairing
                    </Button>
                  )}

                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteIcon />}
                    onClick={() => {
                      handleDeletePairing(editingPairing.id);
                      setEditingPairing(null);
                    }}
                  >
                    Delete Pairing
                  </Button>
                </Box>
              </>
            ) : (
              <>
                <Typography variant="h6" sx={{ mb: 2 }}>Review Transactions for Updated Pairing</Typography>

                {editLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress />
                  </Box>
                ) : (
                  <>
                    <Alert severity="info" sx={{ mb: 2 }}>
                      <Typography variant="body2">
                        <strong>Credit Card:</strong> {editCreditCard?.vendor} ({editCreditCard?.account_number || 'N/A'})
                      </Typography>
                      <Typography variant="body2">
                        <strong>Bank Account:</strong> {editBank?.vendor} ({editBank?.account_number || 'N/A'})
                      </Typography>
                    </Alert>

                    <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="body2">
                        {editSelectedTransactions.size} of {editCandidates.length} selected
                      </Typography>
                      <Button onClick={toggleAllEditTransactions} size="small">
                        {editSelectedTransactions.size === editCandidates.length ? 'Deselect All' : 'Select All'}
                      </Button>
                    </Box>

                    <TableContainer component={Paper} sx={{ maxHeight: 400 }}>
                      <Table stickyHeader size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={editSelectedTransactions.size === editCandidates.length && editCandidates.length > 0}
                                indeterminate={editSelectedTransactions.size > 0 && editSelectedTransactions.size < editCandidates.length}
                                onChange={toggleAllEditTransactions}
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
                          {editCandidates.map((txn) => {
                            const isSelected = editSelectedTransactions.has(txn.identifier);
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
                                    onChange={() => toggleEditTransaction(txn.identifier)}
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

                    {/* Edit Match Patterns Section */}
                    <Box sx={{ mt: 3 }}>
                      <Typography variant="h6" sx={{ mb: 2 }}>
                        Match Patterns
                      </Typography>
                      <Alert severity="info" sx={{ mb: 2 }}>
                        These transaction names will be used to identify future settlement transactions.
                        Patterns are automatically extracted from selected transactions, but you can add or remove them manually.
                      </Alert>

                      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                        {editMatchPatterns.map((pattern) => (
                          <Chip
                            key={pattern}
                            label={pattern}
                            onDelete={() => handleRemoveEditPattern(pattern)}
                            color="primary"
                            variant="outlined"
                          />
                        ))}
                        {editMatchPatterns.length === 0 && (
                          <Typography variant="body2" color="text.secondary">
                            No patterns yet. Select transactions to auto-extract patterns.
                          </Typography>
                        )}
                      </Box>

                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                          size="small"
                          label="Add custom pattern"
                          value={editNewPatternInput}
                          onChange={(e) => setEditNewPatternInput(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              handleAddEditPattern();
                            }
                          }}
                          sx={{ flex: 1 }}
                        />
                        <Button onClick={handleAddEditPattern} variant="outlined">
                          Add
                        </Button>
                      </Box>
                    </Box>
                  </>
                )}
              </>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => {
          setEditingPairing(null);
          setShowEditReview(false);
        }} disabled={editLoading}>
          Cancel
        </Button>
        {showEditReview && (
          <>
            <Button onClick={() => setShowEditReview(false)} disabled={editLoading}>
              Back
            </Button>
            <Button
              onClick={handleSaveEdit}
              variant="contained"
              color="primary"
              disabled={editLoading || editMatchPatterns.length === 0}
              startIcon={editLoading ? <CircularProgress size={20} /> : <LinkIcon />}
            >
              Save Changes
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>

    {/* Unpaired Transactions Dialog */}
    <UnpairedTransactionsDialog
      isOpen={showUnpairedDialog}
      onClose={() => {
        setShowUnpairedDialog(false);
        fetchUnpairableTransactionsCount(); // Refresh count when dialog closes
      }}
    />
    </>
  );
}
