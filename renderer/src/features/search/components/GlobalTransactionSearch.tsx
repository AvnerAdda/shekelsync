import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  TextField,
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Chip,
  CircularProgress,
  InputAdornment,
  useTheme,
  Divider,
  IconButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Search as SearchIcon,
  Close as CloseIcon,
  Receipt as TransactionIcon,
  ArrowUpward as IncomeIcon,
  ArrowDownward as ExpenseIcon,
  TrendingUp as InvestmentIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api-client';

interface Transaction {
  identifier: string;
  vendor: string;
  name: string;
  category: string | null;
  parent_category: string | null;
  category_definition_id: number | null;
  category_type: string | null;
  memo: string | null;
  price: number;
  date: string;
  processed_date: string | null;
  account_number: string | null;
  type: string | null;
  status: string | null;
}

interface SearchResult {
  transactions: Transaction[];
  count: number;
  searchQuery: string;
  filters: Record<string, unknown>;
}

interface GlobalTransactionSearchProps {
  open: boolean;
  onClose: () => void;
}

const GlobalTransactionSearch: React.FC<GlobalTransactionSearchProps> = ({ open, onClose }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { t } = useTranslation('translation');
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    } else {
      // Reset state when closing
      setSearchQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  // Search transactions with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    const debounceTimer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await apiClient.get<SearchResult>('/api/transactions/search', {
          params: { query: searchQuery, limit: 20 },
        });
        setResults(response.data.transactions || []);
        setSelectedIndex(0);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchQuery]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (results[selectedIndex]) {
          handleSelectTransaction(results[selectedIndex]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
    }
  }, [results, selectedIndex, onClose]);

  const handleSelectTransaction = useCallback((transaction: Transaction) => {
    // Navigate to home page with transaction filter
    navigate('/', { 
      state: { 
        highlightTransaction: transaction.identifier,
        searchQuery: searchQuery,
      } 
    });
    onClose();
  }, [navigate, onClose, searchQuery]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
    }).format(Math.abs(price));
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('he-IL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const getTransactionIcon = (transaction: Transaction) => {
    const type = transaction.category_type || (transaction.price > 0 ? 'income' : 'expense');
    switch (type) {
      case 'income':
        return <IncomeIcon sx={{ color: theme.palette.success.main }} />;
      case 'investment':
        return <InvestmentIcon sx={{ color: theme.palette.info.main }} />;
      default:
        return <ExpenseIcon sx={{ color: theme.palette.error.main }} />;
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="global-search-title"
      aria-describedby="global-search-description"
      PaperProps={{
        sx: {
          mt: 8,
          mx: 'auto',
          borderRadius: 3,
          backgroundColor: alpha(theme.palette.background.paper, 0.95),
          backdropFilter: 'blur(20px)',
          boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.2)}`,
          border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          maxHeight: '70vh',
          overflow: 'hidden',
        },
        role: 'dialog',
      }}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: alpha(theme.palette.common.black, 0.5),
            backdropFilter: 'blur(4px)',
          },
        },
      }}
    >
      <Box sx={{ p: 2, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
        <Typography id="global-search-title" sx={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}>
          {t('globalSearch.placeholder', 'Search transactions')}
        </Typography>
        <Typography id="global-search-description" sx={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}>
          {t('globalSearch.hint', 'Press Enter to select, Escape to close')}
        </Typography>
        <TextField
          inputRef={inputRef}
          fullWidth
          placeholder={t('globalSearch.placeholder', 'Search transactions...')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          variant="outlined"
          autoComplete="off"
          aria-label={t('globalSearch.placeholder', 'Search transactions...')}
          inputProps={{
            'aria-describedby': 'global-search-description',
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                {loading ? (
                  <CircularProgress size={20} />
                ) : (
                  <SearchIcon sx={{ color: theme.palette.text.secondary }} />
                )}
              </InputAdornment>
            ),
            endAdornment: searchQuery && (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setSearchQuery('')}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
            sx: {
              borderRadius: 2,
              backgroundColor: alpha(theme.palette.text.primary, 0.05),
              '& fieldset': { border: 'none' },
              '&:hover': {
                backgroundColor: alpha(theme.palette.text.primary, 0.08),
              },
              '&.Mui-focused': {
                backgroundColor: alpha(theme.palette.background.paper, 0.8),
                boxShadow: `0 2px 8px ${alpha(theme.palette.common.black, 0.1)}`,
              },
            },
          }}
        />
        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: theme.palette.text.secondary }}>
          {t('globalSearch.hint', 'Press Enter to select, Escape to close')}
        </Typography>
      </Box>

      <DialogContent sx={{ p: 0, overflow: 'auto' }}>
        {results.length > 0 ? (
          <List sx={{ py: 0 }}>
            {results.map((transaction, index) => (
              <React.Fragment key={`${transaction.identifier}-${transaction.vendor}`}>
                <ListItem disablePadding>
                  <ListItemButton
                    selected={index === selectedIndex}
                    onClick={() => handleSelectTransaction(transaction)}
                    sx={{
                      py: 1.5,
                      px: 2,
                      '&.Mui-selected': {
                        backgroundColor: alpha(theme.palette.primary.main, 0.1),
                      },
                      '&:hover': {
                        backgroundColor: alpha(theme.palette.primary.main, 0.05),
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      {getTransactionIcon(transaction)}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" fontWeight={500} noWrap sx={{ flex: 1 }}>
                            {transaction.name}
                          </Typography>
                          <Typography
                            variant="body2"
                            fontWeight={600}
                            sx={{
                              color: transaction.price > 0
                                ? theme.palette.success.main
                                : theme.palette.error.main,
                            }}
                          >
                            {transaction.price > 0 ? '+' : '-'}{formatPrice(transaction.price)}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(transaction.date)}
                          </Typography>
                          {transaction.category && (
                            <Chip
                              label={transaction.category}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                backgroundColor: alpha(theme.palette.primary.main, 0.1),
                                color: theme.palette.primary.main,
                              }}
                            />
                          )}
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {transaction.vendor}
                          </Typography>
                        </Box>
                      }
                      primaryTypographyProps={{ component: 'div' }}
                      secondaryTypographyProps={{ component: 'div' }}
                    />
                  </ListItemButton>
                </ListItem>
                {index < results.length - 1 && (
                  <Divider component="li" sx={{ borderColor: alpha(theme.palette.divider, 0.05) }} />
                )}
              </React.Fragment>
            ))}
          </List>
        ) : searchQuery && !loading ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <TransactionIcon sx={{ fontSize: 48, color: theme.palette.text.disabled, mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              {t('globalSearch.noResults', 'No transactions found')}
            </Typography>
          </Box>
        ) : !searchQuery ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <SearchIcon sx={{ fontSize: 48, color: theme.palette.text.disabled, mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              {t('globalSearch.startTyping', 'Start typing to search transactions')}
            </Typography>
          </Box>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

export default GlobalTransactionSearch;
