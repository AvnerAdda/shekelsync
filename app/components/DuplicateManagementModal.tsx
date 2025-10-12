import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Tabs,
  Tab,
  Card,
  CardContent,
  Grid,
  Chip,
  IconButton,
  Alert,
  CircularProgress,
  Divider,
  Tooltip,
  Badge,
  LinearProgress,
} from '@mui/material';
import {
  Close as CloseIcon,
  Check as CheckIcon,
  Clear as DismissIcon,
  Link as LinkIcon,
  CompareArrows as CompareIcon,
  CreditCard as CreditCardIcon,
  AccountBalance as BankIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';
import ManualResolutionPanel from './ManualResolutionPanel';
import PatternSuggestionsPanel from './PatternSuggestionsPanel';

interface DuplicateManagementModalProps {
  open: boolean;
  onClose: () => void;
  onDuplicatesChanged: () => void;
}

interface DuplicatePair {
  id?: number;
  type: string;
  confidence: number;
  isConfirmed?: boolean;
  description?: string;
  transaction1?: any;
  transaction2?: any;
  creditCardTransaction?: any;
  bankTransaction?: any;
  amountDifference?: number;
  daysApart?: number;
}

const DuplicateManagementModal: React.FC<DuplicateManagementModalProps> = ({
  open,
  onClose,
  onDuplicatesChanged,
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<DuplicatePair[]>([]);
  const [confirmed, setConfirmed] = useState<DuplicatePair[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { formatCurrency } = useFinancePrivacy();

  useEffect(() => {
    if (open) {
      fetchDuplicates();
    }
  }, [open]);

  const fetchDuplicates = async () => {
    setLoading(true);
    try {
      // Fetch potential duplicates
      const suggestionsResponse = await fetch(
        '/api/analytics/detect-duplicates?excludeConfirmed=true&minConfidence=0.7'
      );
      const suggestionsData = await suggestionsResponse.json();
      setSuggestions(suggestionsData.duplicates || []);

      // Fetch confirmed duplicates
      const confirmedResponse = await fetch(
        '/api/analytics/detect-duplicates?includeConfirmed=true'
      );
      const confirmedData = await confirmedResponse.json();
      setConfirmed(confirmedData.duplicates.filter((d: any) => d.isConfirmed) || []);
    } catch (error) {
      console.error('Error fetching duplicates:', error);
    } finally {
      setLoading(false);
    }
  };

  const confirmDuplicate = async (duplicate: DuplicatePair) => {
    const pairId = JSON.stringify(duplicate);
    setProcessingId(pairId);

    try {
      let txn1, txn2;

      if (duplicate.type === 'credit_card_payment') {
        // For credit card payments, we need to link all CC transactions to the bank payment
        // For now, we'll just link the bank transaction identifier
        txn1 = {
          identifier: duplicate.bankTransaction.identifier,
          vendor: duplicate.bankTransaction.vendor
        };
        // Use a representative transaction from the credit card side
        // In practice, you might want to create multiple duplicate records
        txn2 = {
          identifier: duplicate.creditCardTransaction.sampleTransactions[0]?.identifier,
          vendor: duplicate.creditCardTransaction.vendor
        };
      } else {
        txn1 = {
          identifier: duplicate.transaction1.identifier,
          vendor: duplicate.transaction1.vendor
        };
        txn2 = {
          identifier: duplicate.transaction2.identifier,
          vendor: duplicate.transaction2.vendor
        };
      }

      const response = await fetch('/api/duplicates/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction1: txn1,
          transaction2: txn2,
          matchType: duplicate.type,
          confidence: duplicate.confidence,
        }),
      });

      if (response.ok) {
        // Remove from suggestions and add to confirmed
        setSuggestions(prev => prev.filter(d => JSON.stringify(d) !== pairId));
        await fetchDuplicates(); // Refresh both lists
        onDuplicatesChanged(); // Notify parent to refresh analytics
      } else {
        alert('Failed to confirm duplicate');
      }
    } catch (error) {
      console.error('Error confirming duplicate:', error);
      alert('Error confirming duplicate');
    } finally {
      setProcessingId(null);
    }
  };

  const dismissSuggestion = (duplicate: DuplicatePair) => {
    // Just remove from UI (could persist dismissals to DB if needed)
    const pairId = JSON.stringify(duplicate);
    setSuggestions(prev => prev.filter(d => JSON.stringify(d) !== pairId));
  };

  const unconfirmDuplicate = async (duplicate: DuplicatePair) => {
    if (!duplicate.id) return;

    const pairId = String(duplicate.id);
    setProcessingId(pairId);

    try {
      const response = await fetch(`/api/duplicates/${duplicate.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchDuplicates();
        onDuplicatesChanged();
      } else {
        alert('Failed to unconfirm duplicate');
      }
    } catch (error) {
      console.error('Error unconfirming duplicate:', error);
      alert('Error unconfirming duplicate');
    } finally {
      setProcessingId(null);
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

  const getMatchTypeIcon = (type: string) => {
    switch (type) {
      case 'credit_card_payment':
        return <CreditCardIcon />;
      case 'rent':
      case 'loan':
      case 'investment':
        return <BankIcon />;
      default:
        return <LinkIcon />;
    }
  };

  const getMatchTypeLabel = (type: string) => {
    const labels: { [key: string]: string } = {
      credit_card_payment: 'Credit Card Payment',
      rent: 'Rent Payment',
      investment: 'Investment',
      loan: 'Loan Payment',
      transfer: 'Transfer',
      manual: 'Manual Match',
      refund: 'Refund',
    };
    return labels[type] || type;
  };

  const getMatchTypeColor = (type: string) => {
    const colors: { [key: string]: any } = {
      credit_card_payment: 'primary',
      rent: 'secondary',
      investment: 'info',
      loan: 'warning',
      transfer: 'default',
      manual: 'default',
      refund: 'success',
    };
    return colors[type] || 'default';
  };

  const renderCreditCardDuplicate = (duplicate: DuplicatePair) => {
    const cc = duplicate.creditCardTransaction;
    const bank = duplicate.bankTransaction;
    const pairId = JSON.stringify(duplicate);
    const isProcessing = processingId === pairId;

    return (
      <Card
        key={pairId}
        sx={{
          mb: 2,
          border: '2px solid',
          borderColor: duplicate.confidence > 0.9 ? 'warning.main' : 'divider',
        }}
      >
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                icon={getMatchTypeIcon(duplicate.type)}
                label={getMatchTypeLabel(duplicate.type)}
                color={getMatchTypeColor(duplicate.type)}
                size="small"
              />
              <Chip
                label={`${(duplicate.confidence * 100).toFixed(0)}% match`}
                size="small"
                color={duplicate.confidence > 0.9 ? 'success' : 'default'}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="Confirm as duplicate">
                <IconButton
                  size="small"
                  color="success"
                  onClick={() => confirmDuplicate(duplicate)}
                  disabled={isProcessing}
                >
                  {isProcessing ? <CircularProgress size={20} /> : <CheckIcon />}
                </IconButton>
              </Tooltip>
              <Tooltip title="Dismiss suggestion">
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => dismissSuggestion(duplicate)}
                  disabled={isProcessing}
                >
                  <DismissIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          <Typography variant="body2" color="text.secondary" gutterBottom>
            {duplicate.description}
          </Typography>

          <Grid container spacing={2} sx={{ mt: 1 }}>
            {/* Credit Card Side */}
            <Grid item xs={12} md={6}>
              <Box sx={{ p: 2, bgcolor: 'error.50', borderRadius: 1, border: '1px solid', borderColor: 'error.200' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <CreditCardIcon color="error" fontSize="small" />
                  <Typography variant="subtitle2" fontWeight="bold">
                    Credit Card Expenses
                  </Typography>
                </Box>
                <Typography variant="h6" color="error.main" gutterBottom>
                  {formatCurrencyValue(cc.totalAmount)}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {cc.vendor} • {cc.accountNumber ? `****${cc.accountNumber}` : 'N/A'}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {cc.month} ({cc.transactionCount} transactions)
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {formatDate(cc.dateRange.start)} - {formatDate(cc.dateRange.end)}
                </Typography>

                {cc.sampleTransactions && cc.sampleTransactions.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" fontWeight="bold">Sample transactions:</Typography>
                    {cc.sampleTransactions.slice(0, 3).map((txn: any, idx: number) => (
                      <Typography key={idx} variant="caption" display="block" sx={{ pl: 1 }}>
                        • {formatDate(txn.date)}: {txn.name} ({formatCurrencyValue(txn.price)})
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            </Grid>

            {/* Bank Side */}
            <Grid item xs={12} md={6}>
              <Box sx={{ p: 2, bgcolor: 'primary.50', borderRadius: 1, border: '1px solid', borderColor: 'primary.200' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <BankIcon color="primary" fontSize="small" />
                  <Typography variant="subtitle2" fontWeight="bold">
                    Bank Debit
                  </Typography>
                </Box>
                <Typography variant="h6" color="primary.main" gutterBottom>
                  {formatCurrencyValue(bank.price)}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {bank.vendor} • {bank.accountNumber ? `****${bank.accountNumber}` : 'N/A'}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {formatDate(bank.date)}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {bank.name}
                </Typography>

                {duplicate.amountDifference !== undefined && duplicate.amountDifference > 0 && (
                  <Alert severity="info" sx={{ mt: 1, py: 0 }}>
                    <Typography variant="caption">
                      Difference: {formatCurrencyValue(duplicate.amountDifference)}
                    </Typography>
                  </Alert>
                )}
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    );
  };

  const renderRegularDuplicate = (duplicate: DuplicatePair) => {
    const txn1 = duplicate.transaction1;
    const txn2 = duplicate.transaction2;
    const pairId = duplicate.id ? String(duplicate.id) : JSON.stringify(duplicate);
    const isProcessing = processingId === pairId;
    const isConfirmed = duplicate.isConfirmed || false;

    return (
      <Card
        key={pairId}
        sx={{
          mb: 2,
          border: '2px solid',
          borderColor: isConfirmed ? 'success.main' : duplicate.confidence > 0.9 ? 'warning.main' : 'divider',
        }}
      >
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {isConfirmed && <Chip icon={<CheckIcon />} label="Confirmed" color="success" size="small" />}
              <Chip
                icon={getMatchTypeIcon(duplicate.type)}
                label={getMatchTypeLabel(duplicate.type)}
                color={getMatchTypeColor(duplicate.type)}
                size="small"
              />
              <Chip
                label={`${(duplicate.confidence * 100).toFixed(0)}% match`}
                size="small"
                color={duplicate.confidence > 0.9 ? 'success' : 'default'}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {!isConfirmed ? (
                <>
                  <Tooltip title="Confirm as duplicate">
                    <IconButton
                      size="small"
                      color="success"
                      onClick={() => confirmDuplicate(duplicate)}
                      disabled={isProcessing}
                    >
                      {isProcessing ? <CircularProgress size={20} /> : <CheckIcon />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Dismiss suggestion">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => dismissSuggestion(duplicate)}
                      disabled={isProcessing}
                    >
                      <DismissIcon />
                    </IconButton>
                  </Tooltip>
                </>
              ) : (
                <Tooltip title="Unmark as duplicate">
                  <IconButton
                    size="small"
                    color="warning"
                    onClick={() => unconfirmDuplicate(duplicate)}
                    disabled={isProcessing}
                  >
                    {isProcessing ? <CircularProgress size={20} /> : <DismissIcon />}
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>

          {duplicate.description && (
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {duplicate.description}
            </Typography>
          )}

          <Grid container spacing={2} sx={{ mt: 1 }}>
            {/* Transaction 1 */}
            <Grid item xs={12} md={6}>
              <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'grey.300' }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  Transaction 1
                </Typography>
                <Typography variant="h6" gutterBottom>
                  {formatCurrencyValue(txn1.price)}
                </Typography>
                <Typography variant="body2" gutterBottom>
                  {txn1.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {formatDate(txn1.date)} • {txn1.vendor}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  Category: {txn1.category}
                </Typography>
                {txn1.accountNumber && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Account: ****{txn1.accountNumber}
                  </Typography>
                )}
              </Box>
            </Grid>

            {/* Transaction 2 */}
            <Grid item xs={12} md={6}>
              <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'grey.300' }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  Transaction 2
                </Typography>
                <Typography variant="h6" gutterBottom>
                  {formatCurrencyValue(txn2.price)}
                </Typography>
                <Typography variant="body2" gutterBottom>
                  {txn2.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {formatDate(txn2.date)} • {txn2.vendor}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  Category: {txn2.category}
                </Typography>
                {txn2.accountNumber && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Account: ****{txn2.accountNumber}
                  </Typography>
                )}
              </Box>
            </Grid>
          </Grid>

          {duplicate.amountDifference !== undefined && duplicate.amountDifference > 0 && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="caption">
                Amount difference: {formatCurrencyValue(duplicate.amountDifference)}
                {duplicate.daysApart && ` • ${duplicate.daysApart} days apart`}
              </Typography>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">Duplicate Transaction Management</Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)} sx={{ mb: 2 }}>
          <Tab
            label={<Box sx={{ px: 1 }}>Pattern Suggestions</Box>}
          />
          <Tab
            label={
              <Badge badgeContent={confirmed.length} color="success">
                <Box sx={{ px: 1 }}>Confirmed</Box>
              </Badge>
            }
          />
          <Tab
            label={
              <Box sx={{ px: 1 }}>Manual Resolution</Box>
            }
          />
        </Tabs>

        {loading && <LinearProgress sx={{ mb: 2 }} />}

        {/* Pattern Suggestions Tab */}
        {activeTab === 0 && (
          <PatternSuggestionsPanel onDuplicatesChanged={onDuplicatesChanged} />
        )}

        {/* Confirmed Tab */}
        {activeTab === 1 && (
          <Box>
            {confirmed.length === 0 ? (
              <Alert severity="info">
                <Typography variant="body2">
                  No confirmed duplicates yet. Review suggestions in the first tab.
                </Typography>
              </Alert>
            ) : (
              <Box>
                {confirmed.map((duplicate) =>
                  duplicate.type === 'credit_card_payment'
                    ? renderCreditCardDuplicate(duplicate)
                    : renderRegularDuplicate(duplicate)
                )}
              </Box>
            )}
          </Box>
        )}

        {/* Manual Resolution Tab */}
        {activeTab === 2 && (
          <ManualResolutionPanel onTransactionsChanged={onDuplicatesChanged} />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default DuplicateManagementModal;
