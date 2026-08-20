import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import LockedPagePlaceholder from '@renderer/shared/empty-state/LockedPagePlaceholder';
import LoadingState from '@renderer/components/LoadingState';
import { resolveOnboardingGate } from '@renderer/features/layout/components/onboarding-gate';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AccountIcon from '@mui/icons-material/AccountBalance';
import RefreshIcon from '@mui/icons-material/Refresh';
import ValuationIcon from '@mui/icons-material/TrendingUp';
import DashboardIcon from '@mui/icons-material/Dashboard';
import WalletIcon from '@mui/icons-material/AccountBalanceWallet';
import HistoryIcon from '@mui/icons-material/History';
import RealEstateIcon from '@mui/icons-material/HomeWork';
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
  PortfolioChartScopeOption,
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
import RealEstateSimulatorDialog from '../components/RealEstateSimulatorDialog';
import RealEstateOverviewSection from '../components/RealEstateOverviewSection';
import AllocationTargetsPanel from '../components/AllocationTargetsPanel';
import LiabilitiesManager from '../components/LiabilitiesManager';
import FxSettingsPanel from '../components/FxSettingsPanel';
import BenchmarkComparisonPanel from '../components/BenchmarkComparisonPanel';
import { useInvestmentBalanceSheet } from '../hooks/useBalanceSheet';
import { type AccountsModalOpenRequest } from '@renderer/shared/modals/AccountsModal';
import {
  getPortfolioAccountsForScope,
  getPortfolioScopeTotal,
} from '../utils/portfolio-categories';

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

const CHART_SCOPE_OPTIONS: { value: PortfolioChartScopeOption; labelKey: string; fallback: string }[] = [
  { value: 'exclude_real_estate', labelKey: 'chartScope.excludeRealEstate', fallback: 'Exclude real estate' },
  { value: 'all', labelKey: 'chartScope.all', fallback: 'All' },
  { value: 'liquid', labelKey: 'chartScope.liquid', fallback: 'Liquid' },
  { value: 'restricted', labelKey: 'chartScope.restricted', fallback: 'Restricted' },
  { value: 'illiquid', labelKey: 'chartScope.illiquid', fallback: 'Illiquid' },
];

interface InvestmentCoverageResponse {
  unlinkedTransactions: {
    count: number;
    thresholdDays: number;
  };
}

function getPortfolioAccountIds(
  portfolio: PortfolioSummary | null | undefined,
  scope: PortfolioChartScopeOption,
): number[] {
  return Array.from(new Set(
    getPortfolioAccountsForScope(portfolio, scope)
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
  const refreshShortcutLabel = window.electronAPI?.platform?.isMacOS ? '⌘R' : 'Ctrl+R';
  const { getPageAccessStatus, status: onboardingStatus } = useOnboarding();
  const { isLocked, isResolved: isOnboardingResolved, shouldBlockPageData, showLoading } =
    resolveOnboardingGate(onboardingStatus, getPageAccessStatus, 'investments');

  const {
    historyTimeRange,
    setHistoryTimeRange,
    chartScope,
    setChartScope,
    refreshTrigger,
    isRefreshing,
    setIsRefreshing,
  } = useInvestmentsFilters();

  const [portfolioData, setPortfolioData] = useState<PortfolioSummary | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioError, setPortfolioError] = useState<Error | null>(null);

  const [overallHistory, setOverallHistory] = useState<PortfolioHistoryPoint[]>([]);
  const [accountHistories, setAccountHistories] = useState<Record<number, PortfolioHistoryPoint[]>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<Error | null>(null);

  const [chartViewMode, setChartViewMode] = useState<'value' | 'performance'>('value');
  const [categoryFilter, setCategoryFilter] = useState<'all' | InvestmentCategoryKey>('all');
  const [activeTab, setActiveTab] = useState(0);
  const [performanceData, setPerformanceData] = useState<InvestmentPerformanceResponse | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceError, setPerformanceError] = useState<Error | null>(null);
  const [positions, setPositions] = useState<InvestmentPosition[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsError, setPositionsError] = useState<Error | null>(null);
  const [investmentActivity, setInvestmentActivity] = useState<InvestmentData | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<Error | null>(null);
  const [coverageData, setCoverageData] = useState<InvestmentCoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState<Error | null>(null);
  const [realEstateRefreshKey, setRealEstateRefreshKey] = useState(0);
  const [selectedPikadonAccount, setSelectedPikadonAccount] = useState<InvestmentAccountSummary | null>(null);
  const [selectedRealEstateAccount, setSelectedRealEstateAccount] = useState<InvestmentAccountSummary | null>(null);
  const portfolioRequestIdRef = useRef(0);
  const historyRequestIdRef = useRef(0);
  const performanceRequestIdRef = useRef(0);
  const positionsRequestIdRef = useRef(0);
  const activityRequestIdRef = useRef(0);
  const coverageRequestIdRef = useRef(0);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const requestedTab = searchParams.get('tab');

    if (requestedTab === 'holdings' && activeTab !== 1) {
      setActiveTab(1);
    }
  }, [activeTab, location.search]);

  const {
    data: balanceSheetData,
    loading: balanceSheetLoading,
    error: balanceSheetError,
    refresh: refreshBalanceSheet,
  } = useInvestmentBalanceSheet({ enabled: isOnboardingResolved && !isLocked });

  const fetchPortfolioData = useCallback(async (): Promise<PortfolioSummary | null> => {
    if (shouldBlockPageData) {
      portfolioRequestIdRef.current += 1;
      setPortfolioLoading(false);
      setPortfolioError(null);
      return null;
    }
    const requestId = ++portfolioRequestIdRef.current;
    setPortfolioLoading(true);
    setPortfolioError(null);
    try {
      const response = await apiClient.get<PortfolioSummary>(
        '/api/investments/summary?normalizeCurrencies=true',
      );
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch portfolio data');
      }
      const nextPortfolio = response.data as PortfolioSummary;
      if (!nextPortfolio?.summary || !Array.isArray(nextPortfolio.accounts)) {
        throw new Error('Portfolio response is incomplete');
      }
      if (requestId !== portfolioRequestIdRef.current) return null;
      setPortfolioData(nextPortfolio);
      return nextPortfolio;
    } catch (error) {
      console.error('Error fetching portfolio data:', error);
      if (requestId === portfolioRequestIdRef.current) {
        setPortfolioError(error instanceof Error ? error : new Error('Failed to fetch portfolio data'));
      }
      return null;
    } finally {
      if (requestId === portfolioRequestIdRef.current) {
        setPortfolioLoading(false);
      }
    }
  }, [shouldBlockPageData]);

  const fetchHistoryData = useCallback(async (portfolioOverride?: PortfolioSummary | null) => {
    const sourcePortfolio = portfolioOverride ?? portfolioData;
    if (shouldBlockPageData || !sourcePortfolio?.summary || sourcePortfolio.summary.totalAccounts === 0) {
      historyRequestIdRef.current += 1;
      setOverallHistory([]);
      setAccountHistories({});
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }

    const requestId = ++historyRequestIdRef.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const uniqueAccountIds = getPortfolioAccountIds(sourcePortfolio, chartScope);
      if (uniqueAccountIds.length === 0) {
        if (requestId === historyRequestIdRef.current) {
          setOverallHistory([]);
          setAccountHistories({});
        }
        return;
      }

      const params = new URLSearchParams({ timeRange: historyTimeRange });
      params.append('includeAccounts', '1');
      params.append('normalizeCurrencies', '1');
      params.append('assetScope', chartScope);
      uniqueAccountIds.forEach((id) => params.append('accountIds', id.toString()));

      const response = await apiClient.get<PortfolioHistoryResponse>(
        `/api/investments/history?${params.toString()}`,
      );

      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch portfolio history');
      }

      const historyResult = (response.data as PortfolioHistoryResponse) || {};
      if (requestId !== historyRequestIdRef.current) return;
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
      if (requestId === historyRequestIdRef.current) {
        setHistoryError(error instanceof Error ? error : new Error('Failed to fetch portfolio history'));
      }
    } finally {
      if (requestId === historyRequestIdRef.current) {
        setHistoryLoading(false);
      }
    }
  }, [chartScope, historyTimeRange, portfolioData, shouldBlockPageData]);

  const fetchPerformanceData = useCallback(async (portfolioOverride?: PortfolioSummary | null) => {
    if (shouldBlockPageData) {
      performanceRequestIdRef.current += 1;
      setPerformanceLoading(false);
      setPerformanceError(null);
      return;
    }
    const requestId = ++performanceRequestIdRef.current;
    setPerformanceLoading(true);
    setPerformanceError(null);
    try {
      const sourcePortfolio = portfolioOverride ?? portfolioData;
      const params = new URLSearchParams({
        range: historyTimeRange,
        assetScope: chartScope,
        normalizeCurrencies: '1',
        includePositionEvents: '1',
      });
      if (sourcePortfolio) {
        const uniqueAccountIds = getPortfolioAccountIds(sourcePortfolio, chartScope);
        uniqueAccountIds.forEach((id) => params.append('accountIds', id.toString()));
      }

      const response = await apiClient.get<InvestmentPerformanceResponse>(
        `/api/investments/performance?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch investment performance');
      }
      if (requestId !== performanceRequestIdRef.current) return;
      setPerformanceData(response.data as InvestmentPerformanceResponse);
    } catch (error) {
      console.error('Error fetching investment performance:', error);
      if (requestId === performanceRequestIdRef.current) {
        setPerformanceError(error instanceof Error ? error : new Error('Failed to fetch investment performance'));
      }
    } finally {
      if (requestId === performanceRequestIdRef.current) {
        setPerformanceLoading(false);
      }
    }
  }, [chartScope, historyTimeRange, portfolioData, shouldBlockPageData]);

  const fetchInvestmentActivity = useCallback(async () => {
    if (shouldBlockPageData) {
      activityRequestIdRef.current += 1;
      setActivityLoading(false);
      setActivityError(null);
      return;
    }
    const requestId = ++activityRequestIdRef.current;
    setActivityLoading(true);
    setActivityError(null);
    try {
      const rangeDates = getRangeDates(historyTimeRange);
      const response = await apiClient.get<InvestmentData>('/api/analytics/investments', {
        params: rangeDates,
      });
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch investment activity');
      }
      if (requestId !== activityRequestIdRef.current) return;
      setInvestmentActivity(response.data as InvestmentData);
    } catch (error) {
      console.error('Error fetching investment activity:', error);
      if (requestId === activityRequestIdRef.current) {
        setActivityError(error instanceof Error ? error : new Error('Failed to fetch investment activity'));
      }
    } finally {
      if (requestId === activityRequestIdRef.current) {
        setActivityLoading(false);
      }
    }
  }, [historyTimeRange, shouldBlockPageData]);

  const fetchPositions = useCallback(async () => {
    if (shouldBlockPageData) {
      positionsRequestIdRef.current += 1;
      setPositions([]);
      setPositionsError(null);
      setPositionsLoading(false);
      return;
    }

    const requestId = ++positionsRequestIdRef.current;
    setPositionsLoading(true);
    setPositionsError(null);
    try {
      const response = await apiClient.get<InvestmentPositionsResponse>('/api/investments/positions', {
        params: { status: 'open' },
      });
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch investment positions');
      }
      if (requestId !== positionsRequestIdRef.current) return;
      setPositions(Array.isArray(response.data?.positions) ? response.data.positions : []);
    } catch (error) {
      console.error('Error fetching investment positions:', error);
      if (requestId === positionsRequestIdRef.current) {
        setPositionsError(error instanceof Error ? error : new Error('Failed to fetch investment positions'));
      }
    } finally {
      if (requestId === positionsRequestIdRef.current) {
        setPositionsLoading(false);
      }
    }
  }, [shouldBlockPageData]);

  const fetchCoverage = useCallback(async () => {
    if (shouldBlockPageData) {
      coverageRequestIdRef.current += 1;
      setCoverageLoading(false);
      setCoverageError(null);
      return;
    }
    const requestId = ++coverageRequestIdRef.current;
    setCoverageLoading(true);
    setCoverageError(null);
    try {
      const response = await apiClient.get<InvestmentCoverageResponse>(
        '/api/investments/coverage?thresholdDays=90',
        { cacheMode: 'no-store' },
      );
      if (!response.ok) throw new Error(response.statusText || 'Failed to fetch investment coverage');
      if (requestId !== coverageRequestIdRef.current) return;
      setCoverageData(response.data || null);
    } catch (error) {
      if (requestId === coverageRequestIdRef.current) {
        setCoverageError(error instanceof Error ? error : new Error('Failed to fetch investment coverage'));
      }
    } finally {
      if (requestId === coverageRequestIdRef.current) setCoverageLoading(false);
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
      void fetchCoverage();
    }
  }, [fetchCoverage, fetchInvestmentActivity, fetchPerformanceData, fetchPositions, refreshTrigger, shouldBlockPageData]);

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
        fetchPerformanceData(nextPortfolio),
        fetchInvestmentActivity(),
        fetchPositions(),
        fetchCoverage(),
        refreshBalanceSheet(),
      ]);
      setRealEstateRefreshKey((current) => current + 1);
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    fetchHistoryData,
    fetchInvestmentActivity,
    fetchCoverage,
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
    if (account.account_type === 'savings') {
      setSelectedPikadonAccount(account);
    } else if (account.account_type === 'real_estate') {
      setSelectedRealEstateAccount(account);
    }
  }, []);

  const handleRealEstatePropertyEdit = useCallback((accountId: number) => {
    const account = portfolioData?.accounts?.find((item) => item.id === accountId);
    if (account?.account_type === 'real_estate') {
      setSelectedRealEstateAccount(account);
    }
  }, [portfolioData]);

  if (showLoading) {
    return <LoadingState fullHeight message={t('loading.setup')} />;
  }

  if (isLocked) {
    return <LockedPagePlaceholder page="investments" onboardingStatus={onboardingStatus} />;
  }

  const hasPortfolio = Boolean(portfolioData?.summary && portfolioData.summary.totalAccounts > 0);
  const portfolio = hasPortfolio ? (portfolioData as PortfolioSummary) : null;
  const fxIncomplete = portfolioData?.fx?.complete === false || balanceSheetData?.fx?.complete === false;
  const transactions = investmentActivity?.transactions || [];
  const portfolioCoverageLoading = portfolioLoading || balanceSheetLoading || coverageLoading;
  const renderResourceError = (
    error: Error | null,
    hasStaleData: boolean,
    resource: string,
    onRetry: () => void,
  ) => {
    if (!error) return null;

    return (
      <Alert
        severity={hasStaleData ? 'warning' : 'error'}
        sx={{ borderRadius: 2 }}
        action={(
          <Button color="inherit" size="small" onClick={onRetry}>
            {t('errors.retry')}
          </Button>
        )}
      >
        {hasStaleData
          ? t('errors.showingPrevious', { resource })
          : t('errors.loadFailed', { resource })}
      </Alert>
    );
  };

  const investmentTabs = [
    { id: 0, icon: <DashboardIcon sx={{ fontSize: 20 }} />, label: t('tabs.overview', 'Overview') },
    { id: 1, icon: <WalletIcon sx={{ fontSize: 20 }} />, label: t('tabs.holdings', 'Holdings & Balance') },
    { id: 2, icon: <RealEstateIcon sx={{ fontSize: 20 }} />, label: t('tabs.realEstate', 'Real Estate') },
    { id: 3, icon: <ValuationIcon sx={{ fontSize: 20 }} />, label: t('tabs.performance', 'Performance Analytics') },
    { id: 4, icon: <HistoryIcon sx={{ fontSize: 20 }} />, label: t('tabs.history', 'History & Details') },
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
        width: '100%',
        minWidth: 0,
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
          <Typography variant="h5" sx={{
            fontWeight: 700
          }}>
            {t('header.title')}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
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
      ) : portfolioError && !hasPortfolio ? (
        <Paper elevation={0} sx={{ p: 4, mt: 4 }}>
          {renderResourceError(
            portfolioError,
            false,
            t('errors.resources.portfolio'),
            () => void fetchPortfolioData(),
          )}
        </Paper>
      ) : hasPortfolio ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}>
          {renderResourceError(
            portfolioError,
            true,
            t('errors.resources.portfolio'),
            () => void fetchPortfolioData(),
          )}

          {fxIncomplete && (
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              {t('warnings.multiCurrency')}
            </Alert>
          )}

          {/* Tabs bar with actions */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: { xs: 'wrap', lg: 'nowrap' },
              gap: 1.5,
              p: 0.75,
              width: '100%',
              minWidth: 0,
              borderRadius: '16px',
              bgcolor: alpha(theme.palette.background.paper, 0.5),
              backdropFilter: 'blur(24px)',
              border: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.08),
              boxShadow: `0 4px 24px 0 ${alpha(theme.palette.common.black, 0.04)}, 0 1px 2px 0 ${alpha(theme.palette.common.black, 0.03)}`,
            }}
          >
            {/* Tab buttons */}
            <Tabs
              value={activeTab}
              onChange={(_event, nextTab: number) => setActiveTab(nextTab)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              aria-label={t('tabs.ariaLabel', 'Investment sections')}
              sx={{
                flex: { xs: '1 0 100%', lg: '1 1 auto' },
                width: { xs: '100%', lg: 'auto' },
                minWidth: 0,
                minHeight: 36,
                '& .MuiTabs-flexContainer': {
                  gap: 0.5,
                },
                '& .MuiTabs-indicator': {
                  display: 'none',
                },
                '& .MuiTabs-scrollButtons': {
                  width: 28,
                  minHeight: 36,
                  flexShrink: 0,
                  borderRadius: '10px',
                  color: 'text.secondary',
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    color: 'text.primary',
                  },
                  '&.Mui-disabled': {
                    opacity: 0,
                  },
                },
              }}
            >
              {investmentTabs.map((tab) => {
                const isSelected = activeTab === tab.id;
                return (
                  <Tab
                    key={tab.id}
                    value={tab.id}
                    icon={tab.icon}
                    iconPosition="start"
                    aria-label={tab.label}
                    title={tab.label}
                    label={(
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{
                          fontWeight: isSelected ? 600 : 500,
                          display: { xs: 'none', md: 'block' },
                          whiteSpace: 'nowrap',
                          fontSize: '0.8125rem'
                        }}>
                        {tab.label}
                      </Typography>
                    )}
                    sx={{
                      flex: '0 0 auto',
                      minWidth: { xs: 40, md: 'auto' },
                      minHeight: 36,
                      height: 36,
                      gap: 0.75,
                      px: { xs: 1.25, md: 1.75 },
                      py: 0,
                      borderRadius: '10px',
                      textTransform: 'none',
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                      color: 'text.secondary',
                      '&.Mui-selected': {
                        color: theme.palette.primary.contrastText,
                        background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
                        boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.3)}, 0 1px 3px ${alpha(theme.palette.primary.main, 0.2)}`,
                      },
                      '&:hover:not(.Mui-selected)': {
                        bgcolor: alpha(theme.palette.primary.main, 0.08),
                        color: 'text.primary',
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
                  />
                );
              })}
            </Tabs>

            {/* Time range selector */}
            {(activeTab === 0 || activeTab === 3 || activeTab === 4) && (
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

            {(activeTab === 0 || activeTab === 3 || activeTab === 4) && (
              <Select
                value={chartScope}
                onChange={(e) => setChartScope(e.target.value as PortfolioChartScopeOption)}
                size="small"
                variant="outlined"
                sx={{
                  minWidth: 146,
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
                {CHART_SCOPE_OPTIONS.map((scope) => (
                  <MenuItem key={scope.value} value={scope.value} sx={{ fontSize: '0.8125rem', fontWeight: 500 }}>
                    {t(scope.labelKey, scope.fallback)}
                  </MenuItem>
                ))}
              </Select>
            )}

            {/* Divider */}
            <Box sx={{ width: '1px', height: 24, bgcolor: alpha(theme.palette.divider, 0.15), flexShrink: 0 }} />

            {/* Action buttons */}
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
              <Typography
                aria-hidden="true"
                variant="caption"
                sx={{
                  px: 1,
                  py: 0.35,
                  borderRadius: 1.5,
                  bgcolor: alpha(theme.palette.background.paper, 0.8),
                  border: `1px solid ${alpha(theme.palette.divider, 0.16)}`,
                  color: 'text.secondary',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                }}
              >
                {refreshShortcutLabel}
              </Typography>
              <Tooltip title={`${t('actions.refreshTooltip')} • ${refreshShortcutLabel}`}>
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

          {fxIncomplete && (
            <Alert
              severity="warning"
              sx={{ borderRadius: 2 }}
              action={(
                <Button color="inherit" size="small" onClick={() => setActiveTab(1)}>
                  {t('fx.manageRates')}
                </Button>
              )}
            >
              {t('fx.missingRatesWarning')}
            </Alert>
          )}

          {/* Overview Tab */}
          {activeTab === 0 && (
            <Box role="tabpanel" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {renderResourceError(
                historyError,
                overallHistory.length > 0 || Object.keys(accountHistories).length > 0,
                t('errors.resources.history'),
                () => void fetchHistoryData(),
              )}
              <Grid container spacing={3} sx={{ flexShrink: 0 }}>
                <Grid size={{ xs: 12, lg: 8 }}>
                  <Box sx={{ height: { xs: 400, lg: 380 } }}>
                    <PortfolioValuePanel
                      portfolioData={portfolio}
                      overallHistory={overallHistory}
                      performanceData={performanceData}
                      displayValue={getPortfolioScopeTotal(portfolio, chartScope)}
                      viewMode={chartViewMode}
                      onViewModeChange={setChartViewMode}
                      loading={
                        (portfolioLoading && !portfolioData)
                        || (historyLoading && overallHistory.length === 0)
                      }
                    />
                  </Box>
                </Grid>

                <Grid size={{ xs: 12, lg: 4 }}>
                  <Box sx={{ height: { xs: 350, lg: 380 } }}>
                    <AllocationDonutChart
                      portfolioData={portfolio as PortfolioSummary}
                      scope={chartScope}
                    />
                  </Box>
                </Grid>
              </Grid>

              <PerformanceCardsSection
                portfolioData={portfolio as PortfolioSummary}
                accountHistories={accountHistories}
                categoryFilter={categoryFilter}
                onCategoryFilterChange={setCategoryFilter}
                onAccountClick={handleAccountClick}
                scope={chartScope}
              />
            </Box>
          )}

          {/* Holdings & Balance Tab */}
          {activeTab === 1 && (
            <Box role="tabpanel" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {renderResourceError(
                positionsError,
                positions.length > 0,
                t('errors.resources.positions'),
                () => void fetchPositions(),
              )}
              <HoldingsPositionsSection
                portfolioData={portfolio}
                positions={positions}
                onChanged={handleRefreshAll}
                loading={
                  (positionsLoading && positions.length === 0)
                  || (portfolioLoading && !portfolioData)
                }
              />

              <BalanceSheetSection
                data={balanceSheetData}
                loading={balanceSheetLoading}
                error={balanceSheetError}
                onRetry={() => void refreshBalanceSheet()}
              />

              <LiabilitiesManager onChanged={handleRefreshAll} />

              <FxSettingsPanel
                currencies={balanceSheetData?.assets.currencies.distinct || []}
                onChanged={handleRefreshAll}
              />
            </Box>
          )}

          {/* Real Estate Tab */}
          {activeTab === 2 && (
            <RealEstateOverviewSection
              refreshSignal={realEstateRefreshKey + refreshTrigger}
              onEditProperty={handleRealEstatePropertyEdit}
            />
          )}

          {/* Performance Analytics Tab */}
          {activeTab === 3 && (
            <Box role="tabpanel" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {renderResourceError(
                performanceError,
                Boolean(performanceData),
                t('errors.resources.performance'),
                () => void fetchPerformanceData(),
              )}
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, lg: 8 }}>
                  <Box sx={{ minHeight: 420 }}>
                    <PerformanceBreakdownPanel
                      data={performanceData}
                      loading={performanceLoading && !performanceData}
                      multiCurrencyWarning={fxIncomplete}
                    />
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, lg: 4 }}>
                  <Box sx={{ minHeight: 420 }}>
                    <PortfolioCoveragePanel
                      portfolioData={portfolio}
                      balanceSheet={balanceSheetData}
                      unlinkedTransactionCount={coverageData?.unlinkedTransactions?.count || 0}
                      loading={portfolioCoverageLoading}
                      error={balanceSheetError || coverageError}
                      onRetry={() => void Promise.all([refreshBalanceSheet(), fetchCoverage()])}
                      onManageAccounts={(itemId, accountId) => openAccountsManagement({
                        tab: 'investments',
                        valuationAccountId: itemId === 'missingValuations' || itemId === 'staleValuations'
                          ? accountId
                          : undefined,
                        editInvestmentAccountId: itemId === 'missingCurrency' ? accountId : undefined,
                      })}
                    />
                  </Box>
                </Grid>
              </Grid>
              {portfolio && (
                <AllocationTargetsPanel
                  portfolioData={portfolio}
                  fxComplete={portfolio.fx?.complete !== false && balanceSheetData?.fx?.complete !== false}
                  valuationsComplete={balanceSheetData?.missingValuationsCount === 0}
                  baseCurrency={portfolio.fx?.baseCurrency || balanceSheetData?.baseCurrency || 'ILS'}
                />
              )}
              <BenchmarkComparisonPanel performance={performanceData} />
            </Box>
          )}

          {/* History Tab */}
          {activeTab === 4 && (
            <Box role="tabpanel" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {renderResourceError(
                historyError,
                overallHistory.length > 0 || Object.keys(accountHistories).length > 0,
                t('errors.resources.history'),
                () => void fetchHistoryData(),
              )}
              {renderResourceError(
                activityError,
                Boolean(investmentActivity),
                t('errors.resources.activity'),
                () => void fetchInvestmentActivity(),
              )}
              <Grid container spacing={3} sx={{ minHeight: 480 }}>
                <Grid size={{ xs: 12, lg: 8 }}>
                  <Box sx={{ height: { xs: 520, lg: 500 } }}>
                    <PortfolioHistorySection
                      overallHistory={overallHistory}
                      accountHistories={accountHistories}
                      portfolioData={portfolio as PortfolioSummary}
                      transactions={transactions}
                      loadingHistory={historyLoading && overallHistory.length === 0}
                      loadingTransactions={activityLoading && !investmentActivity}
                      scope={chartScope}
                    />
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, lg: 4 }}>
                  <Box sx={{ height: { xs: 420, lg: 500 } }}>
                    <PortfolioBreakdownSection
                      portfolioData={portfolio as PortfolioSummary}
                      onAccountClick={handleAccountClick}
                      scope={chartScope}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Box>
          )}

          <PikadonAccountDetailsDialog
            open={Boolean(selectedPikadonAccount)}
            account={selectedPikadonAccount}
            onClose={() => setSelectedPikadonAccount(null)}
          />
          <RealEstateSimulatorDialog
            open={Boolean(selectedRealEstateAccount)}
            account={selectedRealEstateAccount}
            onClose={() => setSelectedRealEstateAccount(null)}
            onSaved={handleRefreshAll}
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
          <Typography variant="h5" gutterBottom sx={{
            fontWeight: 600
          }}>
            {t('empty.title')}
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              mb: 4,
              maxWidth: 560,
              mx: 'auto'
            }}>
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
