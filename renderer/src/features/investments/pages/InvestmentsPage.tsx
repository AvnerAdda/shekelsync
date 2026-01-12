import React, { useState, useEffect, useCallback } from 'react';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import LockedPagePlaceholder from '@renderer/shared/empty-state/LockedPagePlaceholder';
import {
  Box,
  Typography,
  Button,
  Paper,
  Tooltip,
  CircularProgress,
  Grid,
  useTheme,
  alpha,
  IconButton,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Refresh as RefreshIcon,
  Add as AddIcon,
  AccountBalance as AccountIcon,
} from '@mui/icons-material';
import { apiClient } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import InvestmentAccountsModal from '../components/InvestmentAccountsModal';
import {
  PortfolioSummary,
  PortfolioHistoryResponse,
  PortfolioHistoryPoint,
} from '@renderer/types/investments';
import {
  InvestmentsFiltersProvider,
  useInvestmentsFilters,
  HistoryTimeRangeOption,
} from '../InvestmentsFiltersContext';
import PortfolioValuePanel from '../components/PortfolioValuePanel';
import AllocationDonutChart from '../components/AllocationDonutChart';
import PerformanceCardsSection from '../components/PerformanceCardsSection';

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
    triggerRefresh,
    isRefreshing,
    setIsRefreshing,
  } = useInvestmentsFilters();

  const [portfolioData, setPortfolioData] = useState<PortfolioSummary | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioModalOpen, setPortfolioModalOpen] = useState(false);
  const [portfolioModalTab, setPortfolioModalTab] = useState(0);

  const [overallHistory, setOverallHistory] = useState<PortfolioHistoryPoint[]>([]);
  const [accountHistories, setAccountHistories] = useState<
    Record<number, PortfolioHistoryPoint[]>
  >({});
  const [historyLoading, setHistoryLoading] = useState(false);

  // New state for the dashboard
  const [chartViewMode, setChartViewMode] = useState<'value' | 'performance'>('value');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const fetchHistoryData = useCallback(async () => {
    if (isLocked) return;
    setHistoryLoading(true);
    try {
      const overallPromise = apiClient.get(`/api/investments/history?timeRange=${historyTimeRange}`);

      const accountIds =
        portfolioData?.breakdown
          ?.flatMap((group) => group.accounts?.map((account) => account.id).filter(Boolean) || [])
          .filter((id): id is number => typeof id === 'number') || [];

      const uniqueAccountIds = Array.from(new Set(accountIds));

      const accountHistoryPromises = uniqueAccountIds.map(async (accountId) => {
        try {
          const accountResponse = await apiClient.get(
            `/api/investments/history?accountId=${accountId}&timeRange=${historyTimeRange}`
          );
          if (accountResponse.ok) {
            const accountResult = (accountResponse.data as PortfolioHistoryResponse) || {};
            return {
              accountId,
              history: Array.isArray(accountResult.history) ? accountResult.history : [],
            };
          }
        } catch (innerError) {
          console.error(`Error fetching history for account ${accountId}:`, innerError);
        }
        return { accountId, history: [] as PortfolioHistoryPoint[] };
      });

      const [overallResponse, accountResults] = await Promise.all([
        overallPromise,
        Promise.all(accountHistoryPromises),
      ]);

      if (overallResponse.ok) {
        const overallResult = (overallResponse.data as PortfolioHistoryResponse) || {};
        setOverallHistory(Array.isArray(overallResult.history) ? overallResult.history : []);
      } else {
        setOverallHistory([]);
      }

      const histories: Record<number, PortfolioHistoryPoint[]> = {};
      accountResults.forEach(({ accountId, history }) => {
        histories[accountId] = history;
      });
      setAccountHistories(histories);
    } catch (error) {
      console.error('Error fetching history data:', error);
      setOverallHistory([]);
      setAccountHistories({});
    } finally {
      setHistoryLoading(false);
    }
  }, [historyTimeRange, isLocked, portfolioData]);

  // Fetch history when portfolio data loads or time range changes
  useEffect(() => {
    if (portfolioData && portfolioData.summary.totalAccounts > 0) {
      fetchHistoryData();
    }
  }, [fetchHistoryData]);

  const fetchPortfolioData = useCallback(async () => {
    if (isLocked) return;
    setPortfolioLoading(true);
    try {
      const response = await apiClient.get('/api/investments/summary');
      if (response.ok) {
        setPortfolioData(response.data as PortfolioSummary);
      } else {
        throw new Error('Failed to fetch portfolio data');
      }
    } catch (error) {
      console.error('Error fetching portfolio data:', error);
      setPortfolioData(null);
    } finally {
      setPortfolioLoading(false);
    }
  }, [isLocked]);

  useEffect(() => {
    fetchPortfolioData();
  }, [fetchPortfolioData, refreshTrigger]);

  const handleSetupComplete = () => {
    triggerRefresh();
  };

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        fetchPortfolioData(),
        portfolioData && portfolioData.summary.totalAccounts > 0
          ? fetchHistoryData()
          : Promise.resolve(),
      ]);
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLocked) {
    return <LockedPagePlaceholder page="investments" onboardingStatus={onboardingStatus} />;
  }

  const hasPortfolio = portfolioData && portfolioData.summary.totalAccounts > 0;

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
      <InvestmentAccountsModal
        open={portfolioModalOpen}
        onClose={() => setPortfolioModalOpen(false)}
        onComplete={handleSetupComplete}
        defaultTab={portfolioModalTab}
      />

      {/* Minimal Header */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
          flexShrink: 0,
        }}
      >
        <Typography variant="h5" fontWeight={700}>
          {t('header.title')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title={t('actions.refreshTooltip')}>
            <IconButton
              onClick={handleRefreshAll}
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
          <Tooltip title={t('actions.portfolioSetup')}>
            <IconButton
              onClick={() => {
                setPortfolioModalTab(0);
                setPortfolioModalOpen(true);
              }}
              size="small"
              sx={{
                bgcolor: alpha(theme.palette.action.selected, 0.1),
                '&:hover': {
                  bgcolor: alpha(theme.palette.action.selected, 0.2),
                },
              }}
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {hasPortfolio ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}>
          {/* Top Row: Portfolio Value Panel + Allocation Chart */}
          <Grid container spacing={3} sx={{ flexShrink: 0 }}>
            {/* Portfolio Value Panel - 2/3 width */}
            <Grid item xs={12} lg={8}>
              <Box sx={{ height: { xs: 400, lg: 380 } }}>
                <PortfolioValuePanel
                  portfolioData={portfolioData}
                  overallHistory={overallHistory}
                  historyTimeRange={historyTimeRange}
                  onTimeRangeChange={(range: HistoryTimeRangeOption) => setHistoryTimeRange(range)}
                  viewMode={chartViewMode}
                  onViewModeChange={setChartViewMode}
                  loading={portfolioLoading || historyLoading}
                />
              </Box>
            </Grid>

            {/* Allocation Donut Chart - 1/3 width */}
            <Grid item xs={12} lg={4}>
              <Box sx={{ height: { xs: 350, lg: 380 } }}>
                <AllocationDonutChart portfolioData={portfolioData} />
              </Box>
            </Grid>
          </Grid>

          {/* Bottom Row: Performance Cards */}
          <Box sx={{ flexShrink: 0 }}>
            <PerformanceCardsSection
              portfolioData={portfolioData}
              accountHistories={accountHistories}
              categoryFilter={categoryFilter}
              onCategoryFilterChange={setCategoryFilter}
            />
          </Box>
        </Box>
      ) : (
        !portfolioLoading && (
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
              sx={{ mb: 4, maxWidth: 500, mx: 'auto' }}
            >
              {t('empty.description')}
            </Typography>
            <Button
              variant="contained"
              size="large"
              startIcon={<AddIcon />}
              onClick={() => {
                setPortfolioModalTab(0);
                setPortfolioModalOpen(true);
              }}
              sx={{ borderRadius: 2, textTransform: 'none', px: 4 }}
            >
              {t('empty.cta')}
            </Button>
          </Paper>
        )
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
