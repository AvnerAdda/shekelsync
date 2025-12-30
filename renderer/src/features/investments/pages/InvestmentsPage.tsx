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
  ToggleButtonGroup,
  ToggleButton,
  Grid,
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
  InvestmentData,
  PortfolioSummary,
  PortfolioHistoryResponse,
  PortfolioHistoryPoint,
} from '@renderer/types/investments';
import {
  InvestmentsFiltersProvider,
  useInvestmentsFilters,
} from '../InvestmentsFiltersContext';
import PortfolioHistorySection from '../components/PortfolioHistorySection';
import PortfolioBreakdownSection from '../components/PortfolioBreakdownSection';

const InvestmentsPageContent: React.FC = () => {
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage' });
  const { getPageAccessStatus, status: onboardingStatus } = useOnboarding();
  const accessStatus = getPageAccessStatus('investments');
  const isLocked = accessStatus.isLocked;

  const {
    dateRange,
    historyTimeRange,
    refreshTrigger,
    triggerRefresh,
    isRefreshing,
    setIsRefreshing,
    setDateRange,
    viewMode,
    setViewMode,
  } = useInvestmentsFilters();

  const [data, setData] = useState<InvestmentData | null>(null);
  const [portfolioData, setPortfolioData] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioModalOpen, setPortfolioModalOpen] = useState(false);
  const [portfolioModalTab, setPortfolioModalTab] = useState(0);

  const [overallHistory, setOverallHistory] = useState<PortfolioHistoryPoint[]>([]);
  const [accountHistories, setAccountHistories] = useState<
    Record<number, PortfolioHistoryPoint[]>
  >({});
  const [historyLoading, setHistoryLoading] = useState(false);

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

  const fetchData = useCallback(async () => {
    if (isLocked) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();

      if (dateRange !== 'all') {
        const endDate = new Date();
        const startDate = new Date();

        switch (dateRange) {
          case '3m':
            startDate.setMonth(endDate.getMonth() - 3);
            break;
          case '6m':
            startDate.setMonth(endDate.getMonth() - 6);
            break;
          case '1y':
            startDate.setFullYear(endDate.getFullYear() - 1);
            break;
        }

        params.append('startDate', startDate.toISOString().split('T')[0]);
        params.append('endDate', endDate.toISOString().split('T')[0]);
      }

      const response = await apiClient.get(`/api/analytics/investments?${params}`);
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch investments analytics');
      }
      setData(response.data as InvestmentData);
    } catch (error) {
      console.error('Error fetching investment data:', error);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateRange, isLocked]);

  useEffect(() => {
    fetchData();
    fetchPortfolioData();
  }, [fetchData, fetchPortfolioData, refreshTrigger]);

  const handleSetupComplete = () => {
    triggerRefresh();
  };

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        fetchData(),
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

  return (
    <Box sx={{ p: 3, height: { xs: 'auto', lg: 'calc(100vh - 64px)' }, display: 'flex', flexDirection: 'column', overflow: { xs: 'auto', lg: 'hidden' } }}>
      <InvestmentAccountsModal
        open={portfolioModalOpen}
        onClose={() => setPortfolioModalOpen(false)}
        onComplete={handleSetupComplete}
        defaultTab={portfolioModalTab}
      />

      {/* Header */}
      <Box sx={{ mb: 2, flexShrink: 0 }}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            mb: 2,
          }}
        >
          <Box>
            <Typography variant="h4" fontWeight="bold" gutterBottom>
              {t('header.title')}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {t('header.subtitle')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Tooltip title={t('actions.refreshTooltip')}>
              <Button
                variant="outlined"
                startIcon={isRefreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
                onClick={handleRefreshAll}
                disabled={isRefreshing}
                size="small"
                sx={{ textTransform: 'none', minWidth: 100 }}
              >
                {isRefreshing ? t('actions.refreshing') : t('actions.refresh')}
              </Button>
            </Tooltip>
            <Button
              variant="outlined"
              startIcon={<SettingsIcon />}
              onClick={() => {
                setPortfolioModalTab(0);
                setPortfolioModalOpen(true);
              }}
              size="small"
              sx={{ textTransform: 'none' }}
            >
              {t('actions.portfolioSetup')}
            </Button>
          </Box>
        </Box>

        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 2,
            alignItems: 'center',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('filters.rangeLabel')}
            </Typography>
            <ToggleButtonGroup
              value={dateRange}
              exclusive
              onChange={(_, value: typeof dateRange | null) => value && setDateRange(value)}
              size="small"
            >
              <ToggleButton value="3m">{t('history.ranges.3m')}</ToggleButton>
              <ToggleButton value="6m">{t('history.ranges.6m')}</ToggleButton>
              <ToggleButton value="1y">{t('history.ranges.1y')}</ToggleButton>
              <ToggleButton value="all">{t('history.ranges.all')}</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('filters.viewLabel')}
            </Typography>
            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={(_, value: typeof viewMode | null) => value && setViewMode(value)}
              size="small"
            >
              <ToggleButton value="summary">{t('filters.view.summary')}</ToggleButton>
              <ToggleButton value="detailed">{t('filters.view.detailed')}</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>
      </Box>

      {/* Sections */}
      <Box sx={{ flexGrow: 1, minHeight: 0, overflow: { xs: 'visible', lg: 'hidden' } }}>
        <Grid container spacing={2} sx={{ height: { xs: 'auto', lg: '100%' } }}>
          <Grid item xs={12} lg={9} sx={{ height: { xs: 'auto', lg: '100%' }, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'hidden' }}>
              {portfolioData && portfolioData.summary.totalAccounts > 0 ? (
                <PortfolioHistorySection
                  overallHistory={overallHistory}
                  accountHistories={accountHistories}
                  portfolioData={portfolioData}
                  transactions={data?.transactions || []}
                  loadingHistory={historyLoading}
                  loadingTransactions={loading}
                />
              ) : (
                !portfolioLoading && (
                  <Paper sx={{ p: 4, textAlign: 'center', mt: 4 }}>
                    <AccountIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h5" gutterBottom fontWeight="medium">
                      {t('empty.title')}
                    </Typography>
                    <Typography
                      variant="body1"
                      color="text.secondary"
                      sx={{ mb: 3, maxWidth: 500, mx: 'auto' }}
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
          </Grid>

          <Grid item xs={12} lg={3} sx={{ height: { xs: 'auto', lg: '100%' } }}>
            <Box sx={{ height: '100%', overflowY: 'auto', pr: 1 }}>
              {portfolioData && portfolioData.summary.totalAccounts > 0 && (
                <PortfolioBreakdownSection
                  portfolioData={portfolioData}
                  accountHistories={accountHistories}
                  historyLoading={historyLoading}
                />
              )}
            </Box>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
};

const InvestmentsPage: React.FC = () => (
  <InvestmentsFiltersProvider>
    <InvestmentsPageContent />
  </InvestmentsFiltersProvider>
);

export default InvestmentsPage;
