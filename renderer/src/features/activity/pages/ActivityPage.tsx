import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import LoadingState from '@renderer/components/LoadingState';
import { resolveOnboardingGate } from '@renderer/features/layout/components/onboarding-gate';
import { apiClient } from '@renderer/lib/api-client';
import LockedPagePlaceholder from '@renderer/shared/empty-state/LockedPagePlaceholder';

type ActivityFilter = 'all' | 'income' | 'expense' | 'investment';

interface ActivityTransaction {
  identifier: string;
  vendor: string;
  name?: string | null;
  category_name?: string | null;
  parent_name?: string | null;
  category_type?: string | null;
  memo?: string | null;
  price: number;
  date: string;
  processed_date?: string | null;
  status?: string | null;
}

interface ActivityResponse {
  transactions?: ActivityTransaction[];
  count?: number;
}

const transactionKind = (transaction: ActivityTransaction): Exclude<ActivityFilter, 'all'> => {
  if (transaction.category_type === 'investment') return 'investment';
  if (transaction.category_type === 'income' || transaction.price > 0) return 'income';
  return 'expense';
};

const dateKey = (value: string) => value?.slice(0, 10) || 'unknown';

const ActivityPage: React.FC = () => {
  const theme = useTheme();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'activity' });
  const { formatCurrency } = useFinancePrivacy();
  const { getPageAccessStatus, status: onboardingStatus } = useOnboarding();
  const gate = resolveOnboardingGate(onboardingStatus, getPageAccessStatus, 'activity');
  const loadRequestIdRef = useRef(0);
  const [transactions, setTransactions] = useState<ActivityTransaction[]>([]);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const activityLoadError = t('error', {
    defaultValue: 'Your recent activity could not be loaded.',
  });

  const loadTransactions = useCallback(async (searchQuery: string) => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError(false);
    try {
      const response = await apiClient.get<ActivityResponse>('/api/transactions/search', {
        params: {
          query: searchQuery.trim() || undefined,
          limit: 80,
        },
        cacheMode: 'no-store',
      });
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to load activity');
      }
      if (requestId !== loadRequestIdRef.current) return;
      setTransactions(Array.isArray(response.data?.transactions) ? response.data.transactions : []);
    } catch (loadError) {
      if (requestId !== loadRequestIdRef.current) return;
      console.error('Failed to load activity:', loadError);
      setTransactions([]);
      setError(true);
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (gate.shouldBlockPageData) {
      loadRequestIdRef.current += 1;
      return;
    }
    void loadTransactions('');
  }, [gate.shouldBlockPageData, loadTransactions]);

  useEffect(() => {
    if (gate.shouldBlockPageData) return undefined;
    const handleRefresh = () => void loadTransactions(activeQuery);
    window.addEventListener('dataRefresh', handleRefresh);
    return () => window.removeEventListener('dataRefresh', handleRefresh);
  }, [activeQuery, gate.shouldBlockPageData, loadTransactions]);

  const visibleTransactions = useMemo(
    () => transactions.filter((transaction) => (
      filter === 'all' || transactionKind(transaction) === filter
    )),
    [filter, transactions],
  );

  const totals = useMemo(() => visibleTransactions.reduce(
    (summary, transaction) => {
      const kind = transactionKind(transaction);
      if (kind === 'income') summary.income += Math.abs(transaction.price);
      if (kind === 'expense') summary.expense += Math.abs(transaction.price);
      if (kind === 'investment') summary.investment += Math.abs(transaction.price);
      return summary;
    },
    { income: 0, expense: 0, investment: 0 },
  ), [visibleTransactions]);

  const groupedTransactions = useMemo(() => {
    const groups = new Map<string, ActivityTransaction[]>();
    visibleTransactions.forEach((transaction) => {
      const key = dateKey(transaction.date);
      groups.set(key, [...(groups.get(key) || []), transaction]);
    });
    return Array.from(groups.entries());
  }, [visibleTransactions]);

  const formatDateHeading = (value: string) => {
    if (value === 'unknown') return t('unknownDate', { defaultValue: 'Date unavailable' });
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat(i18n.language || undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(year, month - 1, day));
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const nextQuery = query.trim();
    setActiveQuery(nextQuery);
    void loadTransactions(nextQuery);
  };

  const openTransaction = (transaction: ActivityTransaction) => {
    window.dispatchEvent(new CustomEvent('openTransactionDetail', {
      detail: {
        identifier: transaction.identifier,
        vendor: transaction.vendor,
      },
    }));
  };

  const openAdvancedSearch = () => {
    window.dispatchEvent(new CustomEvent('openTransactionSearch', {
      detail: activeQuery ? { query: activeQuery } : {},
    }));
  };

  if (gate.showLoading) {
    return <LoadingState fullHeight message={t('setupLoading', { defaultValue: 'Loading setup status…' })} />;
  }

  if (gate.isLocked) {
    return <LockedPagePlaceholder page="activity" onboardingStatus={onboardingStatus} />;
  }

  const filterOptions: Array<{ id: ActivityFilter; label: string }> = [
    { id: 'all', label: t('filters.all', { defaultValue: 'All' }) },
    { id: 'income', label: t('filters.income', { defaultValue: 'Income' }) },
    { id: 'expense', label: t('filters.expenses', { defaultValue: 'Expenses' }) },
    { id: 'investment', label: t('filters.investments', { defaultValue: 'Investments' }) },
  ];

  return (
    <Box sx={{ maxWidth: 1120, mx: 'auto', pb: 5 }}>
      <Box
        component="header"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: { xs: 'stretch', md: 'flex-end' },
          justifyContent: 'space-between',
          gap: 2,
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="overline" color="primary.main" sx={{ fontWeight: 750, letterSpacing: '0.08em' }}>
            {t('eyebrow', { defaultValue: 'Transaction ledger' })}
          </Typography>
          <Typography component="h1" variant="h3">
            {t('title', { defaultValue: 'Activity' })}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 620 }}>
            {t('subtitle', { defaultValue: 'Search, review, and correct every movement in one place.' })}
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<TuneRoundedIcon />} onClick={openAdvancedSearch}>
          {t('advancedSearch', { defaultValue: 'Advanced search' })}
        </Button>
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 2.5 }}>
        <Stack spacing={1.5}>
          <Box component="form" onSubmit={submitSearch} sx={{ display: 'flex', gap: 1 }}>
            <TextField
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              fullWidth
              size="small"
              placeholder={t('searchPlaceholder', { defaultValue: 'Search merchant, category, note…' })}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button type="submit" variant="contained" sx={{ minWidth: 88 }}>
              {t('search', { defaultValue: 'Search' })}
            </Button>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {filterOptions.map((option) => (
              <Chip
                key={option.id}
                clickable
                color={filter === option.id ? 'primary' : 'default'}
                variant={filter === option.id ? 'filled' : 'outlined'}
                label={option.label}
                onClick={() => setFilter(option.id)}
              />
            ))}
          </Stack>
        </Stack>
      </Paper>

      {!loading && !error && transactions.length > 0 && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
          {([
            ['income', totals.income, theme.palette.success.main, <ArrowUpwardRoundedIcon key="income" />],
            ['expenses', totals.expense, theme.palette.error.main, <ArrowDownwardRoundedIcon key="expense" />],
            ['investments', totals.investment, theme.palette.info.main, <TrendingUpRoundedIcon key="investment" />],
          ] as const).map(([key, amount, color, icon]) => (
            <Paper
              key={key}
              variant="outlined"
              sx={{ flex: 1, px: 1.5, py: 1.25, display: 'flex', alignItems: 'center', gap: 1.25 }}
            >
              <Box sx={{ display: 'grid', placeItems: 'center', color, bgcolor: alpha(color, 0.1), p: 0.75, borderRadius: 2 }}>
                {icon}
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t(`summary.${key}`, { defaultValue: key })}
                </Typography>
                <Typography sx={{ fontWeight: 750, color }}>
                  {formatCurrency(amount, { absolute: true, maximumFractionDigits: 0 })}
                </Typography>
              </Box>
            </Paper>
          ))}
        </Stack>
      )}

      {error && (
        <Alert
          severity="error"
          action={(
            <Button color="inherit" size="small" onClick={() => void loadTransactions(activeQuery)}>
              {t('retry', { defaultValue: 'Try again' })}
            </Button>
          )}
          sx={{ mb: 2 }}
        >
          {activityLoadError}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ minHeight: 300, display: 'grid', placeItems: 'center' }}>
          <Stack spacing={1.25} sx={{ alignItems: 'center' }}>
            <CircularProgress size={30} />
            <Typography color="text.secondary">
              {t('loading', { defaultValue: 'Loading recent activity…' })}
            </Typography>
          </Stack>
        </Box>
      ) : visibleTransactions.length === 0 && !error ? (
        <Paper variant="outlined" sx={{ py: 7, px: 3, textAlign: 'center' }}>
          <ReceiptLongOutlinedIcon sx={{ fontSize: 44, color: 'text.disabled', mb: 1 }} />
          <Typography variant="h6">{t('emptyTitle', { defaultValue: 'No activity found' })}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {t('emptyDescription', { defaultValue: 'Try a different search or sync your accounts.' })}
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={2.25}>
          {groupedTransactions.map(([date, items]) => (
            <Box component="section" key={date} aria-labelledby={`activity-${date}`}>
              <Typography
                id={`activity-${date}`}
                variant="subtitle2"
                color="text.secondary"
                sx={{ mb: 0.75, px: 0.5, fontWeight: 700 }}
              >
                {formatDateHeading(date)}
              </Typography>
              <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                <List disablePadding>
                  {items.map((transaction, index) => {
                    const kind = transactionKind(transaction);
                    const color = kind === 'income'
                      ? theme.palette.success.main
                      : kind === 'investment'
                        ? theme.palette.info.main
                        : theme.palette.error.main;
                    const icon = kind === 'income'
                      ? <ArrowUpwardRoundedIcon />
                      : kind === 'investment'
                        ? <TrendingUpRoundedIcon />
                        : <ArrowDownwardRoundedIcon />;
                    const title = transaction.name || transaction.memo || transaction.vendor;
                    const category = transaction.category_name || transaction.parent_name;

                    return (
                      <ListItem key={`${transaction.identifier}|${transaction.vendor}`} disablePadding>
                        <ListItemButton
                          onClick={() => openTransaction(transaction)}
                          divider={index < items.length - 1}
                          sx={{ py: 1.4, px: { xs: 1.25, sm: 2 }, gap: 1.5 }}
                        >
                          <Box
                            aria-hidden="true"
                            sx={{
                              display: 'grid',
                              placeItems: 'center',
                              width: 36,
                              height: 36,
                              flexShrink: 0,
                              borderRadius: 2.25,
                              color,
                              bgcolor: alpha(color, 0.1),
                              '& svg': { fontSize: 19 },
                            }}
                          >
                            {icon}
                          </Box>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography noWrap sx={{ fontWeight: 680 }}>
                              {title}
                            </Typography>
                            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {transaction.vendor}
                              </Typography>
                              {category && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  noWrap
                                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.35 }}
                                >
                                  <CategoryOutlinedIcon sx={{ fontSize: 13 }} />
                                  {category}
                                </Typography>
                              )}
                            </Stack>
                          </Box>
                          <Typography sx={{ flexShrink: 0, fontWeight: 750, color }}>
                            {transaction.price > 0 ? '+' : transaction.price < 0 ? '-' : ''}
                            {formatCurrency(Math.abs(transaction.price), {
                              absolute: true,
                              maximumFractionDigits: 2,
                            })}
                          </Typography>
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              </Paper>
            </Box>
          ))}
        </Stack>
      )}

      {!loading && !error && transactions.length > 0 && (
        <Button
          startIcon={<RefreshRoundedIcon />}
          onClick={() => void loadTransactions(activeQuery)}
          sx={{ mt: 2 }}
        >
          {t('refresh', { defaultValue: 'Refresh activity' })}
        </Button>
      )}
    </Box>
  );
};

export default ActivityPage;
