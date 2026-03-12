import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Tooltip,
  MenuItem,
  Stack,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Search as SearchIcon,
  Close as CloseIcon,
  Receipt as TransactionIcon,
  ArrowUpward as IncomeIcon,
  ArrowDownward as ExpenseIcon,
  TrendingUp as InvestmentIcon,
  Notes as NotesIcon,
  LocalOffer as TagIcon,
  Store as VendorIcon,
  Category as CategoryFilterIcon,
  CalendarMonth as CalendarIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';

interface Transaction {
  identifier: string;
  vendor: string;
  name: string;
  category_name: string | null;
  parent_name: string | null;
  category_definition_id: number | null;
  category_type: string | null;
  memo: string | null;
  tags: string[];
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

interface CategoryOption {
  id: number;
  name: string;
  name_en?: string | null;
  name_fr?: string | null;
  parent_id: number | null;
}

interface CategoryHierarchyResponse {
  categories?: CategoryOption[];
}

export interface TransactionSearchFilters {
  query?: string;
  vendor?: string;
  category?: string;
  tag?: string;
  startDate?: string;
  endDate?: string;
}

interface GlobalTransactionSearchProps {
  open: boolean;
  onClose: () => void;
  initialFilters?: TransactionSearchFilters | null;
  onOpenTransaction?: (identifier: string, vendor: string) => void;
}

const GlobalTransactionSearch: React.FC<GlobalTransactionSearchProps> = ({
  open,
  onClose,
  initialFilters,
  onOpenTransaction,
}) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation('translation');
  const inputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [results, setResults] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [filtersLoading, setFiltersLoading] = useState(false);

  const resetState = useCallback(() => {
    setSearchQuery('');
    setVendorFilter('');
    setCategoryFilter('');
    setTagFilter('');
    setStartDate('');
    setEndDate('');
    setResults([]);
    setSelectedIndex(0);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }

    setSearchQuery(initialFilters?.query || '');
    setVendorFilter(initialFilters?.vendor || '');
    setCategoryFilter(initialFilters?.category || '');
    setTagFilter(initialFilters?.tag || '');
    setStartDate(initialFilters?.startDate || '');
    setEndDate(initialFilters?.endDate || '');
    setSelectedIndex(0);

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 100);

    return () => window.clearTimeout(timer);
  }, [initialFilters, open, resetState]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    const fetchFilterOptions = async () => {
      setFiltersLoading(true);
      try {
        const [categoriesResponse, tagsResponse] = await Promise.all([
          apiClient.get<CategoryHierarchyResponse>('/api/categories/hierarchy'),
          apiClient.get<string[]>('/api/transactions/tags'),
        ]);

        if (!cancelled) {
          setCategoryOptions(Array.isArray(categoriesResponse.data?.categories)
            ? categoriesResponse.data.categories
            : []);
          setTagOptions(Array.isArray(tagsResponse.data) ? tagsResponse.data : []);
        }
      } catch (error) {
        console.error('Failed to load transaction search filters:', error);
        if (!cancelled) {
          setCategoryOptions([]);
          setTagOptions([]);
        }
      } finally {
        if (!cancelled) {
          setFiltersLoading(false);
        }
      }
    };

    void fetchFilterOptions();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const hasSearchCriteria = useMemo(() => (
    Boolean(
      searchQuery.trim()
      || vendorFilter.trim()
      || categoryFilter
      || tagFilter
      || startDate
      || endDate
    )
  ), [categoryFilter, endDate, searchQuery, startDate, tagFilter, vendorFilter]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!hasSearchCriteria) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const debounceTimer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await apiClient.get<SearchResult>('/api/transactions/search', {
          params: {
            query: searchQuery.trim() || undefined,
            vendor: vendorFilter.trim() || undefined,
            category: categoryFilter || undefined,
            tag: tagFilter || undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            limit: 20,
          },
        });

        if (!cancelled) {
          setResults(response.data?.transactions || []);
          setSelectedIndex(0);
        }
      } catch (error) {
        console.error('Search error:', error);
        if (!cancelled) {
          setResults([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(debounceTimer);
    };
  }, [
    categoryFilter,
    endDate,
    hasSearchCriteria,
    open,
    searchQuery,
    startDate,
    tagFilter,
    vendorFilter,
  ]);

  const handleSelectTransaction = useCallback((transaction: Transaction) => {
    onOpenTransaction?.(transaction.identifier, transaction.vendor);
  }, [onOpenTransaction]);

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
  }, [handleSelectTransaction, onClose, results, selectedIndex]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
    }).format(Math.abs(price));
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(i18n.language || 'he', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatCategoryLabel = (transaction: Transaction) => {
    if (transaction.category_name && transaction.parent_name) {
      return `${transaction.parent_name} › ${transaction.category_name}`;
    }
    return transaction.category_name || transaction.parent_name || null;
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

  const categoryLabelMap = useMemo(() => {
    const language = i18n.language?.split('-')[0] || 'he';
    return new Map(
      categoryOptions.map((category) => {
        const localizedName = language === 'fr'
          ? category.name_fr || category.name_en || category.name
          : language === 'en'
            ? category.name_en || category.name
            : category.name;
        return [String(category.id), localizedName];
      }),
    );
  }, [categoryOptions, i18n.language]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
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
          maxHeight: '80vh',
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
        <Typography
          id="global-search-title"
          sx={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}
        >
          {t('globalSearch.placeholder', 'Search transactions')}
        </Typography>
        <Typography
          id="global-search-description"
          sx={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}
        >
          {t('globalSearch.hint', 'Press Enter to select, Escape to close')}
        </Typography>

        <TextField
          inputRef={inputRef}
          fullWidth
          placeholder={t('globalSearch.placeholder', 'Search transactions...')}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
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
            endAdornment: (searchQuery || hasSearchCriteria) && (
              <InputAdornment position="end">
                <IconButton size="small" onClick={resetState}>
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

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
          <TextField
            size="small"
            value={vendorFilter}
            onChange={(event) => setVendorFilter(event.target.value)}
            onKeyDown={handleKeyDown}
            label={t('globalSearch.filters.vendor', 'Vendor')}
            placeholder={t('globalSearch.filters.vendorPlaceholder', 'Filter by vendor')}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <VendorIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ flex: 1 }}
          />
          <TextField
            select
            size="small"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            label={t('globalSearch.filters.category', 'Category')}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <CategoryFilterIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ flex: 1 }}
          >
            <MenuItem value="">
              <em>{t('globalSearch.filters.allCategories', 'All categories')}</em>
            </MenuItem>
            {categoryOptions.map((category) => (
              <MenuItem key={category.id} value={String(category.id)}>
                {categoryLabelMap.get(String(category.id)) || category.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            label={t('globalSearch.filters.tag', 'Tag')}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <TagIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ flex: 1 }}
          >
            <MenuItem value="">
              <em>{t('globalSearch.filters.allTags', 'All tags')}</em>
            </MenuItem>
            {tagOptions.map((tag) => (
              <MenuItem key={tag} value={tag}>
                {tag}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mt: 1.5 }}>
          <TextField
            size="small"
            type="date"
            label={t('globalSearch.filters.startDate', 'From')}
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            InputLabelProps={{ shrink: true }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <CalendarIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            type="date"
            label={t('globalSearch.filters.endDate', 'To')}
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            InputLabelProps={{ shrink: true }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <CalendarIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ flex: 1 }}
          />
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: { xs: 'flex-start', md: 'flex-end' },
              minHeight: 40,
            }}
          >
            <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
              {filtersLoading
                ? t('globalSearch.filters.loading', 'Loading filters...')
                : t('globalSearch.hint', 'Press Enter to select, Escape to close')}
            </Typography>
          </Box>
        </Stack>
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
                      primary={(
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
                            {transaction.price > 0 ? '+' : '-'}
                            {formatPrice(transaction.price)}
                          </Typography>
                        </Box>
                      )}
                      secondary={(
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(transaction.date)}
                          </Typography>
                          {formatCategoryLabel(transaction) && (
                            <Chip
                              label={formatCategoryLabel(transaction)}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                backgroundColor: alpha(theme.palette.primary.main, 0.1),
                                color: theme.palette.primary.main,
                              }}
                            />
                          )}
                          {transaction.memo && (
                            <Tooltip title={transaction.memo}>
                              <NotesIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                            </Tooltip>
                          )}
                          {transaction.tags?.length > 0 && (
                            <>
                              {transaction.tags.slice(0, 2).map((tag) => (
                                <Chip
                                  key={tag}
                                  label={tag}
                                  size="small"
                                  icon={<TagIcon sx={{ fontSize: '12px !important' }} />}
                                  sx={{
                                    height: 18,
                                    fontSize: '0.65rem',
                                    backgroundColor: alpha(theme.palette.secondary.main, 0.1),
                                    color: theme.palette.secondary.main,
                                    '& .MuiChip-icon': {
                                      color: theme.palette.secondary.main,
                                    },
                                  }}
                                />
                              ))}
                              {transaction.tags.length > 2 && (
                                <Typography variant="caption" color="text.secondary">
                                  +{transaction.tags.length - 2}
                                </Typography>
                              )}
                            </>
                          )}
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {transaction.vendor}
                          </Typography>
                        </Box>
                      )}
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
        ) : hasSearchCriteria && !loading ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <TransactionIcon sx={{ fontSize: 48, color: theme.palette.text.disabled, mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              {t('globalSearch.noResults', 'No transactions found')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('globalSearch.emptyFilters', 'Try adjusting your filters or search terms.')}
            </Typography>
          </Box>
        ) : !hasSearchCriteria ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <SearchIcon sx={{ fontSize: 48, color: theme.palette.text.disabled, mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              {t('globalSearch.startTyping', 'Start typing to search transactions')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('globalSearch.filtersHint', 'You can also search by vendor, category, tag, or date range.')}
            </Typography>
          </Box>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

export default GlobalTransactionSearch;
