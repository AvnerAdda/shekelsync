import React, { useCallback, useEffect, useState } from 'react';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import LockedPagePlaceholder from '@renderer/shared/empty-state/LockedPagePlaceholder';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  Add as AddIcon,
  AccountBalance as AccountIcon,
  Refresh as RefreshIcon,
  TrendingUp as ValuationIcon,
} from '@mui/icons-material';
import { apiClient } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import {
  InvestmentData,
  InvestmentAccountSummary,
  InvestmentPerformanceResponse,
  PortfolioHistoryPoint,
  PortfolioHistoryResponse,
  PortfolioSummary,
} from '@renderer/types/investments';
import {
  HistoryTimeRangeOption,
  InvestmentsFiltersProvider,
  useInvestmentsFilters,
} from '../InvestmentsFiltersContext';
import PortfolioValuePanel from '../components/PortfolioValuePanel';
import AllocationDonutChart from '../components/AllocationDonutChart';
import PerformanceCardsSection from '../components/PerformanceCardsSection';
import BalanceSheetSection from '../components/BalanceSheetSection';
import PortfolioHistorySection from '../components/PortfolioHistorySection';
import PortfolioBreakdownSection from '../components/PortfolioBreakdownSection';
import PerformanceBreakdownPanel from '../components/PerformanceBreakdownPanel';
import PortfolioCoveragePanel from '../components/PortfolioCoveragePanel';
import PikadonAccountDetailsDialog from '../components/PikadonAccountDetailsDialog';
import { useInvestmentBalanceSheet } from '../hooks/useBalanceSheet';
import { type AccountsModalOpenRequest } from '@renderer/shared/modals/AccountsModal';

const TIME_RANGES: { value: HistoryTimeRangeOption; label: string }[] = [
  { value: '1w', label: '1W' },
  { value: '1m', label: '1M' },
  { value: '2m', label: '2M' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'ALL' },
];

function getPortfolioAccountIds(portfolio: PortfolioSummary | null | undefined): number[] {
  return Array.from(new Set(
    portfolio?.breakdown
      ?.flatMap((group) => group.accounts?.map((account) => account.id).filter(Boolean) || [])
      .filter((id): id is number => typeof id === 'number') || [],
  ));
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getRangeDates(range: HistoryTimeRangeOption): { startDate?: string; endDate?: string } {
  const endDate = new Date();
  const startDate = new Date(endDate);

  switch (range) {
    case '1d':
      startDate.setDate(startDate.getDate() - 1);
      break;
    case '1w':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case '1m':
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case '2m':
      startDate.setMonth(startDate.getMonth() - 2);
      break;
    case '3m':
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case '6m':
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    case '1y':
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    case 'ytd':
      startDate.setMonth(0, 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'all':
      return {};
    default:
      return {};
  }

  return {
    startDate: formatLocalDate(startDate),
    endDate: formatLocalDate(endDate),
  };
}

const InvestmentsPageContent: React.FC = () => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage' });
  const { getPageAccessStatus, status: onboardingStatus } = useOnboarding();
  const accessStatus = getPageAccessStatus('investments');
  const isLocked = accessStatus.isLocked;

  const {
    historyTimeRange,
    setHistoryTimeRange,
    refreshTrigger,
    isRefreshing,
    setIsRefreshing,
  } = useInvestmentsFilters();

  const [portfolioData, setPortfolioData] = useState<PortfolioSummary | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);

  const [overallHistory, setOverallHistory] = useState<PortfolioHistoryPoint[]>([]);
  const [accountHistories, setAccountHistories] = useState<Record<number, PortfolioHistoryPoint[]>>({});
  const [historyLoading, setHistoryLoading] = useState(false);

  const [chartViewMode, setChartViewMode] = useState<'value' | 'performance'>('value');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [performanceData, setPerformanceData] = useState<InvestmentPerformanceResponse | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [investmentActivity, setInvestmentActivity] = useState<InvestmentData | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [selectedPikadonAccount, setSelectedPikadonAccount] = useState<InvestmentAccountSummary | null>(null);

  const {
    data: balanceSheetData,
    loading: balanceSheetLoading,
    error: balanceSheetError,
    refresh: refreshBalanceSheet,
  } = useInvestmentBalanceSheet({ enabled: !isLocked });

  const fetchPortfolioData = useCallback(async (): Promise<PortfolioSummary | null> => {
    if (isLocked) return null;
    setPortfolioLoading(true);
    try {
      const response = await apiClient.get<PortfolioSummary>('/api/investments/summary');
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch portfolio data');
      }
      const nextPortfolio = response.data as PortfolioSummary;
      setPortfolioData(nextPortfolio);
      return nextPortfolio;
    } catch (error) {
      console.error('Error fetching portfolio data:', error);
      setPortfolioData(null);
      return null;
    } finally {
      setPortfolioLoading(false);
    }
  }, [isLocked]);

  const fetchHistoryData = useCallback(async (portfolioOverride?: PortfolioSummary | null) => {
    const sourcePortfolio = portfolioOverride ?? portfolioData;
    if (isLocked || !sourcePortfolio || sourcePortfolio.summary.totalAccounts === 0) {
      setOverallHistory([]);
      setAccountHistories({});
      return;
    }

    setHistoryLoading(true);
    try {
      const uniqueAccountIds = getPortfolioAccountIds(sourcePortfolio);
      const params = new URLSearchParams({ timeRange: historyTimeRange });
      if (uniqueAccountIds.length > 0) {
        params.append('includeAccounts', '1');
        uniqueAccountIds.forEach((id) => params.append('accountIds', id.toString()));
      }

      const response = await apiClient.get<PortfolioHistoryResponse>(
        `/api/investments/history?${params.toString()}`,
      );

      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch portfolio history');
      }

      const historyResult = (response.data as PortfolioHistoryResponse) || {};
      setOverallHistory(Array.isArray(historyResult.history) ? historyResult.history : []);

      const histories: Record<number, PortfolioHistoryPoint[]> = {};
      if (Array.isArray(historyResult.accounts)) {
        historyResult.accounts.forEach((account) => {
          const accountId = Number(account.accountId);
          if (Number.isFinite(accountId)) {
            histories[accountId] = Array.isArray(account.history) ? account.history : [];
          }
        });
      }
      setAccountHistories(histories);
    } catch (error) {
      console.error('Error fetching history data:', error);
      setOverallHistory([]);
      setAccountHistories({});
    } finally {
      setHistoryLoading(false);
    }
  }, [historyTimeRange, isLocked, portfolioData]);

  const fetchPerformanceData = useCallback(async () => {
    if (isLocked) return;
    setPerformanceLoading(true);
    try {
      const response = await apiClient.get<InvestmentPerformanceResponse>('/api/investments/performance', {
        params: { range: historyTimeRange },
      });
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch investment performance');
      }
      setPerformanceData(response.data as InvestmentPerformanceResponse);
    } catch (error) {
      console.error('Error fetching investment performance:', error);
      setPerformanceData(null);
    } finally {
      setPerformanceLoading(false);
    }
  }, [historyTimeRange, isLocked]);

  const fetchInvestmentActivity = useCallback(async () => {
    if (isLocked) return;
    setActivityLoading(true);
    try {
      const rangeDates = getRangeDates(historyTimeRange);
      const response = await apiClient.get<InvestmentData>('/api/analytics/investments', {
        params: rangeDates,
      });
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch investment activity');
      }
      setInvestmentActivity(response.data as InvestmentData);
    } catch (error) {
      console.error('Error fetching investment activity:', error);
      setInvestmentActivity(null);
    } finally {
      setActivityLoading(false);
    }
  }, [historyTimeRange, isLocked]);

  useEffect(() => {
    void fetchPortfolioData();
  }, [fetchPortfolioData, refreshTrigger]);

  useEffect(() => {
    if (!isLocked) {
      void fetchPerformanceData();
      void fetchInvestmentActivity();
    }
  }, [fetchInvestmentActivity, fetchPerformanceData, isLocked, refreshTrigger]);

  useEffect(() => {
    void fetchHistoryData();
  }, [fetchHistoryData]);

  const openAccountsManagement = useCallback((request?: AccountsModalOpenRequest) => {
    window.dispatchEvent(new CustomEvent('openAccountsModal', { detail: request }));
  }, []);

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const nextPortfolio = await fetchPortfolioData();
      await Promise.all([
        fetchHistoryData(nextPortfolio),
        fetchPerformanceData(),
        fetchInvestmentActivity(),
        refreshBalanceSheet(),
      ]);
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    fetchHistoryData,
    fetchInvestmentActivity,
    fetchPerformanceData,
    fetchPortfolioData,
    refreshBalanceSheet,
    setIsRefreshing,
  ]);

  useEffect(() => {
    const handleDataRefresh = () => {
      void handleRefreshAll();
    };
    window.addEventListener('dataRefresh', handleDataRefresh);
    return () => window.removeEventListener('dataRefresh', handleDataRefresh);
  }, [handleRefreshAll]);

  const handleAccountClick = useCallback((account: InvestmentAccountSummary) => {
    if (account.account_type !== 'savings') {
      return;
    }
    setSelectedPikadonAccount(account);
  }, []);

  if (isLocked) {
    return <LockedPagePlaceholder page="investments" onboardingStatus={onboardingStatus} />;
  }

  const hasPortfolio = Boolean(portfolioData && portfolioData.summary.totalAccounts > 0);
  const portfolio = hasPortfolio ? (portfolioData as PortfolioSummary) : null;
  const mixedCurrencies = Boolean(balanceSheetData?.assets.currencies.hasMultiple);
  const transactions = investmentActivity?.transactions || [];
  const coverageLoading = portfolioLoading || balanceSheetLoading;

  const actions = [
    {
      label: 'Add account',
      icon: <AddIcon fontSize="small" />,
      onClick: () => openAccountsManagement({ tab: 'investments', addFlow: true }),
      variant: 'contained' as const,
      disabled: false,
    },
    {
      label: 'Update valuation',
      icon: <ValuationIcon fontSize="small" />,
      onClick: () => openAccountsManagement({ tab: 'investments' }),
      variant: 'outlined' as const,
      disabled: !hasPortfolio,
    },
  ];

  return (
    <Box
      sx={{
        p: 3,
        height: { xs: 'auto', lg: 'calc(100vh - 64px)' },
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          mb: 3,
          gap: 2,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <Box>
          <Typography variant="h5" fontWeight={700}>
            {t('header.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Track value change, coverage, and account-level history from one place.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Box
            sx={{
              display: 'flex',
              gap: 0.5,
              mr: 1,
              bgcolor: alpha(theme.palette.background.paper, 0.5),
              p: 0.5,
              borderRadius: 1.5,
            }}
          >
            {TIME_RANGES.map((range) => (
              <Box
                key={range.value}
                onClick={() => setHistoryTimeRange(range.value)}
                sx={{
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 1,
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontWeight: historyTimeRange === range.value ? 600 : 400,
                  color: historyTimeRange === range.value ? 'primary.main' : 'text.secondary',
                  bgcolor:
                    historyTimeRange === range.value
                      ? alpha(theme.palette.primary.main, 0.1)
                      : 'transparent',
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.05),
                  },
                  transition: 'all 0.2s',
                }}
              >
                {range.label}
              </Box>
            ))}
          </Box>

          <Tooltip title={t('actions.refreshTooltip')}>
            <IconButton
              onClick={() => void handleRefreshAll()}
              disabled={isRefreshing}
              size="small"
              sx={{
                bgcolor: alpha(theme.palette.action.selected, 0.1),
                '&:hover': {
                  bgcolor: alpha(theme.palette.action.selected, 0.2),
                },
              }}
            >
              {isRefreshing ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
            </IconButton>
          </Tooltip>

          {actions.map((action) => (
            <Button
              key={action.label}
              variant={action.variant}
              startIcon={action.icon}
              onClick={action.onClick}
              disabled={action.disabled}
              sx={{ textTransform: 'none' }}
            >
              {action.label}
            </Button>
          ))}
        </Box>
      </Box>

      {portfolioLoading && !hasPortfolio ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
          <CircularProgress />
        </Box>
      ) : hasPortfolio ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}>
          {mixedCurrencies && (
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              Multiple currencies are present. Totals and charts still reflect raw account values, not FX-normalized values.
            </Alert>
          )}

          <Grid container spacing={3} sx={{ flexShrink: 0 }}>
            <Grid size={{ xs: 12, lg: 8 }}>
              <Box sx={{ height: { xs: 400, lg: 380 } }}>
                <PortfolioValuePanel
                  portfolioData={portfolio}
                  overallHistory={overallHistory}
                  historyTimeRange={historyTimeRange}
                  onTimeRangeChange={(range: HistoryTimeRangeOption) => setHistoryTimeRange(range)}
                  viewMode={chartViewMode}
                  onViewModeChange={setChartViewMode}
                  loading={portfolioLoading || historyLoading}
                />
              </Box>
            </Grid>

            <Grid size={{ xs: 12, lg: 4 }}>
              <Box sx={{ height: { xs: 350, lg: 380 } }}>
                <AllocationDonutChart portfolioData={portfolio as PortfolioSummary} />
              </Box>
            </Grid>
          </Grid>

          <PerformanceCardsSection
            portfolioData={portfolio as PortfolioSummary}
            accountHistories={accountHistories}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            onAccountClick={handleAccountClick}
          />

          <BalanceSheetSection
            data={balanceSheetData}
            loading={balanceSheetLoading}
            error={balanceSheetError}
          />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, lg: 8 }}>
              <Box sx={{ minHeight: 420 }}>
                <PerformanceBreakdownPanel
                  data={performanceData}
                  loading={performanceLoading}
                  multiCurrencyWarning={mixedCurrencies}
                />
              </Box>
            </Grid>
            <Grid size={{ xs: 12, lg: 4 }}>
              <Box sx={{ minHeight: 420 }}>
                <PortfolioCoveragePanel
                  portfolioData={portfolio}
                  balanceSheet={balanceSheetData}
                  loading={coverageLoading}
                />
              </Box>
            </Grid>
          </Grid>

          <Grid container spacing={3} sx={{ minHeight: 480 }}>
            <Grid size={{ xs: 12, lg: 8 }}>
              <Box sx={{ height: { xs: 520, lg: 500 } }}>
                <PortfolioHistorySection
                  overallHistory={overallHistory}
                  accountHistories={accountHistories}
                  portfolioData={portfolio as PortfolioSummary}
                  transactions={transactions}
                  loadingHistory={historyLoading}
                  loadingTransactions={activityLoading}
                />
              </Box>
            </Grid>
            <Grid size={{ xs: 12, lg: 4 }}>
              <Box sx={{ height: { xs: 420, lg: 500 } }}>
                <PortfolioBreakdownSection
                  portfolioData={portfolio as PortfolioSummary}
                  accountHistories={accountHistories}
                  historyLoading={historyLoading}
                  onAccountClick={handleAccountClick}
                />
              </Box>
            </Grid>
          </Grid>

          <PikadonAccountDetailsDialog
            open={Boolean(selectedPikadonAccount)}
            account={selectedPikadonAccount}
            onClose={() => setSelectedPikadonAccount(null)}
          />
        </Box>
      ) : (
        <Paper
          elevation={0}
          sx={{
            p: 6,
            textAlign: 'center',
            mt: 4,
          }}
        >
          <AccountIcon sx={{ fontSize: 72, color: 'text.secondary', mb: 3 }} />
          <Typography variant="h5" gutterBottom fontWeight={600}>
            {t('empty.title')}
          </Typography>
          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ mb: 4, maxWidth: 560, mx: 'auto' }}
          >
            Add your first investment account to start tracking value changes, balance sheet coverage, and account history.
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Button
              variant="contained"
              size="large"
              startIcon={<AddIcon />}
              onClick={() => openAccountsManagement({ tab: 'investments', addFlow: true })}
              sx={{ borderRadius: 2, textTransform: 'none', px: 4 }}
            >
              Add investment account
            </Button>
          </Box>
        </Paper>
      )}
    </Box>
  );
};

const InvestmentsPage: React.FC = () => (
  <InvestmentsFiltersProvider>
    <InvestmentsPageContent />
  </InvestmentsFiltersProvider>
);

export default InvestmentsPage;
