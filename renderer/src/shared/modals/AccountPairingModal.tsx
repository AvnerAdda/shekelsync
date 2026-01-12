import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Box,
  Typography,
  Chip,
  Alert,
  AlertTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Divider,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';
import EditIcon from '@mui/icons-material/Edit';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import { useTranslation } from 'react-i18next';
import ModalHeader from './ModalHeader';
import UnpairedTransactionsDialog from './UnpairedTransactionsDialog';
import ManualMatchingModal from '@renderer/features/investments/components/ManualMatchingModal';
import MatchingTimeSeriesChart from '@renderer/features/investments/components/MatchingTimeSeriesChart';
import RepaymentDiscrepancyList from '@renderer/shared/components/RepaymentDiscrepancyList';
import { apiClient } from '@/lib/api-client';
import InstitutionBadge, { InstitutionMetadata, getInstitutionLabel } from '@renderer/shared/components/InstitutionBadge';

interface Account {
  id: number;
  vendor: string;
  institution_id?: number | null;
  institution?: InstitutionMetadata | null;
  nickname?: string;
  card6_digits?: string;
  bank_account_number?: string;
  accountNumbers?: string[];
  account_number?: string;
}

interface MatchingStats {
  totalRepayments: number;
  matchedCount: number;
  partialCount: number;
  unmatchedCount: number;
  totalAmount: number;
  matchedAmount: number;
  unmatchedAmount: number;
  matchPercentage: number;
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
  creditCardInstitution?: InstitutionMetadata | null;
  bankInstitution?: InstitutionMetadata | null;
  matchingStats?: MatchingStats | null;
}

interface AccountPairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  creditCardAccounts?: Account[];
  bankAccounts?: Account[];
}

interface PairingsResponse {
  pairings: Pairing[];
}

interface UnpairedTransactionsCountResponse {
  count: number;
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
  totalCycles?: number;
  matchPatternsUsed?: string[];
  method?: string;
  cycles?: Array<{
    cycleDate: string;
    bankTotal: number;
    bankPaymentTotal?: number;
    bankRefundTotal?: number;
    ccTotal: number | null;
    difference: number | null;
    status: 'matched' | 'missing_cc_cycle' | 'fee_candidate' | 'large_discrepancy' | 'cc_over_bank' | 'incomplete_history';
    repayments: Array<{
      identifier: string;
      vendor: string;
      accountNumber: string | null;
      date: string;
      cycleDate: string;
      name: string;
      price: number;
    }>;
  }>;
}

interface ReimbursementSummary {
  status: 'loading' | 'ready' | 'error';
  confirmed: boolean;
  matchPercentage: number;
  matchedCycles: number;
  totalCycles: number;
}

interface AutoPairResult {
  success: boolean;
  wasCreated?: boolean;
  reason?: string;
  pairing?: {
    id: number;
    creditCardVendor: string;
    creditCardAccountNumber: string | null;
    bankVendor: string;
    bankAccountNumber: string | null;
    matchPatterns: string[];
  };
  detection?: {
    transactionCount: number;
    matchingLast4Count: number;
    matchingVendorCount: number;
    sampleTransactions: Array<{
      name: string;
      price: number;
      date: string;
    }>;
  };
  discrepancy?: Discrepancy | null;
}

interface FindBankAccountResult {
  found: boolean;
  reason?: string;
  bankVendor?: string;
  bankAccountNumber?: string | null;
  transactionCount?: number;
  matchingLast4Count?: number;
  matchingVendorCount?: number;
  matchPatterns?: string[];
  sampleTransactions?: Array<{
    name: string;
    price: number;
    date: string;
  }>;
  otherCandidates?: Array<{
    bankVendor: string;
    bankAccountNumber: string | null;
    transactionCount: number;
  }>;
}

export default function AccountPairingModal({
  isOpen,
  onClose,
  creditCardAccounts = [],
  bankAccounts = [],
}: AccountPairingModalProps) {
  const [selectedCreditCard, setSelectedCreditCard] = useState<Account | null>(null);
  const [existingPairings, setExistingPairings] = useState<Pairing[]>([]);
  const [expandedAccounts, setExpandedAccounts] = useState<Account[]>([]);
  const [unpairableTransactionsCount, setUnpairableTransactionsCount] = useState<number>(0);
  const [showUnpairedDialog, setShowUnpairedDialog] = useState(false);
  const [showManualMatchingModal, setShowManualMatchingModal] = useState(false);
  const [selectedPairingForMatching, setSelectedPairingForMatching] = useState<Pairing | null>(null);
  const { showNotification } = useNotification();
  const { t } = useTranslation();

  // Auto-pairing state
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoPairResult, setAutoPairResult] = useState<FindBankAccountResult | null>(null);
  const [autoDiscrepancy, setAutoDiscrepancy] = useState<Discrepancy | null>(null);
  const [autoCreatingPairing, setAutoCreatingPairing] = useState(false);
  const [discrepancyResolving, setDiscrepancyResolving] = useState(false);
  const [autoPairingId, setAutoPairingId] = useState<number | null>(null);

  // Reimbursements list (per pairing)
  const [reimbursementsDialogOpen, setReimbursementsDialogOpen] = useState(false);
  const [reimbursementsPairing, setReimbursementsPairing] = useState<Pairing | null>(null);
  const [reimbursementsDiscrepancy, setReimbursementsDiscrepancy] = useState<Discrepancy | null>(null);
  const [reimbursementsLoading, setReimbursementsLoading] = useState(false);
  const [reimbursementSummaries, setReimbursementSummaries] = useState<Record<number, ReimbursementSummary>>({});

  // Helper function to get display name for an account
  const getAccountDisplayName = useCallback((account: Account, includeVendor: boolean = true): string => {
    const parts: string[] = [];

    if (includeVendor) {
      const vendorLabel = account.institution
        ? getInstitutionLabel(account.institution)
        : null;
      parts.push(vendorLabel || account.vendor);
    }

    if (account.nickname) {
      parts.push(account.nickname);
    }

    if (account.account_number) {
      const masked = account.account_number.length > 4
        ? `****${account.account_number.slice(-4)}`
        : account.account_number;
      parts.push(masked);
    } else {
      const status = (account as any).lastScrapeStatus;
      if (status === 'failed') {
        parts.push('Last scrape failed');
      } else if (status === 'success') {
        parts.push('No account number');
      } else {
        parts.push('Not yet scraped');
      }
    }

    return parts.join(' - ');
  }, []);

  const expandAccountsByNumbers = useCallback(() => {
    const expanded: Account[] = [];
    const seenCombinations = new Set<string>();

    [...creditCardAccounts, ...bankAccounts].forEach((account) => {
      const accountNumbersArray = account.accountNumbers || [];

      if (accountNumbersArray.length > 0) {
        accountNumbersArray.forEach((accNum) => {
          const trimmedAccNum = accNum.trim();
          const combination = `${account.id}-${trimmedAccNum}`;

          if (!seenCombinations.has(combination)) {
            seenCombinations.add(combination);
            expanded.push({
              ...account,
              account_number: trimmedAccNum
            });
          }
        });
      } else {
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
      const response = await apiClient.get<PairingsResponse>('/api/accounts/pairing?include_stats=true');
      if (response.ok) {
        setExistingPairings(response.data?.pairings ?? []);
      }
    } catch (error) {
      console.error('Error fetching pairings:', error);
    }
  }, []);

  const fetchUnpairableTransactionsCount = useCallback(async () => {
    try {
      const response = await apiClient.get<UnpairedTransactionsCountResponse>('/api/accounts/unpaired-transactions-count');
      if (response.ok) {
        setUnpairableTransactionsCount(response.data?.count ?? 0);
      }
    } catch (error) {
      console.error('Error fetching unpaired count:', error);
    }
  }, []);

  // Auto-detect bank account for selected credit card
  const handleAutoDetect = useCallback(async (creditCard: Account) => {
    setAutoDetecting(true);
    setAutoPairResult(null);
    setAutoDiscrepancy(null);

    try {
      const response = await apiClient.post<FindBankAccountResult>('/api/accounts/find-bank-account', {
        creditCardVendor: creditCard.vendor,
        creditCardAccountNumber: creditCard.account_number || creditCard.card6_digits || null,
      });

      if (response.ok && response.data) {
        setAutoPairResult(response.data);

        // If found, also calculate discrepancy
        if (response.data.found && response.data.matchPatterns) {
          const discrepancyResponse = await apiClient.post<Discrepancy>('/api/accounts/calculate-discrepancy', {
            bankVendor: response.data.bankVendor,
            bankAccountNumber: response.data.bankAccountNumber,
            ccVendor: creditCard.vendor,
            ccAccountNumber: creditCard.account_number || null,
            matchPatterns: response.data.matchPatterns,
          });

          if (discrepancyResponse.ok && discrepancyResponse.data) {
            setAutoDiscrepancy(discrepancyResponse.data);
          }
        }
      }
    } catch (error) {
      console.error('Auto-detect error:', error);
      showNotification('Error detecting bank account', 'error');
    } finally {
      setAutoDetecting(false);
    }
  }, [showNotification]);

  // Create pairing
  const handleAutoCreatePairing = useCallback(async () => {
    if (!selectedCreditCard || !autoPairResult?.found) return;

    setAutoCreatingPairing(true);
    try {
      const response = await apiClient.post<AutoPairResult>('/api/accounts/auto-pair', {
        creditCardVendor: selectedCreditCard.vendor,
        creditCardAccountNumber: selectedCreditCard.account_number || selectedCreditCard.card6_digits || null,
      });

      if (response.ok && response.data?.success) {
        setAutoPairingId(response.data.pairing?.id ?? null);
        showNotification(
          response.data.wasCreated
            ? t('autoPairing.pairingCreated')
            : t('autoPairing.pairingExists'),
          'success'
        );

        // Update discrepancy if available
        if (response.data.discrepancy) {
          setAutoDiscrepancy(response.data.discrepancy);
        }

        // Refresh pairings list
        fetchExistingPairings();
        fetchUnpairableTransactionsCount();

        // Close modal if no discrepancy
        if (!response.data.discrepancy?.exists) {
          handleClose();
          window.dispatchEvent(new CustomEvent('dataRefresh'));
        }
      } else {
        showNotification(response.data?.reason || 'Failed to create pairing', 'error');
      }
    } catch (error) {
      console.error('Auto-pair error:', error);
      showNotification('Error creating pairing', 'error');
    } finally {
      setAutoCreatingPairing(false);
    }
  }, [selectedCreditCard, autoPairResult, t, showNotification, fetchExistingPairings, fetchUnpairableTransactionsCount]);

  // Handle discrepancy resolution
  const handleIgnoreDiscrepancy = useCallback(async (cycleDate: string) => {
    if (!autoPairingId) {
      showNotification('Create the pairing first', 'warning');
      return;
    }

    setDiscrepancyResolving(true);
    try {
      const response = await apiClient.post(`/api/accounts/pairing/${autoPairingId}/resolve-discrepancy`, {
        action: 'ignore',
        cycleDate,
      });

      if (response.ok) {
        showNotification('Discrepancy ignored', 'success');
        setAutoDiscrepancy(null);
        handleClose();
        window.dispatchEvent(new CustomEvent('dataRefresh'));
      }
    } catch (error) {
      console.error('Error ignoring discrepancy:', error);
      showNotification('Error resolving discrepancy', 'error');
    } finally {
      setDiscrepancyResolving(false);
    }
  }, [autoPairingId, showNotification]);

  const handleAddAsFee = useCallback(async (cycleDate: string, amount: number, feeName: string) => {
    if (!autoPairingId) {
      showNotification('Create the pairing first', 'warning');
      return;
    }

    setDiscrepancyResolving(true);
    try {
      const response = await apiClient.post(`/api/accounts/pairing/${autoPairingId}/resolve-discrepancy`, {
        action: 'add_cc_fee',
        cycleDate,
        feeDetails: {
          amount: Math.abs(amount),
          date: cycleDate,
          processedDate: cycleDate,
          name: feeName,
        },
      });

      if (response.ok) {
        showNotification('Fee transaction created', 'success');
        setAutoDiscrepancy(null);
        handleClose();
        window.dispatchEvent(new CustomEvent('dataRefresh'));
      }
    } catch (error) {
      console.error('Error adding fee:', error);
      showNotification('Error creating fee transaction', 'error');
    } finally {
      setDiscrepancyResolving(false);
    }
  }, [autoPairingId, showNotification]);

  // Trigger auto-detect when credit card is selected
  useEffect(() => {
    if (selectedCreditCard && isOpen) {
      handleAutoDetect(selectedCreditCard);
    }
  }, [selectedCreditCard, isOpen, handleAutoDetect]);

  useEffect(() => {
    if (isOpen) {
      fetchExistingPairings();
      expandAccountsByNumbers();
      fetchUnpairableTransactionsCount();
    }
  }, [isOpen, creditCardAccounts, bankAccounts, expandAccountsByNumbers, fetchExistingPairings, fetchUnpairableTransactionsCount]);

  useEffect(() => {
    if (!isOpen) return;

    if (existingPairings.length === 0) {
      setReimbursementSummaries({});
      return;
    }

    let cancelled = false;
    const pairingsSnapshot = [...existingPairings];

    setReimbursementSummaries(() =>
      Object.fromEntries(
        pairingsSnapshot.map(pairing => [
          pairing.id,
          {
            status: 'loading',
            confirmed: false,
            matchPercentage: 0,
            matchedCycles: 0,
            totalCycles: 0,
          },
        ]),
      ),
    );

    (async () => {
      const results = await Promise.all(pairingsSnapshot.map(async (pairing) => {
        try {
          const response = await apiClient.post<Discrepancy>('/api/accounts/calculate-discrepancy', {
            pairingId: pairing.id,
            bankVendor: pairing.bankVendor,
            bankAccountNumber: pairing.bankAccountNumber,
            ccVendor: pairing.creditCardVendor,
            ccAccountNumber: pairing.creditCardAccountNumber,
            matchPatterns: pairing.matchPatterns || [],
            monthsBack: 6,
          });

          if (!response.ok || !response.data) {
            return {
              pairingId: pairing.id,
              summary: {
                status: 'error',
                confirmed: false,
                matchPercentage: 0,
                matchedCycles: 0,
                totalCycles: 0,
              } satisfies ReimbursementSummary,
            };
          }

          const discrepancy = response.data;
          const relevantCycles = (discrepancy.cycles || []).filter(cycle => cycle.status !== 'incomplete_history');
          const totalCycles = relevantCycles.length;
          const matchedCycles = relevantCycles.filter(cycle => cycle.status === 'matched').length;

          const rawMatchPercentage = totalCycles > 0
            ? Math.round((matchedCycles / totalCycles) * 100)
            : 0;

          const confirmed = discrepancy.exists === false;
          const matchPercentage = totalCycles > 0 && confirmed ? 100 : rawMatchPercentage;

          return {
            pairingId: pairing.id,
            summary: {
              status: 'ready',
              confirmed,
              matchPercentage,
              matchedCycles,
              totalCycles,
            } satisfies ReimbursementSummary,
          };
        } catch (error) {
          console.error('Error loading reimbursement summary:', error);
          return {
            pairingId: pairing.id,
            summary: {
              status: 'error',
              confirmed: false,
              matchPercentage: 0,
              matchedCycles: 0,
              totalCycles: 0,
            } satisfies ReimbursementSummary,
          };
        }
      }));

      if (cancelled) return;

      setReimbursementSummaries(() =>
        Object.fromEntries(results.map(({ pairingId, summary }) => [pairingId, summary])),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, existingPairings]);

  const handleDeletePairing = async (pairingId: number) => {
    try {
      const response = await apiClient.delete(`/api/accounts/pairing?id=${pairingId}`);

      if (response.ok) {
        showNotification('Pairing deleted successfully', 'success');
        fetchExistingPairings();
        fetchUnpairableTransactionsCount();
        expandAccountsByNumbers();
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
      } else {
        showNotification('Failed to update pairing', 'error');
      }
    } catch (error) {
      console.error('Error updating pairing:', error);
      showNotification('Error updating pairing', 'error');
    }
  };

  const handleOpenManualMatching = (pairing: Pairing) => {
    setSelectedPairingForMatching(pairing);
    setShowManualMatchingModal(true);
  };

  const handleCloseManualMatching = () => {
    setShowManualMatchingModal(false);
    setSelectedPairingForMatching(null);
    fetchExistingPairings();
  };

  const fetchReimbursementsForPairing = useCallback(async (pairing: Pairing) => {
    setReimbursementsLoading(true);
    setReimbursementsDiscrepancy(null);
    try {
      const response = await apiClient.post<Discrepancy>('/api/accounts/calculate-discrepancy', {
        pairingId: pairing.id,
        bankVendor: pairing.bankVendor,
        bankAccountNumber: pairing.bankAccountNumber,
        ccVendor: pairing.creditCardVendor,
        ccAccountNumber: pairing.creditCardAccountNumber,
        matchPatterns: pairing.matchPatterns || [],
        monthsBack: 6,
      });

      if (response.ok && response.data) {
        setReimbursementsDiscrepancy(response.data);
      } else {
        showNotification('Failed to load reimbursements', 'error');
      }
    } catch (error) {
      console.error('Error loading reimbursements:', error);
      showNotification('Error loading reimbursements', 'error');
    } finally {
      setReimbursementsLoading(false);
    }
  }, [showNotification]);

  const handleOpenReimbursements = useCallback((pairing: Pairing) => {
    setReimbursementsPairing(pairing);
    setReimbursementsDialogOpen(true);
    fetchReimbursementsForPairing(pairing);
  }, [fetchReimbursementsForPairing]);

  const handleCloseReimbursements = useCallback(() => {
    setReimbursementsDialogOpen(false);
    setReimbursementsPairing(null);
    setReimbursementsDiscrepancy(null);
    setReimbursementsLoading(false);
  }, []);

  const handleIgnoreReimbursementCycle = useCallback(async (cycleDate: string) => {
    if (!reimbursementsPairing?.id) return;

    setDiscrepancyResolving(true);
    try {
      const response = await apiClient.post(`/api/accounts/pairing/${reimbursementsPairing.id}/resolve-discrepancy`, {
        action: 'ignore',
        cycleDate,
      });

      if (response.ok) {
        showNotification('Discrepancy acknowledged', 'success');
        fetchExistingPairings();
        fetchReimbursementsForPairing(reimbursementsPairing);
        window.dispatchEvent(new CustomEvent('dataRefresh'));
      } else {
        showNotification('Failed to acknowledge discrepancy', 'error');
      }
    } catch (error) {
      console.error('Error acknowledging discrepancy:', error);
      showNotification('Error acknowledging discrepancy', 'error');
    } finally {
      setDiscrepancyResolving(false);
    }
  }, [reimbursementsPairing, showNotification, fetchExistingPairings, fetchReimbursementsForPairing]);

  const handleAddFeeForReimbursementCycle = useCallback(async (cycleDate: string, amount: number, feeName: string) => {
    if (!reimbursementsPairing?.id) return;

    setDiscrepancyResolving(true);
    try {
      const response = await apiClient.post(`/api/accounts/pairing/${reimbursementsPairing.id}/resolve-discrepancy`, {
        action: 'add_cc_fee',
        cycleDate,
        feeDetails: {
          amount: Math.abs(amount),
          date: cycleDate,
          processedDate: cycleDate,
          name: feeName,
        },
      });

      if (response.ok) {
        showNotification('Fee transaction created', 'success');
        fetchExistingPairings();
        fetchReimbursementsForPairing(reimbursementsPairing);
        window.dispatchEvent(new CustomEvent('dataRefresh'));
      } else {
        showNotification('Failed to create fee transaction', 'error');
      }
    } catch (error) {
      console.error('Error creating fee transaction:', error);
      showNotification('Error creating fee transaction', 'error');
    } finally {
      setDiscrepancyResolving(false);
    }
  }, [reimbursementsPairing, showNotification, fetchExistingPairings, fetchReimbursementsForPairing]);

  const handleClose = () => {
    setSelectedCreditCard(null);
    setAutoPairResult(null);
    setAutoDiscrepancy(null);
    setAutoPairingId(null);
    onClose();
  };

  // Get unpaired credit cards (filter out already paired ones)
  const unpairedCreditCards = expandedAccounts.filter(acc => {
    // Only show credit cards
    if (!creditCardAccounts.some(c => c.id === acc.id)) return false;

    // Filter out already paired credit card accounts
    const isPaired = existingPairings.some(p =>
      p.creditCardVendor === acc.vendor &&
      p.creditCardAccountNumber === acc.account_number
    );
    return !isPaired;
  });

  return (
    <>
      <Dialog open={isOpen} onClose={handleClose} maxWidth="md" fullWidth>
        <ModalHeader
          title="Account Pairing"
          onClose={handleClose}
        />

        <DialogContent>
          {/* Existing Pairings Section */}
          {existingPairings.length > 0 && (
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
                {existingPairings.map((pairing) => {
                  const reimbursementsSummary = reimbursementSummaries[pairing.id];
                  const reimbursementsChipColor: 'success' | 'warning' | 'error' | 'default' = reimbursementsSummary
                    ? reimbursementsSummary.matchPercentage >= 95 ? 'success'
                      : reimbursementsSummary.matchPercentage >= 70 ? 'warning'
                        : 'error'
                    : 'default';
                  const reimbursementsMatchedCycles = reimbursementsSummary
                    ? reimbursementsSummary.confirmed
                      ? reimbursementsSummary.totalCycles
                      : reimbursementsSummary.matchedCycles
                    : 0;

		                  return (
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
	                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
	                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
	                            <LinkIcon fontSize="small" />
	                            {pairing.isActive && <Chip label="Active" size="small" color="success" />}
	                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <InstitutionBadge
                              institution={pairing.creditCardInstitution}
                              fallback={pairing.creditCardVendor}
                            />
                            <Typography variant="body2" color="text.secondary">
                              {pairing.creditCardAccountNumber ? `****${pairing.creditCardAccountNumber.slice(-4)}` : 'All cards'}
                            </Typography>
                            <Typography variant="body2" sx={{ mx: 1 }}>→</Typography>
                            <InstitutionBadge
                              institution={pairing.bankInstitution}
                              fallback={pairing.bankVendor}
                            />
                            <Typography variant="body2" color="text.secondary">
                              {pairing.bankAccountNumber || 'All accounts'}
                            </Typography>
                          </Box>
                        </Box>
	                      }
	                      secondary={
	                        <>
	                          <Typography variant="body2" color="text.secondary" component="span">
	                            Created: {new Date(pairing.createdAt).toLocaleDateString()}
	                          </Typography>
	                          {reimbursementsSummary && (
	                            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
	                              {reimbursementsSummary.status === 'loading' ? (
	                                <Chip
	                                  label="Reimbursements: …"
	                                  size="small"
	                                  color="info"
	                                  variant="outlined"
	                                />
	                              ) : reimbursementsSummary.status === 'error' ? (
	                                <Chip
	                                  label="Reimbursements: error"
	                                  size="small"
	                                  color="error"
	                                  variant="outlined"
	                                />
	                              ) : reimbursementsSummary.totalCycles === 0 ? (
	                                <Chip
	                                  label="Reimbursements: no data"
	                                  size="small"
	                                  variant="outlined"
	                                />
	                              ) : (
	                                <>
	                                  <Chip
	                                    label={`Reimbursements: ${reimbursementsSummary.matchPercentage}%`}
	                                    size="small"
	                                    color={reimbursementsChipColor}
	                                  />
	                                  <Typography variant="caption" color="text.secondary">
	                                    {reimbursementsMatchedCycles}/{reimbursementsSummary.totalCycles} cycles
	                                  </Typography>
	                                </>
	                              )}
	                            </Box>
	                          )}
	                          <Box sx={{ mt: 2 }}>
	                            <MatchingTimeSeriesChart pairing={pairing} compact />
	                          </Box>
	                        </>
	                      }
	                      secondaryTypographyProps={{ component: 'div' }}
	                    />
	                    <Box sx={{ display: 'flex', gap: 1 }}>
	                      <IconButton
	                        onClick={() => handleOpenReimbursements(pairing)}
	                        color="info"
	                        title="View reimbursements"
	                      >
	                        <TrendingUpIcon />
	                      </IconButton>
	                      <IconButton
	                        onClick={() => handleOpenManualMatching(pairing)}
	                        color="success"
	                        title="Manual matching"
	                      >
	                        <AccountTreeIcon />
	                      </IconButton>
	                      <IconButton
	                        onClick={() => handleUpdatePairing(pairing.id, !pairing.isActive)}
	                        color="primary"
	                        title={pairing.isActive ? 'Deactivate' : 'Activate'}
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
	                  );
	                })}
	              </List>
	              <Divider sx={{ my: 3 }} />
	            </Box>
	          )}

          {/* New Pairing Section */}
          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Create New Pairing
            </Typography>

            <Alert severity="info" sx={{ mb: 3 }}>
              <AlertTitle>Automatic Pairing</AlertTitle>
              Select a credit card and the system will automatically find the matching bank account
              based on repayment transactions.
            </Alert>

            {unpairedCreditCards.length === 0 ? (
              <Alert severity="success">
                All credit cards have been paired.
              </Alert>
            ) : (
              <>
                <TextField
                  fullWidth
                  select
                  label={t('autoPairing.selectCC')}
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
                  {unpairedCreditCards.map((account, idx) => {
                    const key = `${account.id}-${account.account_number || idx}`;
                    return (
                      <MenuItem key={key} value={`${account.id}-${account.account_number || 'undefined'}`}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <InstitutionBadge
                            institution={account.institution}
                            fallback={account.vendor}
                          />
                          <Typography variant="body2">
                            {getAccountDisplayName(account, false)}
                          </Typography>
                        </Box>
                      </MenuItem>
                    );
                  })}
                </TextField>

                {/* Auto-pairing results */}
                {selectedCreditCard && (
                  <Box sx={{ mt: 2 }}>
                    {autoDetecting ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                        <CircularProgress size={24} />
                        <Typography variant="body2">{t('autoPairing.detecting')}</Typography>
                      </Box>
                    ) : autoPairResult?.found ? (
                      <Box>
                        {/* Detected bank account */}
                        <Alert severity="success" sx={{ mb: 2 }}>
                          <AlertTitle>{t('autoPairing.detected')}</AlertTitle>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Typography variant="body2">
                              {autoPairResult.bankVendor} - {autoPairResult.bankAccountNumber || 'All accounts'}
                            </Typography>
                            <Chip
                              label={`${autoPairResult.matchingLast4Count || 0} card# matches, ${autoPairResult.matchingVendorCount || 0} vendor matches`}
                              size="small"
                              color="info"
                            />
                          </Box>

                          {/* Sample transactions */}
                          {autoPairResult.sampleTransactions && autoPairResult.sampleTransactions.length > 0 && (
                            <Box sx={{ mt: 1 }}>
                              <Typography variant="caption" color="text.secondary">
                                {t('autoPairing.sampleTransactions')}:
                              </Typography>
                              {autoPairResult.sampleTransactions.slice(0, 2).map((txn, idx) => (
                                <Typography key={idx} variant="caption" display="block" color="text.secondary">
                                  • {txn.name} (₪{Math.abs(txn.price).toLocaleString()})
                                </Typography>
                              ))}
                            </Box>
                          )}
                        </Alert>

                        {/* Discrepancy alert */}
                        {autoDiscrepancy && autoDiscrepancy.cycles && autoDiscrepancy.cycles.length > 0 && (
                          <RepaymentDiscrepancyList
                            discrepancy={autoDiscrepancy}
                            canResolve={Boolean(autoPairingId)}
                            onIgnoreCycle={handleIgnoreDiscrepancy}
                            onAddFeeForCycle={handleAddAsFee}
                            loading={discrepancyResolving}
                            ccVendor={selectedCreditCard?.vendor}
                          />
                        )}
                      </Box>
                    ) : autoPairResult && !autoPairResult.found ? (
                      <Alert severity="warning" sx={{ mb: 2 }}>
                        <AlertTitle>{t('autoPairing.noMatchFound')}</AlertTitle>
                        <Typography variant="body2">
                          {autoPairResult.reason || t('autoPairing.noMatchReason')}
                        </Typography>
                      </Alert>
                    ) : null}
                  </Box>
                )}
              </>
            )}
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose} disabled={autoCreatingPairing}>
            Cancel
          </Button>

          <Button
            onClick={handleAutoCreatePairing}
            variant="contained"
            color="primary"
            disabled={autoCreatingPairing || autoDetecting || !autoPairResult?.found}
            startIcon={autoCreatingPairing ? <CircularProgress size={20} /> : <LinkIcon />}
          >
            {t('autoPairing.createPairing')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Unpaired Transactions Dialog */}
      <UnpairedTransactionsDialog
        isOpen={showUnpairedDialog}
        onClose={() => {
          setShowUnpairedDialog(false);
          fetchUnpairableTransactionsCount();
        }}
      />

      {/* Reimbursements (cycle reconciliation) */}
      <Dialog open={reimbursementsDialogOpen} onClose={handleCloseReimbursements} maxWidth="md" fullWidth>
        <ModalHeader
          title="Credit Card Reimbursements"
          onClose={handleCloseReimbursements}
        />
        <DialogContent>
          {reimbursementsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : reimbursementsDiscrepancy ? (
            <RepaymentDiscrepancyList
              discrepancy={reimbursementsDiscrepancy}
              canResolve={Boolean(reimbursementsPairing?.id)}
              onIgnoreCycle={handleIgnoreReimbursementCycle}
              onAddFeeForCycle={handleAddFeeForReimbursementCycle}
              loading={discrepancyResolving}
              ccVendor={reimbursementsPairing?.creditCardVendor}
            />
          ) : (
            <Alert severity="info">
              <AlertTitle>Nothing to show</AlertTitle>
              Select a pairing to view reimbursements.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseReimbursements}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manual Matching Modal */}
      <ManualMatchingModal
        isOpen={showManualMatchingModal}
        onClose={handleCloseManualMatching}
        pairing={selectedPairingForMatching}
      />
    </>
  );
}
