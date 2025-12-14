import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Paper, Typography, CircularProgress, useTheme, Alert } from '@mui/material';
import { AccountBalance as AccountBalanceIcon, InfoOutlined as InfoIcon } from '@mui/icons-material';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import { useTranslation } from 'react-i18next';
import { EmptyState, OnboardingChecklist } from '@renderer/shared/empty-state';
import { useDashboardData } from '@renderer/features/dashboard/hooks/useDashboardData';
import { usePortfolioSummary } from '@renderer/features/dashboard/hooks/usePortfolioSummary';
import { useWaterfallData } from '@renderer/features/dashboard/hooks/useWaterfallData';
import { useBreakdownData } from '@renderer/features/dashboard/hooks/useBreakdownData';
import { useAccountSignals } from '@renderer/features/dashboard/hooks/useAccountSignals';
import { useTransactionsByDate } from '@renderer/features/dashboard/hooks/useTransactionsByDate';
import { PortfolioBreakdownItem } from '@renderer/types/investments';
import { AggregationPeriod } from '@renderer/types/dashboard';
import { DashboardFiltersProvider, useDashboardFilters } from '@renderer/features/dashboard/DashboardFiltersContext';
import DashboardSummarySection from '@renderer/features/dashboard/components/DashboardSummarySection';
import TransactionHistorySection from '@renderer/features/dashboard/components/TransactionHistorySection';
import BreakdownTabsSection from '@renderer/features/dashboard/components/BreakdownTabsSection';

type YAxisScale = 'linear' | 'log';

const CHART_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF6B9D'];

const DashboardHomeContent: React.FC = () => {
  const { t } = useTranslation('translation', { keyPrefix: 'dashboardHome' });
  // Helper function to parse date strings from SQLite without timezone conversion
  const parseLocalDate = (dateStr: string): Date => {
    if (!dateStr || typeof dateStr !== 'string') {
      return new Date();
    }

    // Check if already a full ISO string (with time)
    if (dateStr.includes('T')) {
      return new Date(dateStr);
    }

    // Parse YYYY-MM-DD format as local date
    const parts = dateStr.split('-');
    if (parts.length !== 3) {
      return new Date(dateStr);
    }

    const [year, month, day] = parts.map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return new Date(dateStr);
    }

    return new Date(year, month - 1, day);
  };

  const { startDate, endDate, aggregationPeriod, hoveredDate, setHoveredDate } = useDashboardFilters();
  const [compareToLastMonth, setCompareToLastMonth] = useState<boolean>(false);
  const [selectedBreakdownType, setSelectedBreakdownType] = useState<'overall' | 'expense' | 'income' | 'investment'>('overall');
  const {
    budgetUsage,
    hasBankAccounts,
    refresh: refreshAccountSignals,
  } = useAccountSignals();
  const {
    transactions: dateTransactions,
    loading: loadingTransactions,
    fetchByDate: fetchTransactionsByDate,
  } = useTransactionsByDate();
  const [yAxisScale, setYAxisScale] = useState<YAxisScale>('linear');
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const { status: onboardingStatus } = useOnboarding();

  // Calculate fallback dates (previous month) for when current period has no data
  const fallbackStartDate = useMemo(() => startOfMonth(subMonths(startDate, 1)), [startDate]);
  const fallbackEndDate = useMemo(() => endOfMonth(subMonths(startDate, 1)), [startDate]);

  const {
    data,
    loading: dashboardLoading,
    refresh: refreshDashboard,
  } = useDashboardData({
    startDate,
    endDate,
    aggregation: aggregationPeriod,
  });

  // Fallback data from previous month
  const {
    data: fallbackDashboardData,
    loading: fallbackDashboardLoading,
  } = useDashboardData({
    startDate: fallbackStartDate,
    endDate: fallbackEndDate,
    aggregation: aggregationPeriod,
  });

  const {
    portfolioValue,
    liquidPortfolio,
    restrictedPortfolio,
    refresh: refreshPortfolio,
  } = usePortfolioSummary();
  const {
    data: waterfallData,
    loading: waterfallLoading,
    refresh: refreshWaterfall,
  } = useWaterfallData({ startDate, endDate });

  // Fallback waterfall data
  const {
    data: fallbackWaterfallData,
    loading: fallbackWaterfallLoading,
  } = useWaterfallData({ startDate: fallbackStartDate, endDate: fallbackEndDate });

  const {
    breakdownData,
    breakdownLoading,
    fetchBreakdown,
    refreshBreakdowns,
  } = useBreakdownData({
    startDate,
    endDate,
  });

  // Fallback breakdown data
  const {
    breakdownData: fallbackBreakdownData,
    breakdownLoading: fallbackBreakdownLoading,
    fetchBreakdown: fetchFallbackBreakdown,
  } = useBreakdownData({
    startDate: fallbackStartDate,
    endDate: fallbackEndDate,
  });

  const handleChartAreaClick = (data: any) => {
    console.log('Chart area click - data:', data);
    // For chart area click, use activeLabel which has the date
    if (data && data.activeLabel) {
      const clickedDate = data.activeLabel;
      console.log('Clicked date:', clickedDate);

      // Check if this is a future date (forecasted) by comparing to today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const clickedDateObj = parseLocalDate(clickedDate);
      clickedDateObj.setHours(0, 0, 0, 0);

      const isForecastDate = clickedDateObj > today;
      console.log('Is forecast date:', isForecastDate);

      if (isForecastDate) {
        // For forecast dates, just set the hovered date
        // The TransactionHistorySection will handle showing forecast predictions
        setHoveredDate(clickedDate);
      } else {
        // For historical dates, fetch actual transactions
        console.log('Fetching transactions for date:', clickedDate);
        fetchTransactionsByDate(clickedDate);
        setHoveredDate(clickedDate);
      }
    }
  };

  // Custom dot component that handles clicks
  const CustomDot = (props: any) => {
    const { cx, cy, payload, value } = props;

    // Don't render dot if value is null (future dates with no data)
    if (value === null || value === undefined) {
      return null;
    }

    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={props.stroke}
        style={{ cursor: 'pointer' }}
        onClick={() => {
          console.log('Custom dot clicked, payload:', payload);
          if (payload && payload.date) {
            // Check if this is a future date (forecasted)
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const clickedDateObj = parseLocalDate(payload.date);
            clickedDateObj.setHours(0, 0, 0, 0);
            const isForecastDate = clickedDateObj > today;

            if (isForecastDate) {
              // For forecast dates, just set the hovered date
              setHoveredDate(payload.date);
            } else {
              // For historical dates, fetch actual transactions
              console.log('Fetching transactions for date:', payload.date);
              fetchTransactionsByDate(payload.date);
              setHoveredDate(payload.date);
            }
          }
        }}
      />
    );
  };

  // Check if selected date range is current month
  const isCurrentMonth = useCallback(() => {
    const now = new Date();
    // Check if selected range matches current month
    return (
      format(startDate, 'yyyy-MM') === format(now, 'yyyy-MM') &&
      format(endDate, 'yyyy-MM') === format(now, 'yyyy-MM')
    );
  }, [startDate, endDate]);

  // Auto-detect if log scale is better (when income >> expenses)
  const shouldUseLogScale = useCallback((history: any[]) => {
    if (!history || history.length === 0) return false;

    const avgIncome = history.reduce((sum, item) => sum + item.income, 0) / history.length;
    const avgExpenses = history.reduce((sum, item) => sum + item.expenses, 0) / history.length;

    // If average income is 3x or more than average expenses, suggest log scale
    return avgIncome > 0 && avgExpenses > 0 && avgIncome / avgExpenses >= 3;
  }, [t]);

  // Detect anomalies (unusual spikes)
  const detectAnomalies = useCallback((history: any[]) => {
    if (!history || history.length < 5) return [];

    const anomalies: any[] = [];
    const expenseValues = history.map(h => h.expenses).filter(e => e > 0);

    if (expenseValues.length === 0) return [];

    const mean = expenseValues.reduce((sum, val) => sum + val, 0) / expenseValues.length;
    const variance = expenseValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / expenseValues.length;
    const stdDev = Math.sqrt(variance);

    history.forEach((item) => {
      if (item.expenses > mean + (2 * stdDev)) {
        anomalies.push({
          date: item.date,
          value: item.expenses,
          type: 'expense_spike',
          message: t('anomaly.expenseSpike', {
            amount: formatCurrency(item.expenses, { absolute: true, maximumFractionDigits: 0 }),
          }),
        });
      }
    });

    return anomalies;
  }, [formatCurrency, t]);

  // Detect spending trends (consecutive high/low spending periods)
  const detectTrends = useCallback((history: any[]) => {
    if (!history || history.length < 7) return [];

    const trends: any[] = [];
    const avgExpenses = history.reduce((sum, item) => sum + item.expenses, 0) / history.length;

    let consecutiveHigh = 0;
    let consecutiveLow = 0;
    let highStartIdx = -1;
    let lowStartIdx = -1;

    history.forEach((item, idx) => {
      if (item.expenses > avgExpenses * 1.3) {
        if (consecutiveHigh === 0) highStartIdx = idx;
        consecutiveHigh++;
        consecutiveLow = 0;
      } else if (item.expenses < avgExpenses * 0.7 && item.expenses > 0) {
        if (consecutiveLow === 0) lowStartIdx = idx;
        consecutiveLow++;
        consecutiveHigh = 0;
      } else {
        if (consecutiveHigh >= 3) {
          trends.push({
            type: 'high_spending',
            startDate: history[highStartIdx].date,
            endDate: history[idx - 1].date,
            label: t('trends.highSpending'),
          });
        }
        if (consecutiveLow >= 3) {
          trends.push({
            type: 'low_spending',
            startDate: history[lowStartIdx].date,
            endDate: history[idx - 1].date,
            label: t('trends.lowSpending'),
          });
        }
        consecutiveHigh = 0;
        consecutiveLow = 0;
      }
    });

    return trends;
  }, []);

  useEffect(() => {
    const handleDataRefresh = () => {
      refreshDashboard();
      refreshPortfolio();
      refreshWaterfall();
      refreshBreakdowns(['expense', 'income']);
      if (selectedBreakdownType === 'investment') {
        void fetchBreakdown('investment');
      }
      refreshAccountSignals();
    };

    globalThis.addEventListener('dataRefresh', handleDataRefresh);
    return () => {
      globalThis.removeEventListener('dataRefresh', handleDataRefresh);
    };
  }, [
    fetchBreakdown,
    refreshAccountSignals,
    refreshBreakdowns,
    refreshDashboard,
    refreshPortfolio,
    refreshWaterfall,
    selectedBreakdownType,
  ]);

  useEffect(() => {
    if (selectedBreakdownType === 'investment' && !breakdownData.investment && !breakdownLoading.investment) {
      void fetchBreakdown('investment');
    }
  }, [selectedBreakdownType, breakdownData.investment, breakdownLoading.investment, fetchBreakdown]);

  // Fetch expense breakdown for SummaryCards Financial Health metrics
  useEffect(() => {
    if (!breakdownData.expense && !breakdownLoading.expense) {
      void fetchBreakdown('expense');
    }
  }, [breakdownData.expense, breakdownLoading.expense, fetchBreakdown]);

  // Toggle to compare current month with last month
  const toggleCompareLastMonth = () => {
    setCompareToLastMonth(!compareToLastMonth);
  };

  // Check if current period has no data but fallback period does
  const currentPeriodEmpty = (data?.history?.length ?? 0) === 0;
  const fallbackHasData = (fallbackDashboardData?.history?.length ?? 0) > 0;
  const shouldUseFallback = currentPeriodEmpty && fallbackHasData && (onboardingStatus?.stats?.transactionCount ?? 0) > 0;

  // Determine effective data to display (use fallback when current period is empty)
  const effectiveData = shouldUseFallback ? fallbackDashboardData : data;
  const effectiveWaterfallData = shouldUseFallback ? fallbackWaterfallData : waterfallData;
  const effectiveBreakdownData = shouldUseFallback ? fallbackBreakdownData : breakdownData;
  const effectiveBreakdownLoading = shouldUseFallback ? fallbackBreakdownLoading : breakdownLoading;
  const effectiveStartDate = shouldUseFallback ? fallbackStartDate : startDate;
  const effectiveEndDate = shouldUseFallback ? fallbackEndDate : endDate;

  // Show loading while primary data loads, or while checking fallback
  const isLoading = dashboardLoading || (currentPeriodEmpty && fallbackDashboardLoading);

  if (isLoading || !effectiveData || !effectiveData.summary) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Check for empty state (no transactions at all)
  const hasNoTransactions = onboardingStatus && onboardingStatus.stats.transactionCount === 0;

  if (hasNoTransactions) {
    return (
      <EmptyState
        icon={<AccountBalanceIcon sx={{ fontSize: 96 }} />}
        title={t('empty.welcomeTitle')}
        description={t('empty.welcomeDescription')}
        showOnboardingChecklist={true}
      >
        <OnboardingChecklist
          onProfileClick={() => {
            // Profile modal handled by AppLayout container in renderer
            window.dispatchEvent(new CustomEvent('openProfileSetup'));
          }}
          onBankAccountClick={() => {
            window.dispatchEvent(new CustomEvent('openAccountsModal'));
          }}
          onCreditCardClick={() => {
            window.dispatchEvent(new CustomEvent('openAccountsModal'));
          }}
        />
      </EmptyState>
    );
  }

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  const formatXAxis = (value: string) => {
    const localDate = parseLocalDate(value);

    if (aggregationPeriod === 'monthly') {
      return format(localDate, 'MMM');
    } else if (aggregationPeriod === 'weekly') {
      return format(localDate, 'MM/dd');
    }
    return format(localDate, 'dd/MM');
  };

  // Format Y-axis for log scale (show original values but with log positioning)
  const formatYAxisLog = (value: number) => {
    if (value <= 0) return '0';
    // Convert back from log to actual value for display
    const actualValue = Math.pow(10, value);
    return formatCurrencyValue(actualValue);
  };

  // Transform data for log scale visualization
  const getLogScaleData = (history: any[]) => {
    if (!history) return [];
    return history.map(item => ({
      ...item,
      // Transform to log10, handling zeros (use 0.1 as minimum to avoid -infinity)
      income: item.income > 0 ? Math.log10(item.income) : 0,
      expenses: item.expenses > 0 ? Math.log10(item.expenses) : 0,
      // Keep original values for tooltip
      originalIncome: item.income,
      originalExpenses: item.expenses,
    }));
  };

  // Custom tooltip for transaction history chart
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const dateStr = payload[0].payload.date;
      // Use original values if available (for log scale), otherwise use direct values
      const income = payload[0].payload.originalIncome ?? (payload.find((p: any) => p.dataKey === 'income')?.value || 0);
      const expenses = payload[0].payload.originalExpenses ?? (payload.find((p: any) => p.dataKey === 'expenses')?.value || 0);
      const netFlow = income - expenses;
      const localDate = parseLocalDate(dateStr);

      // Check if this is an anomaly
      const anomalies = detectAnomalies(effectiveData?.history || []);
      const isAnomaly = anomalies.some(a => a.date === dateStr);

      // Calculate average for comparison
      const avgExpenses = effectiveData?.history
        ? effectiveData.history.reduce((sum, item) => sum + (item.expenses ?? 0), 0) / effectiveData.history.length
        : 0;

      const diffFromAvg = expenses - avgExpenses;
      const percentDiff = avgExpenses > 0 ? (diffFromAvg / avgExpenses) * 100 : 0;

      return (
        <Paper sx={{ p: 2, border: `1px solid ${theme.palette.divider}`, minWidth: 200 }}>
          <Typography variant="body2" fontWeight="bold" sx={{ mb: 1 }}>
            {format(localDate, 'MMM dd, yyyy')}
          </Typography>
          <Typography variant="body2" color="success.main">
            ↑ {t('tooltip.income')}: {formatCurrencyValue(income)}
          </Typography>
          <Typography variant="body2" color="error.main">
            ↓ {t('tooltip.expenses')}: {formatCurrencyValue(expenses)}
          </Typography>
          <Typography
            variant="body2"
            fontWeight="medium"
            color={netFlow > 0 ? 'success.main' : 'error.main'}
            sx={{ mt: 0.5, pt: 0.5, borderTop: `1px solid ${theme.palette.divider}` }}
          >
            {t('tooltip.net')}: {netFlow > 0 ? '+' : ''}{formatCurrencyValue(netFlow)}
          </Typography>
          {Math.abs(percentDiff) > 20 && (
            <Typography variant="caption" color={percentDiff > 0 ? 'warning.main' : 'info.main'} sx={{ display: 'block', mt: 0.5 }}>
              {percentDiff > 0 ? '↑' : '↓'} {Math.abs(percentDiff).toFixed(0)}% {t('tooltip.vsAverage')}
            </Typography>
          )}
          {isAnomaly && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
              ⚠ {t('tooltip.unusualSpending')}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', fontStyle: 'italic' }}>
            {t('tooltip.clickForDetails')}
          </Typography>
        </Paper>
      );
    }
    return null;
  };

  return (
    <Box>
      {shouldUseFallback && (
        <Alert 
          severity="info" 
          icon={<InfoIcon />}
          sx={{ mb: 2 }}
        >
          {t('empty.showingPreviousMonth', {
            currentMonth: format(startDate, 'MMMM yyyy'),
            displayedMonth: format(effectiveStartDate, 'MMMM yyyy'),
          })}
        </Alert>
      )}
      <DashboardSummarySection
        data={effectiveData}
        portfolioValue={portfolioValue}
        liquidPortfolio={liquidPortfolio}
        restrictedPortfolio={restrictedPortfolio}
        budgetUsage={budgetUsage}
        breakdownData={effectiveBreakdownData}
        hasBankAccounts={hasBankAccounts}
        compareToLastMonth={compareToLastMonth}
        onToggleCompare={toggleCompareLastMonth}
      />

      <Box id="transactions">
        <TransactionHistorySection
          data={effectiveData}
          yAxisScale={yAxisScale}
          setYAxisScale={setYAxisScale}
        shouldUseLogScale={shouldUseLogScale}
        formatCurrencyValue={formatCurrencyValue}
        formatXAxis={formatXAxis}
        formatYAxisLog={formatYAxisLog}
        getLogScaleData={getLogScaleData}
        CustomDot={CustomDot}
        CustomTooltip={CustomTooltip}
        handleChartAreaClick={handleChartAreaClick}
        detectAnomalies={detectAnomalies}
        hoveredDate={hoveredDate}
        setHoveredDate={setHoveredDate}
        fetchTransactionsByDate={fetchTransactionsByDate}
        dateTransactions={dateTransactions}
        loadingTransactions={loadingTransactions}
          parseLocalDate={parseLocalDate}
          formatCurrency={formatCurrency}
        />
      </Box>

      <Box id="breakdown">
        <BreakdownTabsSection
        selectedBreakdownType={selectedBreakdownType}
        onSelectBreakdown={(value) => setSelectedBreakdownType(value)}
        waterfallData={effectiveWaterfallData}
        waterfallLoading={shouldUseFallback ? fallbackWaterfallLoading : waterfallLoading}
        liquidPortfolio={liquidPortfolio}
        restrictedPortfolio={restrictedPortfolio}
        formatCurrencyValue={formatCurrencyValue}
        breakdownData={effectiveBreakdownData}
        breakdownLoading={effectiveBreakdownLoading}
        hasBankAccounts={hasBankAccounts}
          data={effectiveData}
          chartColors={CHART_COLORS}
        />
      </Box>
    </Box>
  );
};

const HomePage: React.FC = () => (
  <DashboardFiltersProvider>
    <DashboardHomeContent />
  </DashboardFiltersProvider>
);

export default HomePage;
