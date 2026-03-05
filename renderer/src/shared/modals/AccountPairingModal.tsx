import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import PairingMatchDetailsModal from './PairingMatchDetailsModal';
import { apiClient } from '@/lib/api-client';
import type { PairingMatchDetailsResponse, PairingMatchSummary } from '@renderer/types/accounts';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '@renderer/shared/components/LicenseReadOnlyAlert';

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

type PairingForDetails = NonNullable<AutoPairResult['pairing']>;

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

const RELOAD_MONTHS_BACK = 6;

interface PairingStatsState {
  loading: boolean;
  summary?: PairingMatchSummary;
  error?: string;
}

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

function buildCreditCardAccountsSignature(accounts: Account[]): string {
  return accounts
    .map((account) => {
      const numbers = extractAccountNumbers(account).sort().join(',');
      return [
        account.id,
        account.vendor,
        account.nickname || '',
        account.card6_digits || '',
        account.account_number || '',
        numbers,
      ].join('::');
    })
    .sort()
    .join('||');
}

export default function AccountPairingModal({
  isOpen,
  onClose,
  creditCardAccounts = [],
}: AccountPairingModalProps) {
  const wasOpenRef = useRef(false);
  const lastAccountSignatureRef = useRef('');
  const pairingStatsByIdRef = useRef<Record<number, PairingStatsState>>({});
  const accountSignature = useMemo(
    () => buildCreditCardAccountsSignature(creditCardAccounts),
    [creditCardAccounts],
  );
  const [expandedAccounts, setExpandedAccounts] = useState<Account[]>([]);
  const [existingPairings, setExistingPairings] = useState<Pairing[]>([]);
  const [pairingsLoaded, setPairingsLoaded] = useState(false);
  const [autoPairingBatchLoading, setAutoPairingBatchLoading] = useState(false);
  const [autoPairingBatchDone, setAutoPairingBatchDone] = useState(false);
  const [autoPairingBatchResults, setAutoPairingBatchResults] = useState<AutoPairingBatchResult[]>([]);
  const [selectedPairingForDetails, setSelectedPairingForDetails] = useState<PairingForDetails | null>(null);
  const [pairingStatsById, setPairingStatsById] = useState<Record<number, PairingStatsState>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [licenseAlertOpen, setLicenseAlertOpen] = useState(false);
  const [licenseAlertReason, setLicenseAlertReason] = useState<string | undefined>();

  useEffect(() => {
    pairingStatsByIdRef.current = pairingStatsById;
  }, [pairingStatsById]);

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
          // Check for license read-only error
          const licenseCheck = isLicenseReadOnlyError(response.data);
          if (licenseCheck.isReadOnly) {
            setLicenseAlertReason(licenseCheck.reason);
            setLicenseAlertOpen(true);
            return {
              key: `${account.vendor}::${accountNumber || 'all'}`,
              account,
              status: 'error',
              reason: 'License is in read-only mode',
            } satisfies AutoPairingBatchResult;
          }
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
    const wasOpen = wasOpenRef.current;

    if (isOpen && !wasOpen) {
      lastAccountSignatureRef.current = accountSignature;
      setAutoPairingBatchDone(false);
      setAutoPairingBatchResults([]);
      setAutoPairingBatchLoading(false);
      setSelectedPairingForDetails(null);
      setPairingStatsById({});
      pairingStatsByIdRef.current = {};
      setErrorMessage(null);
      expandCreditCardAccounts();
      fetchExistingPairings();
      wasOpenRef.current = true;
      return;
    }

    if (!isOpen && wasOpen) {
      setExpandedAccounts([]);
      setExistingPairings([]);
      setAutoPairingBatchDone(false);
      setAutoPairingBatchResults([]);
      setAutoPairingBatchLoading(false);
      setPairingsLoaded(false);
      setSelectedPairingForDetails(null);
      setPairingStatsById({});
      pairingStatsByIdRef.current = {};
      setErrorMessage(null);
      lastAccountSignatureRef.current = '';
      wasOpenRef.current = false;
    }
  }, [isOpen, accountSignature, expandCreditCardAccounts, fetchExistingPairings]);

  useEffect(() => {
    if (!isOpen || !wasOpenRef.current) {
      return;
    }
    if (lastAccountSignatureRef.current === accountSignature) {
      return;
    }

    lastAccountSignatureRef.current = accountSignature;
    setAutoPairingBatchDone(false);
    setAutoPairingBatchResults([]);
    setAutoPairingBatchLoading(false);
    setSelectedPairingForDetails(null);
    setPairingStatsById({});
    pairingStatsByIdRef.current = {};
    setErrorMessage(null);
    expandCreditCardAccounts();
    fetchExistingPairings();
  }, [isOpen, accountSignature, expandCreditCardAccounts, fetchExistingPairings]);

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

  useEffect(() => {
    if (!isOpen || !autoPairingBatchDone || autoPairingBatchLoading) {
      return;
    }

    const pairingIds = Array.from(new Set(
      autoPairingBatchResults
        .filter((result) => Boolean(result.pairing) && (result.status === 'paired' || result.status === 'existing'))
        .map((result) => result.pairing?.id)
        .filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0),
    ));

    const currentStats = pairingStatsByIdRef.current;
    const idsToFetch = pairingIds.filter((pairingId) => !currentStats[pairingId]);
    if (idsToFetch.length === 0) {
      return;
    }

    let cancelled = false;

    setPairingStatsById((prev) => {
      const next = { ...prev };
      idsToFetch.forEach((pairingId) => {
        if (!next[pairingId]) {
          next[pairingId] = { loading: true };
        }
      });
      return next;
    });

    Promise.all(idsToFetch.map(async (pairingId) => {
      try {
        const response = await apiClient.get<PairingMatchDetailsResponse | { error?: string }>(
          `/api/accounts/pairing/${pairingId}/match-details?monthsBack=${RELOAD_MONTHS_BACK}`,
        );

        if (!response.ok) {
          const apiError = typeof response.data === 'object' && response.data && 'error' in response.data
            ? String(response.data.error || 'Stats unavailable')
            : 'Stats unavailable';
          throw new Error(apiError);
        }

        return {
          pairingId,
          loading: false,
          summary: (response.data as PairingMatchDetailsResponse).summary,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Stats unavailable';
        return {
          pairingId,
          loading: false,
          error: message,
        };
      }
    })).then((results) => {
      if (cancelled) return;
      setPairingStatsById((prev) => {
        const next = { ...prev };
        results.forEach((result) => {
          next[result.pairingId] = result;
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, autoPairingBatchDone, autoPairingBatchLoading, autoPairingBatchResults]);

  const handleClose = () => {
    setAutoPairingBatchDone(false);
    setAutoPairingBatchResults([]);
    setAutoPairingBatchLoading(false);
    setSelectedPairingForDetails(null);
    setErrorMessage(null);
    onClose();
  };

  const handleDialogClose = (
    _event: object,
    reason: 'backdropClick' | 'escapeKeyDown',
  ) => {
    if (reason === 'backdropClick') {
      return;
    }
    handleClose();
  };

  return (
    <Dialog open={isOpen} onClose={handleDialogClose} maxWidth="md" fullWidth>
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
              const isDetailsAvailable = Boolean(result.pairing) && (result.status === 'paired' || result.status === 'existing');
              const secondaryText = result.reason
                || (result.status === 'existing' ? 'Pairing already exists' : '')
                || (isDetailsAvailable ? 'Click to view transaction matching details' : '');
              const statsState = result.pairing ? pairingStatsById[result.pairing.id] : undefined;

              return (
                <ListItem
                  key={result.key}
                  onClick={isDetailsAvailable ? () => {
                    if (result.pairing) {
                      setSelectedPairingForDetails(result.pairing);
                    }
                  } : undefined}
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    mb: 1,
                    ...(isDetailsAvailable ? {
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' },
                    } : {}),
                  }}
                >
                  <ListItemText
                    primary={primary}
                    secondaryTypographyProps={{ component: 'div' }}
                    secondary={(
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {secondaryText ? (
                          <Typography variant="body2" color="text.secondary">{secondaryText}</Typography>
                        ) : null}
                        {isDetailsAvailable ? (
                          statsState?.loading ? (
                            <Typography variant="caption" color="text.secondary">Loading match stats...</Typography>
                          ) : statsState?.summary ? (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                              <Chip label={`Cycles: ${statsState.summary.cyclesCount}`} size="small" variant="outlined" />
                              <Chip label={`Repayments: ${statsState.summary.repaymentCount}`} size="small" variant="outlined" />
                              <Chip label={`Card Txns: ${statsState.summary.cardTransactionCount}`} size="small" variant="outlined" />
                              <Chip label={`Bank Total: ${new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(statsState.summary.totalBankAmount)}`} size="small" variant="outlined" />
                              <Chip label={`Card Total: ${new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(statsState.summary.totalCardAmount)}`} size="small" variant="outlined" />
                              <Chip label={`Matched: ${statsState.summary.statusCounts.matched}`} size="small" color="success" variant="outlined" />
                              <Chip label={`Partial: ${statsState.summary.statusCounts.partial}`} size="small" color="warning" variant="outlined" />
                              <Chip label={`Unmatched: ${statsState.summary.statusCounts.unmatched}`} size="small" color="error" variant="outlined" />
                              <Chip label={`Ambiguous: ${statsState.summary.statusCounts.ambiguous}`} size="small" color="info" variant="outlined" />
                            </Box>
                          ) : statsState?.error ? (
                            <Typography variant="caption" color="warning.main">Match stats unavailable</Typography>
                          ) : null
                        ) : null}
                      </Box>
                    )}
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

      <LicenseReadOnlyAlert
        open={licenseAlertOpen}
        onClose={() => setLicenseAlertOpen(false)}
        reason={licenseAlertReason}
      />

      <PairingMatchDetailsModal
        isOpen={Boolean(selectedPairingForDetails)}
        onClose={() => setSelectedPairingForDetails(null)}
        pairing={selectedPairingForDetails}
      />
    </Dialog>
  );
}
