/* eslint-disable react/no-unescaped-entities */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Collapse,
  List,
  ListItem,
  ListItemText,
  Stack,
  Divider,
  Menu,
  MenuItem
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  Close,
  Lightbulb,
  Link as LinkIcon,
  Add as AddIcon
} from '@mui/icons-material';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import { apiClient } from '@/lib/api-client';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '@renderer/shared/components/LicenseReadOnlyAlert';
import type {
  PendingPikadonSetup,
  PikadonDetailsInput,
} from '@renderer/types/investments';
import PikadonSetupDialog from './PikadonSetupDialog';
import {
  buildPikadonCandidateFromSuggestionTransaction,
} from './pikadon-linking';
import {
  findMatchingInvestmentAccounts,
  getInvestmentSuggestionKey,
} from './investment-account-suggestions-helpers';
import { linkSuggestionTransactionsBatch } from './investment-account-link-batch';

interface Transaction {
  transactionIdentifier: string;
  transactionVendor: string;
  transactionDate: string;
  transactionAmount: number;
  transactionName: string;
  confidence?: number;
}

interface Institution {
  id: number;
  vendor_code: string;
  display_name_he: string;
  display_name_en: string;
  institution_type: string;
  category: string;
  subcategory: string | null;
  logo_url: string | null;
  is_scrapable: boolean;
  scraper_company_id: string | null;
}

interface InvestmentAccount {
  id: number;
  account_name: string;
  account_type: string;
  institution?: Institution | null;
  current_value?: number;
  current_value_explicit?: number | null;
  total_invested?: number | null;
  currency: string;
}

interface GroupedSuggestion {
  categoryName?: string;
  suggestedAccountType: string;
  suggestedInstitution: string | null;
  suggestedAccountName: string;
  avgConfidence: number;
  transactions: Transaction[];
  totalAmount: number;
  transactionCount: number;
  dateRange: {
    earliest: string;
    latest: string;
  };
  matchingAccounts?: InvestmentAccount[];
}

interface PendingLinkBatch {
  accountId: number;
  accountName: string;
  suggestion: GroupedSuggestion;
  pikadonItems: PendingPikadonSetup[];
}

const ACCOUNT_TYPE_ICONS: Record<string, string> = {
  pension: '💼',
  provident: '🎓',
  study_fund: '📚',
  brokerage: '📈',
  crypto: '₿',
  savings: '💰',
  mutual_fund: '📊',
  bonds: '📄',
  real_estate: '🏠',
  other: '💵'
};

interface InvestmentAccountSuggestionsCardProps {
  onSuggestionCreated?: () => void;
  onCreateAccountClick?: (suggestion: GroupedSuggestion) => void;
}

export default function InvestmentAccountSuggestionsCard({
  onSuggestionCreated,
  onCreateAccountClick,
}: InvestmentAccountSuggestionsCardProps) {
  const { showNotification } = useNotification();

  const getSuggestionKey = useCallback(
    (suggestion: GroupedSuggestion) => getInvestmentSuggestionKey(suggestion),
    [],
  );
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<GroupedSuggestion[]>([]);
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<string>>(new Set());
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [investmentAccounts, setInvestmentAccounts] = useState<InvestmentAccount[]>([]);
  const [linkMenuAnchor, setLinkMenuAnchor] = useState<{ element: HTMLElement; suggestionKey: string } | null>(null);
  const [linkingInProgress, setLinkingInProgress] = useState(false);
  const [licenseAlertOpen, setLicenseAlertOpen] = useState(false);
  const [licenseAlertReason, setLicenseAlertReason] = useState<string | undefined>();
  const [pendingLinkBatch, setPendingLinkBatch] = useState<PendingLinkBatch | null>(null);

  useEffect(() => {
    fetchSuggestions();
    fetchInvestmentAccounts();

    const handleDataRefresh = () => {
      fetchSuggestions();
      fetchInvestmentAccounts();
    };

    window.addEventListener('dataRefresh', handleDataRefresh);
    return () => {
      window.removeEventListener('dataRefresh', handleDataRefresh);
    };
  }, []);

  const fetchInvestmentAccounts = async () => {
    try {
      const response = await apiClient.get('/api/investments/accounts');
      const data = response.data as any;
      setInvestmentAccounts(data.accounts || []);
    } catch (error) {
      console.error('Error fetching investment accounts:', error);
    }
  };

  const findMatchingAccounts = useCallback(
    (suggestion: GroupedSuggestion) =>
      findMatchingInvestmentAccounts(suggestion, investmentAccounts),
    [investmentAccounts],
  );

  const fetchSuggestions = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/api/investments/smart-suggestions?thresholdDays=90');
      const data = response.data as any;
      if (data.success) {
        setSuggestions(data.suggestions || []);
      } else {
        console.error('Failed to fetch suggestions:', data.error);
      }
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleExpand = (key: string) => {
    const newExpanded = new Set(expandedSuggestions);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedSuggestions(newExpanded);
  };

  const handleDismiss = async (suggestion: GroupedSuggestion) => {
    try {
      const transactionIdentifiers = suggestion.transactions.map(t => ({
        identifier: t.transactionIdentifier,
        vendor: t.transactionVendor
      }));

      const response = await apiClient.post('/api/investments/suggestions/dismiss', { transactionIdentifiers });

      if (!response.ok) {
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(response.data);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
        const data = response.data as any;
        throw new Error(data?.error || 'Failed to dismiss suggestion');
      }

      const data = response.data as any;

      if (data.success) {
        const newDismissed = new Set(dismissedSuggestions);
        newDismissed.add(getSuggestionKey(suggestion));
        setDismissedSuggestions(newDismissed);
        showNotification('Suggestion dismissed', 'info');
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error('Error dismissing suggestion:', error);
      showNotification('Failed to dismiss suggestion', 'error');
    }
  };

  const handleCreateAccount = (suggestion: GroupedSuggestion) => {
    if (onCreateAccountClick) {
      onCreateAccountClick(suggestion);
    }
  };

  const handleOpenLinkMenu = (event: React.MouseEvent<HTMLElement>, suggestionKey: string) => {
    setLinkMenuAnchor({ element: event.currentTarget, suggestionKey });
  };

  const handleCloseLinkMenu = () => {
    setLinkMenuAnchor(null);
  };

  const executeLinkBatch = async (
    suggestion: GroupedSuggestion,
    accountId: number,
    detailsByKey: Record<string, PikadonDetailsInput> = {},
  ) => {
    setLinkingInProgress(true);

    try {
      const batchResult = await linkSuggestionTransactionsBatch({
        transactions: suggestion.transactions,
        accountId,
        detailsByKey,
        postLink: (payload) => apiClient.post('/api/investments/transaction-links', payload),
      });

      if (!batchResult.ok) {
        const licenseCheck = isLicenseReadOnlyError(batchResult.response.data);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }

        const errorMessage =
          (batchResult.response.data as { error?: string } | null)?.error
          || 'Failed to link transactions';
        throw new Error(errorMessage);
      }

      showNotification(
        `Successfully linked ${suggestion.transactions.length} transaction${suggestion.transactions.length > 1 ? 's' : ''} to account`,
        'success',
      );
      if (onSuggestionCreated) {
        onSuggestionCreated();
      }
      window.dispatchEvent(new CustomEvent('dataRefresh'));
    } catch (error: any) {
      console.error('Error linking transactions:', error);
      window.dispatchEvent(new CustomEvent('dataRefresh'));
      showNotification(`Failed to link transactions: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      setLinkingInProgress(false);
      setPendingLinkBatch(null);
    }
  };

  const handleLinkToAccount = async (suggestion: GroupedSuggestion, accountId: number) => {
    handleCloseLinkMenu();

    const account = investmentAccounts.find((candidate) => candidate.id === accountId);
    const pikadonItems = suggestion.transactions
      .map((txn) => buildPikadonCandidateFromSuggestionTransaction(txn, accountId, account?.account_name))
      .filter((candidate): candidate is PendingPikadonSetup => Boolean(candidate));

    if (pikadonItems.length > 0) {
      setPendingLinkBatch({
        accountId,
        accountName: account?.account_name || 'Investment account',
        suggestion,
        pikadonItems,
      });
      return;
    }

    await executeLinkBatch(suggestion, accountId);
  };

  if (loading) {
    return (
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 2 }}>
          <Box display="flex" alignItems="center" justifyContent="center">
            <CircularProgress size={20} sx={{ mr: 1 }} />
            <Typography variant="body2">Loading suggestions...</Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  const visibleSuggestions = suggestions.filter((suggestion) => !dismissedSuggestions.has(getSuggestionKey(suggestion)));

  if (visibleSuggestions.length === 0) {
    return null;
  }

  return (
    <>
      <Card sx={{ mb: 2, border: (theme) => `1px solid ${theme.palette.divider}` }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box display="flex" alignItems="center" mb={1.5}>
            <Lightbulb sx={{ fontSize: 20, mr: 1, color: 'warning.main' }} />
            <Typography variant="subtitle2" fontWeight={600}>
              Smart Suggestions ({visibleSuggestions.length})
            </Typography>
          </Box>

          <Stack spacing={1}>
            {visibleSuggestions.map((suggestion) => {
              const suggestionKey = getSuggestionKey(suggestion);
              const matchingAccounts = findMatchingAccounts(suggestion);
              const hasMatches = matchingAccounts.length > 0;
              const isExpanded = expandedSuggestions.has(suggestionKey);

              return (
                <Card
                  key={suggestionKey}
                  variant="outlined"
                  sx={{
                    bgcolor: 'background.paper',
                    border: hasMatches ? '1.5px solid' : '1px solid',
                    borderColor: hasMatches ? 'success.main' : 'divider'
                  }}
                >
                  <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                    {/* Compact Row Layout */}
                    <Box display="flex" alignItems="center" gap={1.5}>
                      {/* LEFT: Description */}
                      <Box flex={1} minWidth={0}>
                        <Box display="flex" alignItems="center" gap={0.5} mb={0.25}>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {ACCOUNT_TYPE_ICONS[suggestion.suggestedAccountType] || '💼'}{' '}
                            {suggestion.categoryName || suggestion.suggestedAccountName}
                          </Typography>
                          {hasMatches && (
                            <Chip
                              label={matchingAccounts.length}
                              size="small"
                              color="success"
                              sx={{ height: 18, fontSize: '0.65rem', minWidth: 24 }}
                            />
                          )}
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>
                          {suggestion.transactionCount} txns • ₪{suggestion.totalAmount.toLocaleString()}
                          {suggestion.suggestedInstitution && ` • ${suggestion.suggestedInstitution}`}
                        </Typography>
                      </Box>

                      {/* RIGHT: Actions */}
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        {hasMatches && (
                          <Button
                            variant="contained"
                            color="success"
                            size="small"
                            disabled={linkingInProgress}
                            startIcon={linkingInProgress ? <CircularProgress size={14} /> : <LinkIcon />}
                            onClick={(e) => handleOpenLinkMenu(e, suggestionKey)}
                            sx={{
                              textTransform: 'none',
                              fontSize: '0.7rem',
                              py: 0.5,
                              px: 1,
                              minWidth: 60
                            }}
                          >
                            Link
                          </Button>
                        )}
                        <Button
                          variant={hasMatches ? "outlined" : "contained"}
                          color="primary"
                          size="small"
                          startIcon={<AddIcon />}
                          onClick={() => handleCreateAccount(suggestion)}
                          sx={{
                            textTransform: 'none',
                            fontSize: '0.7rem',
                            py: 0.5,
                            px: 1,
                            minWidth: 70
                          }}
                        >
                          Create
                        </Button>
                        <IconButton
                          size="small"
                          onClick={() => handleDismiss(suggestion)}
                          sx={{ p: 0.5 }}
                          aria-label="Dismiss suggestion"
                        >
                          <Close fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Box>

                    {/* Expandable Transactions */}
                    {suggestion.transactions.length > 0 && (
                      <>
                        <Divider sx={{ my: 1 }} />
                        <Button
                          size="small"
                          onClick={() => handleToggleExpand(suggestionKey)}
                          endIcon={isExpanded ? <ExpandLess /> : <ExpandMore />}
                          sx={{
                            textTransform: 'none',
                            fontSize: '0.65rem',
                            py: 0.25,
                            color: 'text.secondary'
                          }}
                        >
                          {isExpanded ? 'Hide' : 'Show'} {suggestion.transactions.length} transactions
                        </Button>

                        <Collapse in={isExpanded}>
                          <List dense sx={{
                            mt: 0.5,
                            bgcolor: 'action.hover',
                            borderRadius: 1,
                            maxHeight: 200,
                            overflow: 'auto'
                          }}>
                            {suggestion.transactions.map((txn, txnIndex) => (
                              <ListItem key={txnIndex} sx={{ py: 0.5 }}>
                                <ListItemText
                                  primary={txn.transactionName}
                                  secondary={`${new Date(txn.transactionDate).toLocaleDateString('he-IL')} • ₪${Math.abs(txn.transactionAmount).toLocaleString()}`}
                                  primaryTypographyProps={{
                                    variant: 'caption',
                                    fontWeight: 500,
                                    sx: { fontSize: '0.7rem' }
                                  }}
                                  secondaryTypographyProps={{
                                    variant: 'caption',
                                    sx: { fontSize: '0.65rem' }
                                  }}
                                />
                              </ListItem>
                            ))}
                          </List>
                        </Collapse>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        </CardContent>
      </Card>

      <PikadonSetupDialog
        open={Boolean(pendingLinkBatch)}
        title={pendingLinkBatch ? `Complete pikadon setup for ${pendingLinkBatch.accountName}` : 'Complete pikadon setup'}
        items={pendingLinkBatch?.pikadonItems || []}
        loading={linkingInProgress}
        saveLabel="Save and link"
        onClose={() => setPendingLinkBatch(null)}
        onSubmit={async (detailsByKey) => {
          if (!pendingLinkBatch) {
            return;
          }
          await executeLinkBatch(
            pendingLinkBatch.suggestion,
            pendingLinkBatch.accountId,
            detailsByKey,
          );
        }}
      />

      {/* Link Menu */}
      <Menu
        anchorEl={linkMenuAnchor?.element}
        open={Boolean(linkMenuAnchor)}
        onClose={handleCloseLinkMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {linkMenuAnchor && (() => {
          const suggestion = visibleSuggestions.find(
            (item) => getSuggestionKey(item) === linkMenuAnchor.suggestionKey
          );
          if (!suggestion) {
            return null;
          }
          const matchingAccounts = findMatchingAccounts(suggestion);

          return matchingAccounts.map((account) => (
            <MenuItem
              key={account.id}
              onClick={() => handleLinkToAccount(suggestion, account.id)}
              sx={{ fontSize: '0.8rem', minWidth: 200 }}
            >
              <Box>
                <Typography variant="body2" fontWeight={500}>
                  {account.account_name}
                </Typography>
                {account.current_value && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {account.currency} {account.current_value.toLocaleString()}
                    </Typography>
                    {!account.current_value_explicit && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', fontStyle: 'italic', ml: 0.5 }}>
                        (calc)
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            </MenuItem>
          ));
        })()}
      </Menu>

      <LicenseReadOnlyAlert
        open={licenseAlertOpen}
        onClose={() => setLicenseAlertOpen(false)}
        reason={licenseAlertReason}
      />
    </>
  );
}
