import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Button,
  Chip,
  Alert,
  CircularProgress,
  Divider,
  IconButton,
  Collapse,
  List,
  ListItem,
  ListItemText,
  Grid
} from '@mui/material';
import {
  TrendingUp,
  ExpandMore,
  ExpandLess,
  Close,
  AccountBalance,
  Lightbulb
} from '@mui/icons-material';
import SmartInvestmentAccountForm from './SmartInvestmentAccountForm';
import { useNotification } from './NotificationContext';

interface Transaction {
  transactionIdentifier: string;
  transactionVendor: string;
  transactionDate: string;
  transactionAmount: number;
  transactionName: string;
  confidence?: number;
}

interface GroupedSuggestion {
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
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  pension: 'קרן פנסיה',
  provident: 'קרן השתלמות',
  study_fund: 'קופת גמל',
  brokerage: 'ברוקר',
  crypto: 'קריפטו',
  savings: 'פיקדון',
  mutual_fund: 'קרן נאמנות',
  bonds: 'אג"ח',
  real_estate: 'נדל"ן',
  other: 'אחר'
};

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
}

export default function InvestmentAccountSuggestionsCard({
  onSuggestionCreated
}: InvestmentAccountSuggestionsCardProps) {
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<GroupedSuggestion[]>([]);
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<number>>(new Set());
  const [selectedSuggestion, setSelectedSuggestion] = useState<GroupedSuggestion | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchSuggestions();

    // Listen for data refresh events
    const handleDataRefresh = () => {
      fetchSuggestions();
    };

    window.addEventListener('dataRefresh', handleDataRefresh);

    return () => {
      window.removeEventListener('dataRefresh', handleDataRefresh);
    };
  }, []);

  const fetchSuggestions = async () => {
    setLoading(true);

    try {
      const response = await fetch('/api/investments/suggestions/pending?thresholdDays=90');
      const data = await response.json();

      if (data.success) {
        setSuggestions(data.suggestions || []);
      } else {
        console.error('Failed to fetch suggestions:', data.error);
      }
    } catch (error) {
      console.error('Error fetching investment suggestions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleExpand = (index: number) => {
    const newExpanded = new Set(expandedSuggestions);

    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }

    setExpandedSuggestions(newExpanded);
  };

  const handleDismiss = async (suggestion: GroupedSuggestion, index: number) => {
    try {
      const transactionIdentifiers = suggestion.transactions.map(t => ({
        identifier: t.transactionIdentifier,
        vendor: t.transactionVendor
      }));

      const response = await fetch('/api/investments/suggestions/dismiss', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ transactionIdentifiers })
      });

      const data = await response.json();

      if (data.success) {
        // Add to dismissed set
        const newDismissed = new Set(dismissedSuggestions);
        newDismissed.add(index);
        setDismissedSuggestions(newDismissed);

        showNotification('ההצעה נדחתה. תופיע שוב לאחר 3 עסקאות נוספות.', 'info');
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error('Error dismissing suggestion:', error);
      showNotification('שגיאה בדחיית ההצעה', 'error');
    }
  };

  const handleCreateAccount = (suggestion: GroupedSuggestion) => {
    setSelectedSuggestion(suggestion);
    setFormOpen(true);
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setSelectedSuggestion(null);
  };

  const handleFormSuccess = () => {
    fetchSuggestions();

    if (onSuggestionCreated) {
      onSuggestionCreated();
    }
  };

  if (loading) {
    return (
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="center" p={3}>
            <CircularProgress size={30} sx={{ mr: 2 }} />
            <Typography>טוען המלצות חכמות...</Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  const visibleSuggestions = suggestions.filter((_, index) => !dismissedSuggestions.has(index));

  if (visibleSuggestions.length === 0) {
    return null; // Don't show card if no suggestions
  }

  return (
    <>
      <Card
        sx={{
          mb: 3,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white'
        }}
      >
        <CardContent>
          <Box display="flex" alignItems="center" mb={2}>
            <Lightbulb sx={{ fontSize: 32, mr: 1 }} />
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              💡 המלצות חכמות - חשבונות השקעה
            </Typography>
          </Box>

          <Alert
            severity="info"
            sx={{
              mb: 2,
              bgcolor: 'rgba(255, 255, 255, 0.9)',
              '& .MuiAlert-icon': { color: '#667eea' }
            }}
          >
            <Typography variant="body2">
              זיהינו {visibleSuggestions.length} חשבונות השקעה פוטנציאליים בהתבסס על העסקאות שסיווגת.
              לחץ על "צור חשבון" כדי להתחיל.
            </Typography>
          </Alert>

          <Box>
            {visibleSuggestions.map((suggestion, index) => (
              <Card
                key={index}
                sx={{
                  mb: 2,
                  bgcolor: 'rgba(255, 255, 255, 0.95)',
                  '&:last-child': { mb: 0 }
                }}
              >
                <CardContent>
                  <Box display="flex" alignItems="flex-start" justifyContent="space-between">
                    <Box flexGrow={1}>
                      <Box display="flex" alignItems="center" mb={1}>
                        <Typography variant="h6" sx={{ mr: 1 }}>
                          {ACCOUNT_TYPE_ICONS[suggestion.suggestedAccountType] || '💼'}{' '}
                          {suggestion.suggestedAccountName}
                        </Typography>
                        <Chip
                          label={`${Math.round(suggestion.avgConfidence * 100)}% ביטחון`}
                          size="small"
                          color={suggestion.avgConfidence >= 0.8 ? 'success' : 'warning'}
                        />
                      </Box>

                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        {ACCOUNT_TYPE_LABELS[suggestion.suggestedAccountType]}
                        {suggestion.suggestedInstitution && ` | ${suggestion.suggestedInstitution}`}
                      </Typography>

                      <Grid container spacing={2} sx={{ mt: 1 }}>
                        <Grid item xs={12} sm={4}>
                          <Typography variant="caption" color="text.secondary">
                            עסקאות
                          </Typography>
                          <Typography variant="body1" fontWeight="bold">
                            {suggestion.transactionCount}
                          </Typography>
                        </Grid>

                        <Grid item xs={12} sm={4}>
                          <Typography variant="caption" color="text.secondary">
                            סכום כולל
                          </Typography>
                          <Typography variant="body1" fontWeight="bold">
                            ₪{suggestion.totalAmount.toLocaleString()}
                          </Typography>
                        </Grid>

                        <Grid item xs={12} sm={4}>
                          <Typography variant="caption" color="text.secondary">
                            טווח תאריכים
                          </Typography>
                          <Typography variant="body2">
                            {new Date(suggestion.dateRange.earliest).toLocaleDateString('he-IL')} -{' '}
                            {new Date(suggestion.dateRange.latest).toLocaleDateString('he-IL')}
                          </Typography>
                        </Grid>
                      </Grid>

                      {/* Expandable transaction list */}
                      <Box mt={2}>
                        <Button
                          size="small"
                          onClick={() => handleToggleExpand(index)}
                          endIcon={
                            expandedSuggestions.has(index) ? <ExpandLess /> : <ExpandMore />
                          }
                        >
                          {expandedSuggestions.has(index) ? 'הסתר עסקאות' : 'הצג עסקאות'}
                        </Button>

                        <Collapse in={expandedSuggestions.has(index)}>
                          <List dense sx={{ mt: 1, bgcolor: 'rgba(0,0,0,0.02)', borderRadius: 1 }}>
                            {suggestion.transactions.map((txn, txnIndex) => (
                              <ListItem key={txnIndex}>
                                <ListItemText
                                  primary={txn.transactionName}
                                  secondary={
                                    <>
                                      {new Date(txn.transactionDate).toLocaleDateString('he-IL')} |{' '}
                                      ₪{Math.abs(txn.transactionAmount).toLocaleString()}
                                    </>
                                  }
                                />
                              </ListItem>
                            ))}
                          </List>
                        </Collapse>
                      </Box>
                    </Box>

                    <Box display="flex" flexDirection="column" alignItems="flex-end" ml={2}>
                      <IconButton
                        size="small"
                        onClick={() => handleDismiss(suggestion, index)}
                        sx={{ mb: 1 }}
                      >
                        <Close fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>

                  <Divider sx={{ my: 2 }} />

                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Button
                      variant="contained"
                      startIcon={<AccountBalance />}
                      onClick={() => handleCreateAccount(suggestion)}
                      sx={{
                        bgcolor: '#667eea',
                        '&:hover': { bgcolor: '#5568d3' }
                      }}
                    >
                      צור חשבון
                    </Button>

                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => handleDismiss(suggestion, index)}
                    >
                      דחה
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* Smart Account Creation Form */}
      <SmartInvestmentAccountForm
        open={formOpen}
        onClose={handleFormClose}
        suggestion={selectedSuggestion || undefined}
        onSuccess={handleFormSuccess}
      />
    </>
  );
}
