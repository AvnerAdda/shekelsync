import React, { useState, useEffect } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Chip,
  Typography,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { apiClient } from '@/lib/api-client';

interface CreditCardSuggestion {
  vendor: string;
  vendorLabel: string;
  lastFourDigits: string | null;
  transactionCount: number;
  sampleTransactions: string[];
  confidence: number;
  detectionMethod: 'keyword' | 'category' | 'keyword_and_category' | 'unknown';
}

interface CreditCardSuggestionsResponse {
  suggestions: CreditCardSuggestion[];
  totalSuggestions: number;
}

const CreditCardSuggestionsCard: React.FC = () => {
  const [suggestions, setSuggestions] = useState<CreditCardSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSuggestions();
  }, []);

  const fetchSuggestions = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get('/api/accounts/credit-card-suggestions');

      if (!response.ok) {
        throw new Error('Failed to fetch credit card suggestions');
      }

      const data = response.data as CreditCardSuggestionsResponse;
      setSuggestions(data.suggestions || []);
    } catch (err) {
      console.error('Error fetching credit card suggestions:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return null; // Silently fail - don't show error to user
  }

  if (!suggestions || suggestions.length === 0) {
    return null; // No suggestions, don't render anything
  }

  return (
    <Alert
      severity="info"
      icon={<CreditCardIcon />}
      sx={{ mb: 2 }}
    >
      <AlertTitle>Detected Credit Cards in Bank Transactions</AlertTitle>
      <Typography variant="body2" sx={{ mb: 1.5 }}>
        We found transactions that suggest you may have these credit cards:
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1, alignItems: 'center' }}>
        {suggestions.map((suggestion, idx) => (
          <Tooltip
            key={`${suggestion.vendor}-${suggestion.lastFourDigits || idx}`}
            enterDelay={300}
            title={
              <Box>
                <Typography variant="caption" component="div" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Detection Details:
                </Typography>
                <Typography variant="caption" component="div">
                  • {suggestion.transactionCount} transaction{suggestion.transactionCount !== 1 ? 's' : ''} found
                </Typography>
                <Typography variant="caption" component="div">
                  • Method: {suggestion.detectionMethod.replace(/_/g, ' ')}
                </Typography>
                <Typography variant="caption" component="div">
                  • Confidence: {suggestion.confidence}/10
                </Typography>
                {suggestion.sampleTransactions.length > 0 && (
                  <>
                    <Typography variant="caption" component="div" sx={{ fontWeight: 600, mt: 1, mb: 0.5 }}>
                      Sample Transactions:
                    </Typography>
                    {suggestion.sampleTransactions.map((txn, txnIdx) => (
                      <Typography
                        key={txnIdx}
                        variant="caption"
                        component="div"
                        sx={{ fontSize: '0.65rem', opacity: 0.9 }}
                      >
                        • {txn}
                      </Typography>
                    ))}
                  </>
                )}
              </Box>
            }
            arrow
          >
            <Chip
              icon={<CreditCardIcon fontSize="small" />}
              label={
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  <Typography variant="body2" component="span" sx={{ fontWeight: 500 }}>
                    {suggestion.vendorLabel}
                  </Typography>
                  {suggestion.lastFourDigits && (
                    <Typography
                      variant="body2"
                      component="span"
                      sx={{ opacity: 0.7, fontSize: '0.8rem' }}
                    >
                      ****{suggestion.lastFourDigits}
                    </Typography>
                  )}
                  <Chip
                    label={suggestion.transactionCount}
                    size="small"
                    color="secondary"
                    sx={{ height: '18px', fontSize: '0.7rem', ml: 0.5 }}
                  />
                </Box>
              }
              variant="outlined"
              color="secondary"
              sx={{
                cursor: 'help',
                '&:hover': {
                  backgroundColor: 'action.hover',
                },
              }}
            />
          </Tooltip>
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1.5 }}>
        <InfoOutlinedIcon sx={{ fontSize: 16, color: 'info.main' }} />
        <Typography variant="caption" color="text.secondary">
          Add these accounts manually in the form above to track credit card expenses
        </Typography>
      </Box>
    </Alert>
  );
};

export default CreditCardSuggestionsCard;
