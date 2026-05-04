import React, { useCallback, useEffect, useState } from 'react';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import LockedPagePlaceholder from '@renderer/shared/empty-state/LockedPagePlaceholder';
import LoadingState from '@renderer/components/LoadingState';
import { resolveOnboardingGate } from '@renderer/features/layout/components/onboarding-gate';
import {
  Alert,
  Box,
  Button,
  CircularProgress, Skeleton,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Select,
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
  Dashboard as DashboardIcon,
  AccountBalanceWallet as WalletIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import { apiClient } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import {
  InvestmentData,
  InvestmentAccountSummary,
  InvestmentCategoryKey,
  InvestmentPerformanceResponse,
  InvestmentPosition,
  InvestmentPositionsResponse,
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
import HoldingsPositionsSection from '../components/HoldingsPositionsSection';
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
    portfolio?.accounts
      ?.map((account) => account.id)
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
  const { isLocked, isResolved: isOnboardingResolved, shouldBlockPageData, showLoading } =
    resolveOnboardingGate(onboardingStatus, getPageAccessStatus, 'investments');

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
  const [categoryFilter, setCategoryFilter] = useState<'all' | InvestmentCategoryKey>('all');
  const [activeTab, setActiveTab] = useState(0);
  const [performanceData, setPerformanceData] = useState<InvestmentPerformanceResponse | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [positions, setPositions] = useState<InvestmentPosition[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [investmentActivity, setInvestmentActivity] = useState<InvestmentData | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [selectedPikadonAccount, setSelectedPikadonAccount] = useState<InvestmentAccountSummary | null>(null);

  const {
    data: balanceSheetData,
    loading: balanceSheetLoading,
    error: balanceSheetError,
    refresh: refreshBalanceSheet,
  } = useInvestmentBalanceSheet({ enabled: isOnboardingResolved && !isLocked });

  const fetchPortfolioData = useCallback(async (): Promise<PortfolioSummary | null> => {
    if (shouldBlockPageData) return null;
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
  }, [shouldBlockPageData]);

  const fetchHistoryData = useCallback(async (portfolioOverride?: PortfolioSummary | null) => {
    const sourcePortfolio = portfolioOverride ?? portfolioData;
    if (shouldBlockPageData || !sourcePortfolio || sourcePortfolio.summary.totalAccounts === 0) {
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
  }, [historyTimeRange, portfolioData, shouldBlockPageData]);

  const fetchPerformanceData = useCallback(async () => {
    if (shouldBlockPageData) return;
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
  }, [historyTimeRange, shouldBlockPageData]);

  const fetchInvestmentActivity = useCallback(async () => {
    if (shouldBlockPageData) return;
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
  }, [historyTimeRange, shouldBlockPageData]);

  const fetchPositions = useCallback(async () => {
    if (shouldBlockPageData) {
      setPositions([]);
      return;
    }

    setPositionsLoading(true);
    try {
      const response = await apiClient.get<InvestmentPositionsResponse>('/api/investments/positions', {
        params: { status: 'open' },
      });
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch investment positions');
      }
      setPositions(Array.isArray(response.data?.positions) ? response.data.positions : []);
    } catch (error) {
      console.error('Error fetching investment positions:', error);
      setPositions([]);
    } finally {
      setPositionsLoading(false);
    }
  }, [shouldBlockPageData]);

  useEffect(() => {
    void fetchPortfolioData();
  }, [fetchPortfolioData, refreshTrigger]);

  useEffect(() => {
    if (!shouldBlockPageData) {
      void fetchPerformanceData();
      void fetchInvestmentActivity();
      void fetchPositions();
    }
  }, [fetchInvestmentActivity, fetchPerformanceData, fetchPositions, refreshTrigger, shouldBlockPageData]);

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
        fetchPositions(),
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
    fetchPositions,
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

  if (showLoading) {
    return <LoadingState fullHeight message={t('loading.setup')} />;
  }

  if (isLocked) {
    return <LockedPagePlaceholder page="investments" onboardingStatus={onboardingStatus} />;
  }

  const hasPortfolio = Boolean(portfolioData && portfolioData.summary.totalAccounts > 0);
  const portfolio = hasPortfolio ? (portfolioData as PortfolioSummary) : null;
  const mixedCurrencies = Boolean(balanceSheetData?.assets.currencies.hasMultiple);
  const transactions = investmentActivity?.transactions || [];
  const coverageLoading = portfolioLoading || balanceSheetLoading;

  const investmentTabs = [
    { id: 0, icon: <DashboardIcon sx={{ fontSize: 20 }} />, label: t('tabs.overview', 'Overview') },
    { id: 1, icon: <WalletIcon sx={{ fontSize: 20 }} />, label: t('tabs.holdings', 'Holdings & Balance') },
    { id: 2, icon: <ValuationIcon sx={{ fontSize: 20 }} />, label: t('tabs.performance', 'Performance Analytics') },
    { id: 3, icon: <HistoryIcon sx={{ fontSize: 20 }} />, label: t('tabs.history', 'History & Details') },
  ];

  const actions = [
    {
      label: t('actions.addAccount'),
      icon: <AddIcon fontSize="small" />,
      onClick: () => openAccountsManagement({ tab: 'investments', addFlow: true }),
      variant: 'contained' as const,
      disabled: false,
    },
    {
      label: t('actions.updateValuation'),
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
            {t('header.subtitle')}
          </Typography>
        </Box>
      </Box>

      {portfolioLoading && !hasPortfolio ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, p: 2 }}>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 4 }}><Skeleton variant="rounded" height={140} animation="wave" /></Grid>
            <Grid size={{ xs: 12, md: 4 }}><Skeleton variant="rounded" height={140} animation="wave" /></Grid>
            <Grid size={{ xs: 12, md: 4 }}><Skeleton variant="rounded" height={140} animation="wave" /></Grid>
          </Grid>
          <Skeleton variant="rounded" height={300} animation="wave" />
          <Skeleton variant="rounded" height={400} animation="wave" />
        </Box>
      ) : hasPortfolio ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}>
          {mixedCurrencies && (
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              {t('warnings.multiCurrency')}
            </Alert>
          )}

          {/* Tabs bar with actions */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 0.75,
              borderRadius: '16px',
              bgcolor: alpha(theme.palette.background.paper, 0.5),
              backdropFilter: 'blur(24px)',
              border: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.08),
              boxShadow: `0 4px 24px 0 ${alpha(theme.palette.common.black, 0.04)}, 0 1px 2px 0 ${alpha(theme.palette.common.black, 0.03)}`,
            }}
          >
            {/* Tab buttons */}
            <Box
              role="tablist"
              aria-label={t('tabs.ariaLabel', 'Investment sections')}
              sx={{
                display: 'flex',
                gap: 0.5,
                flexWrap: 'nowrap',
                flex: '0 0 auto',
              }}
            >
              {investmentTabs.map((tab) => {
                const isSelected = activeTab === tab.id;
                return (
                  <Tooltip title={tab.label} placement="top" disableInteractive key={tab.id}>
                    <Box
                      role="tab"
                      aria-selected={isSelected}
                      tabIndex={isSelected ? 0 : -1}
                      onClick={() => setActiveTab(tab.id)}
                      sx={{
                        flex: '0 0 auto',
                        minWidth: { xs: 40, md: 'auto' },
                        height: 36,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 0.75,
                        px: { xs: 1.25, md: 1.75 },
                        borderRadius: '10px',
                        cursor: 'pointer',
                        userSelect: 'none',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        color: isSelected
                          ? theme.palette.primary.contrastText
                          : theme.palette.text.secondary,
                        background: isSelected
                          ? `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`
                          : 'transparent',
                        boxShadow: isSelected
                          ? `0 4px 12px ${alpha(theme.palette.primary.main, 0.3)}, 0 1px 3px ${alpha(theme.palette.primary.main, 0.2)}`
                          : 'none',
                        '&:hover': isSelected
                          ? {}
                          : {
                              bgcolor: alpha(theme.palette.primary.main, 0.08),
                              color: theme.palette.text.primary,
                            },
                        '&:active': {
                          transform: 'scale(0.97)',
                        },
                        '& .MuiSvgIcon-root': {
                          fontSize: 18,
                          opacity: isSelected ? 1 : 0.6,
                          transition: 'opacity 0.2s',
                        },
                      }}
                    >
                      {tab.icon}
                      <Typography
                        variant="body2"
                        fontWeight={isSelected ? 600 : 500}
                        sx={{
                          display: { xs: 'none', md: 'block' },
                          whiteSpace: 'nowrap',
                          fontSize: '0.8125rem',
                        }}
                      >
                        {tab.label}
                      </Typography>
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>

            {/* Spacer */}
            <Box sx={{ flex: 1 }} />

            {/* Time range selector */}
            {(activeTab === 0 || activeTab === 3) && (
              <Select
                value={historyTimeRange}
                onChange={(e) => setHistoryTimeRange(e.target.value as HistoryTimeRangeOption)}
                size="small"
                variant="outlined"
                sx={{
                  minWidth: 68,
                  height: 36,
                  borderRadius: '10px',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: alpha(theme.palette.divider, 0.12),
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: alpha(theme.palette.divider, 0.3),
                  },
                  '& .MuiSelect-select': {
                    py: 0.75,
                    pr: '28px !important',
                  },
                }}
              >
                {TIME_RANGES.map((range) => (
                  <MenuItem key={range.value} value={range.value} sx={{ fontSize: '0.8125rem', fontWeight: 500 }}>
                    {range.label}
                  </MenuItem>
                ))}
              </Select>
            )}

            {/* Divider */}
            <Box sx={{ width: '1px', height: 24, bgcolor: alpha(theme.palette.divider, 0.15), flexShrink: 0 }} />

            {/* Action buttons */}
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
              <Tooltip title={t('actions.refreshTooltip')}>
                <IconButton
                  onClick={() => void handleRefreshAll()}
                  disabled={isRefreshing}
                  size="small"
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: '10px',
                    color: 'text.secondary',
                    '&:hover': {
                      bgcolor: alpha(theme.palette.action.hover, 0.8),
                      color: 'text.primary',
                    },
                  }}
                >
                  {isRefreshing ? <CircularProgress size={16} /> : <RefreshIcon sx={{ fontSize: 18 }} />}
                </IconButton>
              </Tooltip>
              {actions.map((action) => (
                <Tooltip title={action.label} key={action.label}>
                  <IconButton
                    onClick={action.onClick}
                    disabled={action.disabled}
                    size="small"
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: '10px',
                      color: action.variant === 'contained' ? 'primary.main' : 'text.secondary',
                      '&:hover': {
                        bgcolor: action.variant === 'contained'
                          ? alpha(theme.palette.primary.main, 0.12)
                          : alpha(theme.palette.action.hover, 0.8),
                        color: action.variant === 'contained' ? 'primary.dark' : 'text.primary',
                      },
                    }}
                  >
                    {action.icon}
                  </IconButton>
                </Tooltip>
              ))}
            </Box>
          </Box>

          {/* Overview Tab */}
          {activeTab === 0 && (
            <Box role="tabpanel" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Grid container spacing={3} sx={{ flexShrink: 0 }}>
                <Grid size={{ xs: 12, lg: 8 }}>
                  <Box sx={{ height: { xs: 400, lg: 380 } }}>
                    <PortfolioValuePanel
                      portfolioData={portfolio}
                      overallHistory={overallHistory}
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
            </Box>
          )}

          {/* Holdings & Balance Tab */}
          {activeTab === 1 && (
            <Box role="tabpanel" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <HoldingsPositionsSection
                portfolioData={portfolio}
                positions={positions}
                loading={positionsLoading || portfolioLoading}
              />

              <BalanceSheetSection
                data={balanceSheetData}
                loading={balanceSheetLoading}
                error={balanceSheetError}
              />
            </Box>
          )}

          {/* Performance Analytics Tab */}
          {activeTab === 2 && (
            <Grid role="tabpanel" container spacing={3}>
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
          )}

          {/* History Tab */}
          {activeTab === 3 && (
            <Grid role="tabpanel" container spacing={3} sx={{ minHeight: 480 }}>
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
                    onAccountClick={handleAccountClick}
                  />
                </Box>
              </Grid>
            </Grid>
          )}

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
            {t('empty.description')}
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Button
              variant="contained"
              size="large"
              startIcon={<AddIcon />}
              onClick={() => openAccountsManagement({ tab: 'investments', addFlow: true })}
              sx={{ borderRadius: 2, textTransform: 'none', px: 4 }}
            >
              {t('empty.cta')}
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
