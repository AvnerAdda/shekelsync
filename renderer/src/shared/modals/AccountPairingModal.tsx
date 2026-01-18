import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Alert,
} from '@mui/material';
import ModalHeader from './ModalHeader';
import { apiClient } from '@/lib/api-client';

interface Account {
  id: number;
  vendor: string;
  nickname?: string;
  card6_digits?: string;
  accountNumbers?: string[];
  account_number?: string;
}

interface Pairing {
  id: number;
  creditCardVendor: string;
  creditCardAccountNumber: string | null;
  bankVendor: string;
  bankAccountNumber: string | null;
  isActive: boolean;
}

interface PairingsResponse {
  pairings: Pairing[];
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
}

interface AutoPairingBatchResult {
  key: string;
  account: Account;
  status: 'paired' | 'existing' | 'missing' | 'error';
  pairing?: AutoPairResult['pairing'];
  reason?: string;
}

interface AccountPairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  creditCardAccounts?: Account[];
}

const statusMeta = {
  paired: { label: 'Paired', color: 'success' },
  existing: { label: 'Already paired', color: 'info' },
  missing: { label: 'Missing', color: 'warning' },
  error: { label: 'Error', color: 'error' },
} as const;

function extractAccountNumbers(account: Account): string[] {
  const fromTransactions = Array.isArray(account.accountNumbers)
    ? account.accountNumbers.map((num) => String(num || '').trim()).filter(Boolean)
    : [];

  if (fromTransactions.length > 0) {
    return fromTransactions;
  }

  const fromCardDigits = (account.card6_digits || '')
    .split(';')
    .map((num) => String(num || '').trim())
    .filter(Boolean);

  if (fromCardDigits.length > 0) {
    return fromCardDigits;
  }

  if (account.account_number) {
    return [account.account_number];
  }

  return [];
}

function getMaskedNumber(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 4 ? `****${trimmed.slice(-4)}` : trimmed;
}

function getAccountDisplayName(account: Account): string {
  const parts: string[] = [];
  parts.push(account.vendor);

  if (account.nickname) {
    parts.push(account.nickname);
  }

  const masked = getMaskedNumber(account.account_number || account.card6_digits || undefined);
  if (masked) {
    parts.push(masked);
  }

  return parts.join(' - ');
}

export default function AccountPairingModal({
  isOpen,
  onClose,
  creditCardAccounts = [],
}: AccountPairingModalProps) {
  const [expandedAccounts, setExpandedAccounts] = useState<Account[]>([]);
  const [existingPairings, setExistingPairings] = useState<Pairing[]>([]);
  const [pairingsLoaded, setPairingsLoaded] = useState(false);
  const [autoPairingBatchLoading, setAutoPairingBatchLoading] = useState(false);
  const [autoPairingBatchDone, setAutoPairingBatchDone] = useState(false);
  const [autoPairingBatchResults, setAutoPairingBatchResults] = useState<AutoPairingBatchResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const expandCreditCardAccounts = useCallback(() => {
    const expanded: Account[] = [];
    const seen = new Set<string>();

    creditCardAccounts.forEach((account) => {
      const numbers = extractAccountNumbers(account);
      if (numbers.length === 0) {
        const key = `${account.vendor}::all`;
        if (!seen.has(key)) {
          seen.add(key);
          expanded.push({ ...account, account_number: undefined });
        }
        return;
      }

      numbers.forEach((num) => {
        const key = `${account.vendor}::${num}`;
        if (seen.has(key)) return;
        seen.add(key);
        expanded.push({ ...account, account_number: num });
      });
    });

    setExpandedAccounts(expanded);
  }, [creditCardAccounts]);

  const fetchExistingPairings = useCallback(async () => {
    setPairingsLoaded(false);
    setErrorMessage(null);

    try {
      const response = await apiClient.get<PairingsResponse>('/api/accounts/pairing');
      if (!response.ok) {
        throw new Error('Failed to load pairings');
      }
      setExistingPairings(response.data?.pairings ?? []);
    } catch (error) {
      console.error('Error fetching pairings:', error);
      setExistingPairings([]);
      setErrorMessage('Failed to load existing pairings.');
    } finally {
      setPairingsLoaded(true);
    }
  }, []);

  const findActivePairingForAccount = useCallback((account: Account, accountNumber: string | null) => {
    return existingPairings.find((pairing) => {
      if (!pairing.isActive) return false;
      if (pairing.creditCardVendor !== account.vendor) return false;
      return !pairing.creditCardAccountNumber || pairing.creditCardAccountNumber === accountNumber;
    });
  }, [existingPairings]);

  const handleAutoPairAll = useCallback(async () => {
    if (autoPairingBatchLoading) return;

    setAutoPairingBatchLoading(true);
    setAutoPairingBatchResults([]);

    const alreadyPairedResults: AutoPairingBatchResult[] = [];
    const candidates: Account[] = [];
    const seenCandidates = new Set<string>();

    expandedAccounts.forEach((account) => {
      const accountNumber = account.account_number || account.card6_digits || null;
      const pairing = findActivePairingForAccount(account, accountNumber);
      const key = `${account.vendor}::${accountNumber || 'all'}`;

      if (pairing) {
        alreadyPairedResults.push({
          key,
          account,
          status: 'existing',
          pairing: {
            id: pairing.id,
            creditCardVendor: pairing.creditCardVendor,
            creditCardAccountNumber: pairing.creditCardAccountNumber,
            bankVendor: pairing.bankVendor,
            bankAccountNumber: pairing.bankAccountNumber,
            matchPatterns: [],
          },
        });
        return;
      }

      if (seenCandidates.has(key)) return;
      seenCandidates.add(key);
      candidates.push(account);
    });

    const results = await Promise.all(candidates.map(async (account) => {
      const accountNumber = account.account_number || account.card6_digits || null;
      try {
        const response = await apiClient.post<AutoPairResult>('/api/accounts/auto-pair', {
          creditCardVendor: account.vendor,
          creditCardAccountNumber: accountNumber,
          applyTransactions: true,
        });

        if (!response.ok || !response.data) {
          return {
            key: `${account.vendor}::${accountNumber || 'all'}`,
            account,
            status: 'error',
            reason: 'Failed to auto-pair this card',
          } satisfies AutoPairingBatchResult;
        }

        if (!response.data.success) {
          return {
            key: `${account.vendor}::${accountNumber || 'all'}`,
            account,
            status: 'missing',
            reason: response.data.reason || 'No matching bank account found',
          } satisfies AutoPairingBatchResult;
        }

        return {
          key: `${account.vendor}::${accountNumber || 'all'}`,
          account,
          status: response.data.wasCreated ? 'paired' : 'existing',
          pairing: response.data.pairing,
        } satisfies AutoPairingBatchResult;
      } catch (error) {
        console.error('Auto-pair batch error:', error);
        return {
          key: `${account.vendor}::${accountNumber || 'all'}`,
          account,
          status: 'error',
          reason: 'Failed to auto-pair this card',
        } satisfies AutoPairingBatchResult;
      }
    }));

    setAutoPairingBatchResults([...alreadyPairedResults, ...results]);
    setAutoPairingBatchLoading(false);
    setAutoPairingBatchDone(true);
  }, [autoPairingBatchLoading, expandedAccounts, findActivePairingForAccount]);

  useEffect(() => {
    if (!isOpen) {
      setExpandedAccounts([]);
      setExistingPairings([]);
      setAutoPairingBatchDone(false);
      setAutoPairingBatchResults([]);
      setAutoPairingBatchLoading(false);
      setPairingsLoaded(false);
      setErrorMessage(null);
      return;
    }

    setAutoPairingBatchDone(false);
    setAutoPairingBatchResults([]);
    setAutoPairingBatchLoading(false);
    setErrorMessage(null);
    expandCreditCardAccounts();
    fetchExistingPairings();
  }, [isOpen, expandCreditCardAccounts, fetchExistingPairings]);

  useEffect(() => {
    if (!isOpen) return;
    if (autoPairingBatchDone || autoPairingBatchLoading) return;
    if (!pairingsLoaded) return;
    if (errorMessage) return;

    if (expandedAccounts.length === 0) {
      setAutoPairingBatchDone(true);
      return;
    }

    handleAutoPairAll();
  }, [
    isOpen,
    autoPairingBatchDone,
    autoPairingBatchLoading,
    pairingsLoaded,
    expandedAccounts,
    errorMessage,
    handleAutoPairAll,
  ]);

  const handleClose = () => {
    setAutoPairingBatchDone(false);
    setAutoPairingBatchResults([]);
    setAutoPairingBatchLoading(false);
    setErrorMessage(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onClose={handleClose} maxWidth="md" fullWidth>
      <ModalHeader title="Account Pairing" onClose={handleClose} />
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Pairing credit cards to their bank repayments automatically.
        </Typography>

        {errorMessage ? (
          <Alert severity="error">{errorMessage}</Alert>
        ) : autoPairingBatchLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            <CircularProgress size={24} />
            <Typography variant="body2">Auto-pairing credit cards...</Typography>
          </Box>
        ) : !autoPairingBatchDone ? (
          <Alert severity="info">Preparing auto-pairing...</Alert>
        ) : autoPairingBatchResults.length === 0 ? (
          <Alert severity="success">All credit cards are paired.</Alert>
        ) : (
          <List>
            {autoPairingBatchResults.map((result) => {
              const meta = statusMeta[result.status];
              const bankLabel = result.pairing
                ? `${result.pairing.bankVendor}${result.pairing.bankAccountNumber ? ` • ${result.pairing.bankAccountNumber}` : ''}`
                : 'No bank match';
              const primary = `${getAccountDisplayName(result.account)} → ${bankLabel}`;

              return (
                <ListItem key={result.key} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 1 }}>
                  <ListItemText
                    primary={primary}
                    secondary={result.reason || (result.status === 'existing' ? 'Pairing already exists' : '')}
                  />
                  <Chip label={meta.label} size="small" color={meta.color} sx={{ ml: 2 }} />
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
