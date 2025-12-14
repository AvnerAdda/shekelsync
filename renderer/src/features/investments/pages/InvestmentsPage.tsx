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
import InvestmentsSummarySection from '../components/InvestmentsSummarySection';
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
      const overallResponse = await apiClient.get(
        `/api/investments/history?timeRange=${historyTimeRange}`
      );
      if (overallResponse.ok) {
        const overallResult = (overallResponse.data as PortfolioHistoryResponse) || {};
        setOverallHistory(Array.isArray(overallResult.history) ? overallResult.history : []);
      } else {
        setOverallHistory([]);
      }

      if (portfolioData?.breakdown) {
        const histories: Record<number, PortfolioHistoryPoint[]> = {};

        for (const group of portfolioData.breakdown) {
          for (const account of group.accounts) {
            if (account.id) {
              try {
                const accountResponse = await apiClient.get(
                  `/api/investments/history?accountId=${account.id}&timeRange=${historyTimeRange}`
                );
                if (accountResponse.ok) {
                  const accountResult =
                    (accountResponse.data as PortfolioHistoryResponse) || {};
                  histories[account.id] = Array.isArray(accountResult.history)
                    ? accountResult.history
                    : [];
                } else {
                  histories[account.id] = [];
                }
              } catch (innerError) {
                console.error(
                  `Error fetching history for account ${account.id}:`,
                  innerError
                );
              }
            }
          }
        }

        setAccountHistories(histories);
      }
    } catch (error) {
      console.error('Error fetching history data:', error);
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
    <Box sx={{ p: 3 }}>
      <InvestmentAccountsModal
        open={portfolioModalOpen}
        onClose={() => setPortfolioModalOpen(false)}
        onComplete={handleSetupComplete}
        defaultTab={portfolioModalTab}
      />

      {/* Header */}
      <Box sx={{ mb: 4 }}>
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
      </Box>

      {/* Sections */}
      <InvestmentsSummarySection portfolioData={portfolioData} loading={portfolioLoading} />

      {portfolioData && portfolioData.summary.totalAccounts > 0 ? (
        <>
          <PortfolioHistorySection
            overallHistory={overallHistory}
            transactions={data?.transactions || []}
            loadingHistory={historyLoading}
            loadingTransactions={loading}
          />

          <PortfolioBreakdownSection
            portfolioData={portfolioData}
            accountHistories={accountHistories}
            historyLoading={historyLoading}
          />
        </>
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
  );
};

const InvestmentsPage: React.FC = () => (
  <InvestmentsFiltersProvider>
    <InvestmentsPageContent />
  </InvestmentsFiltersProvider>
);

export default InvestmentsPage;
