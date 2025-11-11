import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  CircularProgress,
  useTheme,
  Button,
  Tabs,
  Tab,
  Grid,
  Alert,
  AlertTitle,
  Tooltip as MuiTooltip,
  Chip,
} from '@mui/material';
import {
  AccountBalance as AccountBalanceIcon,
  DateRange as DateRangeIcon,
  Add as AddIcon,
  InfoOutlined as InfoOutlinedIcon,
  ShowChart as ShowChartIcon,
  TrendingUp as TrendingUpIcon,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, ReferenceLine, AreaChart, Area } from 'recharts';
import SankeyChart from './SankeyChart';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import SummaryCards from '../components/SummaryCards';
import BreakdownPanel from '../components/BreakdownPanel';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useOnboarding } from '@app/contexts/OnboardingContext';
import { EmptyState, OnboardingChecklist } from './EmptyState';
import { apiClient } from '@/lib/api-client';

interface DashboardData {
  dateRange: { start: Date; end: Date };
  summary: {
    totalIncome: number;
    totalExpenses: number;
    netBalance: number;
    investmentOutflow: number;
    investmentInflow: number;
    netInvestments: number;
    totalAccounts: number;
  };
  history: Array<{
    date: string;
    income: number;
    expenses: number;
  }>;
  breakdowns: {
    byCategory: Array<{ category: string; total: number; count: number }>;
    byVendor: Array<{ vendor: string; total: number; count: number }>;
    byMonth: Array<{ month: string; income: number; expenses: number }>;
  };
}

type AggregationPeriod = 'daily' | 'weekly' | 'monthly';
type YAxisScale = 'linear' | 'log';
type ChartView = 'transaction' | 'cumulative';

interface Transaction {
  identifier: string;
  vendor: string;
  price: number;
  description: string;
  date: string;
  category: string;
  parentCategory: string;
  categoryType: string;
  parent_name?: string;
  category_name?: string;
  institution?: {
    id: number;
    vendor_code: string;
    display_name_he: string;
    display_name_en: string;
    logo_url?: string;
    institution_type: string;
  };
}

interface PortfolioBreakdownItem {
  name: string;
  value: number;
  percentage: number;
  [key: string]: any;
}

interface WaterfallFlowData {
  summary: {
    totalIncome: number;
    totalExpenses: number;
    netInvestments: number;
    netBalance: number;
    totalTransactions: number;
  };
  waterfallData: Array<{
    name: string;
    value: number;
    type: 'income' | 'expense' | 'investment' | 'net';
    cumulative: number;
    startValue: number;
    color: string;
    count: number;
  }>;
  breakdown: {
    income: any[];
    expenses: any[];
    investments: any[];
  };
}

const CHART_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF6B9D'];

const HomePage: React.FC = () => {
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

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);
  const [portfolioValue, setPortfolioValue] = useState<number | null>(null);
  const [waterfallData, setWaterfallData] = useState<WaterfallFlowData | null>(null);
  const [waterfallLoading, setWaterfallLoading] = useState(true);
  const [liquidPortfolio, setLiquidPortfolio] = useState<PortfolioBreakdownItem[]>([]);
  const [restrictedPortfolio, setRestrictedPortfolio] = useState<PortfolioBreakdownItem[]>([]);
  const [breakdownData, setBreakdownData] = useState<Record<'expense' | 'income' | 'investment', any>>({
    expense: null,
    income: null,
    investment: null,
  });
  const [breakdownLoading, setBreakdownLoading] = useState<Record<'expense' | 'income' | 'investment', boolean>>({
    expense: false,
    income: false,
    investment: false,
  });
  const [hasBankAccounts, setHasBankAccounts] = useState<boolean | null>(null);
  // Default to last full month
  const lastMonthStart = startOfMonth(subMonths(new Date(), 1));
  const lastMonthEnd = endOfMonth(subMonths(new Date(), 1));
  const [startDate, setStartDate] = useState<Date>(lastMonthStart);
  const [endDate, setEndDate] = useState<Date>(lastMonthEnd);
  const [aggregationPeriod, setAggregationPeriod] = useState<AggregationPeriod>('daily');
  const [selectedBreakdownType, setSelectedBreakdownType] = useState<'overall' | 'expense' | 'income' | 'investment'>('overall');
  const [budgetUsage, setBudgetUsage] = useState<number | undefined>();
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [dateTransactions, setDateTransactions] = useState<Transaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [yAxisScale, setYAxisScale] = useState<YAxisScale>('linear');
  const [chartView, setChartView] = useState<ChartView>('transaction');
  const [cumulativeData, setCumulativeData] = useState<any[]>([]);
  const [lastMonthHistory, setLastMonthHistory] = useState<any[]>([]);
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const { status: onboardingStatus } = useOnboarding();

  const fetchTransactionsByDate = async (date: string) => {
    setLoadingTransactions(true);
    console.log('fetchTransactionsByDate called with:', date);
    try {
      const formattedDate = format(new Date(date), 'yyyy-MM-dd');
      console.log('Formatted date for API:', formattedDate);
      const response = await apiClient.get(`/api/analytics/transactions-by-date?date=${formattedDate}`);
      if (response.ok) {
        const result = response.data as any;
        console.log('API response:', result);
        setDateTransactions(result.transactions || []);
      } else {
        console.error('API error:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error fetching transactions by date:', error);
      setDateTransactions([]);
    } finally {
      setLoadingTransactions(false);
    }
  };

  const handleChartAreaClick = (data: any) => {
    console.log('Chart area click - data:', data);
    // For chart area click, use activeLabel which has the date
    if (data && data.activeLabel) {
      const clickedDate = data.activeLabel;
      console.log('Fetching transactions for date:', clickedDate);
      fetchTransactionsByDate(clickedDate);
      setHoveredDate(clickedDate);
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
            console.log('Fetching transactions for date:', payload.date);
            fetchTransactionsByDate(payload.date);
            setHoveredDate(payload.date);
          }
        }}
      />
    );
  };

  // Helper function to fill missing dates in the history array
  const fillMissingDates = (history: any[], start: Date, end: Date) => {
    if (!history || history.length === 0) {
      return history;
    }

    const dateMap = new Map(history.map(h => [h.date, h]));
    const filled = [];

    // Find the last actual data date in history
    const lastDataDate = history.length > 0
      ? new Date(Math.max(...history.map(h => new Date(h.date).getTime())))
      : new Date(start);

    const current = new Date(start.getTime()); // Clone to avoid mutation

    // If viewing current month, extend to end of month to show empty future days
    const actualEndDate = isCurrentMonth() ? endOfMonth(new Date()) : new Date(end);

    while (current <= actualEndDate) {
      const dateStr = format(current, 'yyyy-MM-dd');
      const isFutureDate = current > lastDataDate;

      if (dateMap.has(dateStr)) {
        filled.push(dateMap.get(dateStr));
      } else if (isFutureDate) {
        // Future dates after last scrape: use null to stop lines
        filled.push({ date: dateStr, income: null, expenses: null });
      } else {
        // Past dates with no data: use 0
        filled.push({ date: dateStr, income: 0, expenses: 0 });
      }
      current.setDate(current.getDate() + 1);
    }

    return filled;
  };

  // Check if selected date range is current month
  const isCurrentMonth = useCallback(() => {
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);

    // Check if selected range matches current month
    return (
      format(startDate, 'yyyy-MM') === format(now, 'yyyy-MM') &&
      format(endDate, 'yyyy-MM') === format(now, 'yyyy-MM')
    );
  }, [startDate, endDate]);

  // Calculate cumulative data with predictions for current month
  const calculateCumulativeData = useCallback((
    history: any[],
    lastMonthData: any[]
  ) => {
    if (!history || history.length === 0) return [];

    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const endOfMonthDate = endOfMonth(startDate);
    const isViewingCurrentMonth = isCurrentMonth();

    // Build cumulative from ACTUAL data (only up to today if current month)
    let runningTotal = 0;
    const cumulative: any[] = [];

    // Filter history to only include dates up to today if viewing current month
    const actualHistory = isViewingCurrentMonth
      ? history.filter(day => day.date <= todayStr)
      : history;

    actualHistory.forEach((day) => {
      runningTotal += day.income - day.expenses;
      cumulative.push({
        date: day.date,
        cumulative: runningTotal,
        netFlow: day.income - day.expenses,
        income: day.income,
        expenses: day.expenses,
        isActual: true,
        isPrediction: false,
      });
    });

    // If we're viewing current month, add predictions for remaining days
    if (isViewingCurrentMonth && cumulative.length > 0 && lastMonthData.length > 0) {
      const lastActualDate = new Date(cumulative[cumulative.length - 1].date);
      let predictionDate = new Date(lastActualDate);
      predictionDate.setDate(predictionDate.getDate() + 1);

      // Build last month lookup map (day of month -> net flow)
      const lastMonthMap = new Map();
      lastMonthData.forEach((day) => {
        const date = new Date(day.date);
        const dayOfMonth = date.getDate();
        lastMonthMap.set(dayOfMonth, day.income - day.expenses);
      });

      console.log(`Generating predictions from ${format(predictionDate, 'yyyy-MM-dd')} to ${format(endOfMonthDate, 'yyyy-MM-dd')}`);

      // Generate predictions until end of month
      while (predictionDate <= endOfMonthDate) {
        const dayOfMonth = predictionDate.getDate();
        const predDateStr = format(predictionDate, 'yyyy-MM-dd');

        // Use same day from last month, or 0 if no data
        const predictedNetFlow = lastMonthMap.get(dayOfMonth) || 0;
        runningTotal += predictedNetFlow;

        cumulative.push({
          date: predDateStr,
          cumulative: runningTotal,
          netFlow: predictedNetFlow,
          isActual: false,
          isPrediction: true,
        });

        predictionDate.setDate(predictionDate.getDate() + 1);
      }

      console.log(`Added ${cumulative.filter(d => d.isPrediction).length} prediction days`);
    }

    return cumulative;
  }, [startDate, isCurrentMonth]);

  // Auto-detect if log scale is better (when income >> expenses)
  const shouldUseLogScale = useCallback((history: any[]) => {
    if (!history || history.length === 0) return false;

    const avgIncome = history.reduce((sum, item) => sum + item.income, 0) / history.length;
    const avgExpenses = history.reduce((sum, item) => sum + item.expenses, 0) / history.length;

    // If average income is 3x or more than average expenses, suggest log scale
    return avgIncome > 0 && avgExpenses > 0 && avgIncome / avgExpenses >= 3;
  }, []);

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
          message: `Unusual expense spike: ${formatCurrency(item.expenses, { absolute: true, maximumFractionDigits: 0 })}`,
        });
      }
    });

    return anomalies;
  }, [formatCurrency]);

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
            label: 'High spending period',
          });
        }
        if (consecutiveLow >= 3) {
          trends.push({
            type: 'low_spending',
            startDate: history[lowStartIdx].date,
            endDate: history[idx - 1].date,
            label: 'Low spending period',
          });
        }
        consecutiveHigh = 0;
        consecutiveLow = 0;
      }
    });

    return trends;
  }, []);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(
        `/api/analytics/dashboard?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}&aggregation=${aggregationPeriod}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data');
      }
      const result = response.data as any;

      // Fill in missing days/weeks/months with zero values for better visualization
      if (result.history && aggregationPeriod === 'daily') {
        result.history = fillMissingDates(result.history, startDate, endDate);
      }

      setData(result);

      // If viewing current month, fetch last month data for predictions and calculate cumulative
      if (isCurrentMonth() && result.history) {
        const today = format(new Date(), 'yyyy-MM-dd');
        const actualCount = result.history.filter((h: any) => h.date <= today).length;
        const futureCount = result.history.filter((h: any) => h.date > today).length;
        console.log(`Current month detected. History: ${result.history.length} days (${actualCount} actual, ${futureCount} future). Today: ${today}`);

        fetchLastMonthData().then((lastMonth) => {
          console.log(`Last month data fetched: ${lastMonth.length} days`);
          const cumulative = calculateCumulativeData(result.history, lastMonth);
          const predCount = cumulative.filter(d => d.isPrediction).length;
          console.log(`✓ Cumulative data: ${cumulative.length} total points, ${predCount} predictions`);
          setCumulativeData(cumulative);
        });
      } else if (result.history) {
        // For non-current months, just calculate cumulative without predictions
        const cumulative = calculateCumulativeData(result.history, []);
        console.log(`Cumulative data calculated (no predictions): ${cumulative.length} points`);
        setCumulativeData(cumulative);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [aggregationPeriod, endDate, startDate, isCurrentMonth, calculateCumulativeData]);

  const fetchLastMonthData = useCallback(async () => {
    try {
      const lastMonth = subMonths(startDate, 1);
      const lastMonthStart = startOfMonth(lastMonth);
      const lastMonthEnd = endOfMonth(lastMonth);

      const response = await apiClient.get(
        `/api/analytics/dashboard?startDate=${lastMonthStart.toISOString()}&endDate=${lastMonthEnd.toISOString()}&aggregation=daily`
      );

      if (response.ok) {
        const result = response.data as any;
        const history = result.history || [];
        setLastMonthHistory(history);
        return history;
      }
      return [];
    } catch (error) {
      console.error('Error fetching last month data:', error);
      return [];
    }
  }, [startDate]);

  const fetchPortfolioValue = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/investments/summary');
      if (response.ok) {
        const result = response.data as any;
        const summary = result?.summary ?? {};
        setPortfolioValue(Number(summary.totalPortfolioValue ?? 0));

        // Set overall portfolio breakdown
        if (Array.isArray(result?.breakdown) && result.breakdown.length > 0) {

          // Separate liquid and restricted portfolios
          const liquidSummary = summary.liquid ?? { totalValue: 0 };
          const restrictedSummary = summary.restricted ?? { totalValue: 0 };

          const liquidItems = result.breakdown
            .filter((item: any) => item.category === 'liquid')
            .map((item: any) => ({
              name: item.name || item.type,
              value: item.totalValue,
              percentage: liquidSummary.totalValue > 0
                ? (item.totalValue / liquidSummary.totalValue) * 100
                : 0,
              category: item.category
            }));

          const restrictedItems = result.breakdown
            .filter((item: any) => item.category === 'restricted')
            .map((item: any) => ({
              name: item.name || item.type,
              value: item.totalValue,
              percentage: restrictedSummary.totalValue > 0
                ? (item.totalValue / restrictedSummary.totalValue) * 100
                : 0,
              category: item.category
            }));

          setLiquidPortfolio(liquidItems);
          setRestrictedPortfolio(restrictedItems);
        }
      }
    } catch (error) {
      console.error('Error fetching portfolio value:', error);
      setPortfolioValue(0);
      setLiquidPortfolio([]);
      setRestrictedPortfolio([]);
    }
  }, []);

  const fetchWaterfallData = useCallback(async () => {
    setWaterfallLoading(true);
    try {
      const response = await apiClient.get(
        `/api/analytics/waterfall-flow?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch waterfall data');
      }
      const result = response.data as any;
      setWaterfallData(result);
    } catch (error) {
      console.error('Error fetching waterfall data:', error);
      setWaterfallData(null);
    } finally {
      setWaterfallLoading(false);
    }
  }, [endDate, startDate]);

  const fetchBreakdownData = useCallback(
    async (type: 'expense' | 'income' | 'investment') => {
      setBreakdownLoading(prev => ({ ...prev, [type]: true }));

      try {
        const params = new URLSearchParams({
          type,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        });
        const response = await apiClient.get(`/api/analytics/breakdown?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${type} breakdown`);
        }
        const result = response.data as any;
        setBreakdownData(prev => ({ ...prev, [type]: result }));
      } catch (error) {
        console.error(`Error fetching ${type} breakdown:`, error);
        setBreakdownData(prev => ({ ...prev, [type]: null }));
      } finally {
        setBreakdownLoading(prev => ({ ...prev, [type]: false }));
      }
    },
    [endDate, startDate],
  );

  const fetchBudgetUsage = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/budgets/usage');
      if (!response.ok) {
        console.warn('Budget usage API not available yet');
        return;
      }
      const budgets = response.data as any;

      if (Array.isArray(budgets) && budgets.length > 0) {
        const avgUsage = budgets.reduce((sum: number, b: any) => sum + b.percentage, 0) / budgets.length;
        setBudgetUsage(avgUsage);
      }
    } catch (error) {
      console.error('Error fetching budget usage:', error);
    }
  }, []);

  const fetchBankAccountsStatus = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/credentials');
      if (response.ok) {
        const credentials = response.data as any;
        setHasBankAccounts(Array.isArray(credentials) && credentials.length > 0);
      } else {
        setHasBankAccounts(null);
      }
    } catch (error) {
      console.error('Error fetching bank accounts status:', error);
      setHasBankAccounts(null);
    }
  }, []);

  useEffect(() => {
    setBreakdownData(prev => ({ ...prev, investment: null }));
    setBreakdownLoading(prev => ({ ...prev, investment: false }));
    fetchDashboardData();
    fetchPortfolioValue();
    fetchWaterfallData();
    fetchBreakdownData('expense');
    fetchBreakdownData('income');
    fetchBudgetUsage();
    fetchBankAccountsStatus();

    // Listen for data refresh events (from scraping, manual transactions, etc.)
    const handleDataRefresh = () => {
      fetchDashboardData();
      fetchPortfolioValue();
      fetchWaterfallData();
      fetchBreakdownData('expense');
      fetchBreakdownData('income');
      if (selectedBreakdownType === 'investment') {
        fetchBreakdownData('investment');
      }
      fetchBudgetUsage();
      fetchBankAccountsStatus();
    };
    globalThis.addEventListener('dataRefresh', handleDataRefresh);

    return () => {
      globalThis.removeEventListener('dataRefresh', handleDataRefresh);
    };
  }, [
    fetchBankAccountsStatus,
    fetchBreakdownData,
    fetchBudgetUsage,
    fetchDashboardData,
    fetchPortfolioValue,
    fetchWaterfallData,
    selectedBreakdownType,
  ]);

  useEffect(() => {
    if (selectedBreakdownType === 'investment' && !breakdownData.investment && !breakdownLoading.investment) {
      fetchBreakdownData('investment');
    }
  }, [selectedBreakdownType, breakdownData.investment, breakdownLoading.investment, fetchBreakdownData]);

  const setQuickRange = (range: 'lastMonth' | 'thisMonth' | 'last3Months') => {
    const now = new Date();
    switch (range) {
      case 'lastMonth':
        setStartDate(startOfMonth(subMonths(now, 1)));
        setEndDate(endOfMonth(subMonths(now, 1)));
        break;
      case 'thisMonth':
        setStartDate(startOfMonth(now));
        setEndDate(endOfMonth(now));
        break;
      case 'last3Months':
        setStartDate(subMonths(now, 3));
        setEndDate(now);
        break;
    }
  };

  if (loading || !data || !data.summary) {
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
        title="Welcome to ShekelSync!"
        description="Let's get your finances organized. Follow these steps to start tracking your expenses and income."
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

  // Check if date range has no data (but transactions exist)
  const hasTransactionsButNotInRange =
    data.history.length === 0 &&
    onboardingStatus &&
    onboardingStatus.stats.transactionCount > 0;

  if (hasTransactionsButNotInRange) {
    return (
      <Box>
        {/* Still show date picker */}
        <Paper sx={{ p: 2, mb: 3 }}>
          <LocalizationProvider dateAdapter={AdapterDateFns}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">Date Range:</Typography>
              <DatePicker
                label="Start Date"
                value={startDate}
                onChange={(newValue: Date | null) => {
                  if (newValue) {
                    setStartDate(newValue);
                  }
                }}
                slotProps={{ textField: { size: 'small' } }}
              />
              <DatePicker
                label="End Date"
                value={endDate}
                onChange={(newValue: Date | null) => {
                  if (newValue) {
                    setEndDate(newValue);
                  }
                }}
                slotProps={{ textField: { size: 'small' } }}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button size="small" variant="outlined" onClick={() => setQuickRange('lastMonth')}>
                Last Month
              </Button>
              <Button size="small" variant="outlined" onClick={() => setQuickRange('thisMonth')}>
                This Month
              </Button>
              <Button size="small" variant="outlined" onClick={() => setQuickRange('last3Months')}>
                Last 3 Months
              </Button>
            </Box>
          </LocalizationProvider>
        </Paper>

        <EmptyState
          icon={<DateRangeIcon sx={{ fontSize: 96 }} />}
          title="No transactions in this date range"
          description={`You have ${onboardingStatus.stats.transactionCount} transactions total, but none between ${format(startDate, 'MMM dd, yyyy')} and ${format(endDate, 'MMM dd, yyyy')}. Try selecting a different date range or scrape more recent data.`}
          primaryAction={{
            label: "Scrape Recent Transactions",
            onClick: () => window.dispatchEvent(new CustomEvent('openScrapeModal')),
            icon: <AddIcon />
          }}
          secondaryActions={[
            {
              label: "Reset to Last Month",
              onClick: () => setQuickRange('lastMonth')
            }
          ]}
          minHeight={300}
        />
      </Box>
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
      const anomalies = detectAnomalies(data?.history || []);
      const isAnomaly = anomalies.some(a => a.date === dateStr);

      // Calculate average for comparison
      const avgExpenses = data?.history ?
        data.history.reduce((sum, item) => sum + item.expenses, 0) / data.history.length : 0;

      const diffFromAvg = expenses - avgExpenses;
      const percentDiff = avgExpenses > 0 ? (diffFromAvg / avgExpenses) * 100 : 0;

      return (
        <Paper sx={{ p: 2, border: `1px solid ${theme.palette.divider}`, minWidth: 200 }}>
          <Typography variant="body2" fontWeight="bold" sx={{ mb: 1 }}>
            {format(localDate, 'MMM dd, yyyy')}
          </Typography>
          <Typography variant="body2" color="success.main">
            ↑ Income: {formatCurrencyValue(income)}
          </Typography>
          <Typography variant="body2" color="error.main">
            ↓ Expenses: {formatCurrencyValue(expenses)}
          </Typography>
          <Typography
            variant="body2"
            fontWeight="medium"
            color={netFlow > 0 ? 'success.main' : 'error.main'}
            sx={{ mt: 0.5, pt: 0.5, borderTop: `1px solid ${theme.palette.divider}` }}
          >
            Net: {netFlow > 0 ? '+' : ''}{formatCurrencyValue(netFlow)}
          </Typography>
          {Math.abs(percentDiff) > 20 && (
            <Typography variant="caption" color={percentDiff > 0 ? 'warning.main' : 'info.main'} sx={{ display: 'block', mt: 0.5 }}>
              {percentDiff > 0 ? '↑' : '↓'} {Math.abs(percentDiff).toFixed(0)}% vs avg
            </Typography>
          )}
          {isAnomaly && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
              ⚠ Unusual spending
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', fontStyle: 'italic' }}>
            Click to see details
          </Typography>
        </Paper>
      );
    }
    return null;
  };

  return (
    <Box>
      {/* Summary Cards */}
      <Box sx={{ mb: 4 }}>
        <SummaryCards
          totalIncome={data.summary.totalIncome}
          totalExpenses={data.summary.totalExpenses}
          netBalance={data.summary.netBalance}
          netInvestments={data.summary.netInvestments}
          portfolioValue={portfolioValue}
          budgetUsage={budgetUsage}
        />
      </Box>

      {/* Zero Income Alert */}
      {data.summary.totalIncome === 0 && hasBankAccounts !== null && (
        <Alert
          severity="info"
          icon={<InfoOutlinedIcon />}
          sx={{ mb: 3 }}
        >
          <AlertTitle>No Income Detected</AlertTitle>
          {hasBankAccounts === false ? (
            <Typography variant="body2">
              To track your income automatically, please add your bank account credentials.
              This will enable automatic income tracking and provide a complete financial overview.
            </Typography>
          ) : (
            <Typography variant="body2">
              We haven&apos;t detected any income transactions in the selected period.
              If you&apos;re expecting income data, please verify that your most recent bank scrape was successful
              or consider running a new scrape to update your transactions.
            </Typography>
          )}
        </Alert>
      )}

      {/* Date Range Picker */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <LocalizationProvider dateAdapter={AdapterDateFns}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Date Range:</Typography>
            <DatePicker
              label="Start Date"
              value={startDate}
              onChange={(newValue: Date | null) => {
                if (newValue) {
                  setStartDate(newValue);
                }
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
            <DatePicker
              label="End Date"
              value={endDate}
              onChange={(newValue: Date | null) => {
                if (newValue) {
                  setEndDate(newValue);
                }
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={() => setQuickRange('lastMonth')}>
              Last Month
            </Button>
            <Button size="small" variant="outlined" onClick={() => setQuickRange('thisMonth')}>
              This Month
            </Button>
            <Button size="small" variant="outlined" onClick={() => setQuickRange('last3Months')}>
              Last 3 Months
            </Button>
          </Box>
        </LocalizationProvider>
      </Paper>

      {/* Transaction History Chart */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h6">Transaction History</Typography>
            {shouldUseLogScale(data.history) && yAxisScale === 'linear' && (
              <Chip
                label="Log scale recommended"
                size="small"
                color="info"
                icon={<InfoOutlinedIcon />}
                onClick={() => setYAxisScale('log')}
                sx={{ cursor: 'pointer' }}
              />
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Cumulative View - Coming Soon */}
            {isCurrentMonth() && (
              <MuiTooltip title="Feature in development: Will show cash flow predictions based on historical patterns">
                <Chip
                  label="Cumulative View (Coming Soon)"
                  icon={<TrendingUpIcon />}
                  disabled
                  size="small"
                  sx={{
                    opacity: 0.6,
                    cursor: 'not-allowed',
                    '& .MuiChip-icon': { opacity: 0.6 }
                  }}
                />
              </MuiTooltip>
            )}

            <ToggleButtonGroup
              value={yAxisScale}
              exclusive
              onChange={(_, newScale) => newScale && setYAxisScale(newScale)}
              size="small"
            >
              <MuiTooltip title="Linear scale">
                <ToggleButton value="linear">Linear</ToggleButton>
              </MuiTooltip>
              <MuiTooltip title="Logarithmic scale">
                <ToggleButton value="log">Log</ToggleButton>
              </MuiTooltip>
            </ToggleButtonGroup>

            <ToggleButtonGroup
              value={aggregationPeriod}
              exclusive
              onChange={(_, newPeriod) => newPeriod && setAggregationPeriod(newPeriod)}
              size="small"
            >
              <ToggleButton value="daily">Daily</ToggleButton>
              <ToggleButton value="weekly">Weekly</ToggleButton>
              <ToggleButton value="monthly">Monthly</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>

        <ResponsiveContainer width="100%" height={350}>
          <LineChart
              data={yAxisScale === 'log' ? getLogScaleData(data.history) : data.history}
              onClick={handleChartAreaClick}
              style={{ cursor: 'pointer' }}
            >
              <defs>
                <linearGradient id="savingsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={theme.palette.success.main} stopOpacity={0.1}/>
                  <stop offset="95%" stopColor={theme.palette.success.main} stopOpacity={0.05}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={formatXAxis}
                tick={{ fill: theme.palette.text.secondary }}
              />
              <YAxis
                tick={{ fill: theme.palette.text.secondary }}
                tickFormatter={yAxisScale === 'log' ? formatYAxisLog : formatCurrencyValue}
                domain={['auto', 'auto']}
                allowDataOverflow={false}
                scale="linear"
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />

              {/* Average expense reference line */}
              {data.history.length > 0 && (() => {
                const avgExpenses = data.history.reduce((sum, item) => sum + item.expenses, 0) / data.history.length;
                const yValue = yAxisScale === 'log' && avgExpenses > 0 ? Math.log10(avgExpenses) : avgExpenses;
                return (
                  <ReferenceLine
                    y={yValue}
                    stroke={theme.palette.error.light}
                    strokeDasharray="5 5"
                    strokeOpacity={0.6}
                    label={{
                      value: `Avg: ${formatCurrencyValue(avgExpenses)}`,
                      position: 'right',
                      fill: theme.palette.error.main,
                      fontSize: 11,
                    }}
                  />
                );
              })()}

              {/* Average income reference line */}
              {data.history.length > 0 && data.history.some(h => h.income > 0) && (() => {
                const avgIncome = data.history.reduce((sum, item) => sum + item.income, 0) / data.history.filter(h => h.income > 0).length;
                const yValue = yAxisScale === 'log' && avgIncome > 0 ? Math.log10(avgIncome) : avgIncome;
                return (
                  <ReferenceLine
                    y={yValue}
                    stroke={theme.palette.success.light}
                    strokeDasharray="5 5"
                    strokeOpacity={0.6}
                    label={{
                      value: `Avg: ${formatCurrencyValue(avgIncome)}`,
                      position: 'right',
                      fill: theme.palette.success.main,
                      fontSize: 11,
                    }}
                  />
                );
              })()}

              {/* Last synced marker - show where actual data ends */}
              {isCurrentMonth() && data.history.length > 0 && (() => {
                // Find last date with actual data (non-null income or expenses)
                const lastActualData = data.history
                  .filter(h => h.income !== null || h.expenses !== null)
                  .pop();

                if (lastActualData) {
                  return (
                    <ReferenceLine
                      x={lastActualData.date}
                      stroke={theme.palette.warning.main}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      label={{
                        value: 'Last Synced',
                        position: 'top',
                        fill: theme.palette.warning.main,
                        fontSize: 11,
                        fontWeight: 'bold',
                      }}
                    />
                  );
                }
                return null;
              })()}

              <Line
                type="monotone"
                dataKey="income"
                stroke={theme.palette.success.main}
                name="Income"
                strokeWidth={2}
                dot={<CustomDot stroke={theme.palette.success.main} />}
                activeDot={{ r: 8, cursor: 'pointer' }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="expenses"
                stroke={theme.palette.error.main}
                connectNulls={false}
                name="Expenses"
                strokeWidth={2}
                dot={<CustomDot stroke={theme.palette.error.main} />}
                activeDot={{ r: 8, cursor: 'pointer' }}
              />

              {/* Anomaly markers */}
              {detectAnomalies(data.history).map((anomaly, idx) => (
                <ReferenceLine
                  key={`anomaly-${idx}`}
                  x={anomaly.date}
                  stroke={theme.palette.warning.main}
                  strokeDasharray="3 3"
                  label={{
                    value: '⚠',
                    position: 'top',
                    fill: theme.palette.warning.main,
                    fontSize: 16,
                  }}
                />
              ))}

              {/* Highlight highest expense day */}
              {(() => {
                const maxExpense = data.history.reduce((max, item) => item.expenses > max.expenses ? item : max, data.history[0]);
                return maxExpense.expenses > 0 ? (
                  <ReferenceLine
                    x={maxExpense.date}
                    stroke={theme.palette.error.dark}
                    strokeDasharray="2 2"
                    strokeOpacity={0.4}
                    label={{
                      value: '📌',
                      position: 'top',
                      fill: theme.palette.error.dark,
                      fontSize: 14,
                    }}
                  />
                ) : null;
              })()}

              {/* Trend period markers */}
              {detectTrends(data.history).map((trend, idx) => (
                <ReferenceLine
                  key={`trend-${idx}`}
                  x={trend.startDate}
                  stroke={trend.type === 'high_spending' ? theme.palette.warning.main : theme.palette.info.main}
                  strokeDasharray="4 4"
                  strokeOpacity={0.3}
                  label={{
                    value: trend.type === 'high_spending' ? '📈' : '📉',
                    position: 'insideTopLeft',
                    fill: trend.type === 'high_spending' ? theme.palette.warning.main : theme.palette.info.main,
                    fontSize: 12,
                  }}
                />
              ))}
            </LineChart>
        </ResponsiveContainer>

        {/* Integrated Insights - Shown below chart */}
        {data.history.length > 0 && (
          <Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Avg {aggregationPeriod === 'daily' ? 'Daily' : aggregationPeriod === 'weekly' ? 'Weekly' : 'Monthly'}
                </Typography>
                <Typography variant="body2" fontWeight="medium">
                  ↓ {formatCurrencyValue(data.history.reduce((sum, item) => sum + item.expenses, 0) / data.history.length)}
                  {' / '}
                  ↑ {formatCurrencyValue(data.history.reduce((sum, item) => sum + item.income, 0) / data.history.length)}
                </Typography>
              </Box>
              {data.summary.totalIncome > 0 && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Savings Rate
                  </Typography>
                  <Typography variant="body2" fontWeight="medium" color={
                    ((data.summary.totalIncome - data.summary.totalExpenses) / data.summary.totalIncome) > 0.2
                      ? 'success.main'
                      : 'error.main'
                  }>
                    {(((data.summary.totalIncome - data.summary.totalExpenses) / data.summary.totalIncome) * 100).toFixed(1)}%
                  </Typography>
                </Box>
              )}
              {detectAnomalies(data.history).length > 0 && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Anomalies
                  </Typography>
                  <Typography variant="body2" fontWeight="medium" color="warning.main">
                    ⚠ {detectAnomalies(data.history).length} spike{detectAnomalies(data.history).length !== 1 ? 's' : ''}
                  </Typography>
                </Box>
              )}
            </Box>
            {detectAnomalies(data.history).length > 0 && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {detectAnomalies(data.history).slice(0, 2).map((anomaly, idx) => (
                  <Chip
                    key={idx}
                    label={`⚠ ${format(parseLocalDate(anomaly.date), 'MMM dd')}`}
                    size="small"
                    color="warning"
                    variant="outlined"
                    sx={{ cursor: 'pointer' }}
                    onClick={() => fetchTransactionsByDate(anomaly.date)}
                  />
                ))}
              </Box>
            )}
          </Box>
        )}

        {/* Transaction List for Selected Date */}
        {hoveredDate && (
          <Box sx={{ mt: 3, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle2">
                Transactions on {format(parseLocalDate(hoveredDate), 'MMM dd, yyyy')} ({dateTransactions.length} transactions):
              </Typography>
              <Button
                size="small"
                variant="outlined"
                onClick={() => setHoveredDate(null)}
                sx={{ minWidth: 'auto', px: 1 }}
              >
                ✕
              </Button>
            </Box>
            {loadingTransactions ? (
              <CircularProgress size={20} />
            ) : dateTransactions.length > 0 ? (
              <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
                {dateTransactions.map((txn, idx) => (
                  <Box
                    key={`${txn.identifier}-${txn.vendor}-${idx}`}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      py: 1.5,
                      px: 1,
                      borderBottom: idx < dateTransactions.length - 1 ? `1px solid ${theme.palette.divider}` : 'none',
                      '&:hover': {
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                      }
                    }}
                  >
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" fontWeight="medium" sx={{ mb: 0.5 }}>
                        {txn.description || txn.vendor}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="caption" color="text.secondary">
                          {format(new Date(txn.date), 'HH:mm')}
                        </Typography>
                        {(txn.parent_name || txn.category_name || txn.category) && (
                          <>
                            <Typography variant="caption" color="text.secondary">•</Typography>
                            <Typography 
                              variant="caption" 
                              sx={{ 
                                color: 'primary.main',
                                fontWeight: 500,
                              }}
                            >
                              {txn.parent_name && txn.category_name 
                                ? `${txn.parent_name} > ${txn.category_name}`
                                : txn.category_name || txn.parent_name || txn.category}
                            </Typography>
                          </>
                        )}
                        {(txn.institution?.display_name_he || txn.vendor) && (
                          <>
                            <Typography variant="caption" color="text.secondary">•</Typography>
                            <Typography
                              variant="caption"
                              sx={{
                                color: 'text.secondary',
                                textTransform: 'capitalize',
                                fontSize: '0.7rem',
                              }}
                            >
                              {txn.institution?.display_name_he || txn.vendor}
                            </Typography>
                          </>
                        )}
                      </Box>
                    </Box>
                    <Typography
                      variant="body2"
                      fontWeight="bold"
                      color={txn.price > 0 ? 'success.main' : 'error.main'}
                      sx={{ ml: 2 }}
                    >
                      {txn.price > 0 ? '+' : ''}{formatCurrency(Math.abs(txn.price), { maximumFractionDigits: 0 })}
                    </Typography>
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No transactions found for this date.
              </Typography>
            )}
          </Box>
        )}
      </Paper>

      <Box sx={{ mb: 3 }}>
        <Paper>
          <Tabs
            value={selectedBreakdownType}
            onChange={(event, newValue) => newValue && setSelectedBreakdownType(newValue)}
            variant="fullWidth"
          >
            <Tab label="Overall" value="overall" />
            <Tab label="Income" value="income" />
            <Tab label="Expenses" value="expense" />
            <Tab label="Investment" value="investment" />
          </Tabs>
          <Box sx={{ p: 3 }}>
            {/* Overall Tab - Enhanced Charts */}
            {selectedBreakdownType === 'overall' && (
              <Grid container spacing={3}>
                {/* Sankey Financial Flow Chart */}
                <Grid item xs={12}>
                  <Paper sx={{ p: 2 }}>
                    {waterfallLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                        <CircularProgress />
                      </Box>
                    ) : waterfallData?.waterfallData && waterfallData.waterfallData.length > 0 ? (
                      <>
                        <SankeyChart data={waterfallData.waterfallData} height={600} />
                        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
                          <Typography variant="body2" fontWeight="bold">
                            Total Income: {formatCurrencyValue(waterfallData.summary.totalIncome)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Period: {format(startDate, 'MMM dd, yyyy')} - {format(endDate, 'MMM dd, yyyy')}
                          </Typography>
                        </Box>
                      </>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                        <Typography variant="body2" color="text.secondary">
                          No financial flow data available for this period
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                          Add income and expense transactions to see flow diagram
                        </Typography>
                      </Box>
                    )}
                  </Paper>
                </Grid>

                {/* Liquid Investments Chart */}
                <Grid item xs={12} md={6}>
                  <Paper sx={{ p: 2, height: '100%' }}>
                    <Typography variant="h6" gutterBottom sx={{ color: 'info.main' }}>
                      Liquid Investments
                    </Typography>
                    {liquidPortfolio.length > 0 ? (
                      <>
                        <ResponsiveContainer width="100%" height={300}>
                          <PieChart>
                            <Pie
                              data={liquidPortfolio}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={90}
                              labelLine={false}
                              label={(entry: any) => {
                                const item = entry as PortfolioBreakdownItem;
                                return `${item.name}: ${item.percentage.toFixed(1)}%`;
                              }}
                              fill="#8884d8"
                              dataKey="value"
                            >
                              {liquidPortfolio.map((entry, index) => (
                                <Cell key={`liquid-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value: number) => formatCurrencyValue(value)} />
                          </PieChart>
                        </ResponsiveContainer>
                        <Box sx={{ mt: 2, textAlign: 'center' }}>
                          <Typography variant="body2" fontWeight="bold" color="info.main">
                            Total Liquid: {formatCurrencyValue(liquidPortfolio.reduce((sum, item) => sum + item.value, 0))}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Accessible investments
                          </Typography>
                        </Box>
                      </>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                        <Typography variant="body2" color="text.secondary">
                          No liquid investments
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                          Add brokerage, crypto, or savings accounts
                        </Typography>
                      </Box>
                    )}
                  </Paper>
                </Grid>

                {/* Long-term Savings Chart */}
                <Grid item xs={12} md={6}>
                  <Paper sx={{ p: 2, height: '100%' }}>
                    <Typography variant="h6" gutterBottom sx={{ color: 'warning.main' }}>
                      Long-term Savings
                    </Typography>
                    {restrictedPortfolio.length > 0 ? (
                      <>
                        <ResponsiveContainer width="100%" height={300}>
                          <PieChart>
                            <Pie
                              data={restrictedPortfolio}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={90}
                              labelLine={false}
                              label={(entry: any) => {
                                const item = entry as PortfolioBreakdownItem;
                                return `${item.name}: ${item.percentage.toFixed(1)}%`;
                              }}
                              fill="#8884d8"
                              dataKey="value"
                            >
                              {restrictedPortfolio.map((entry, index) => (
                                <Cell key={`restricted-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value: number) => formatCurrencyValue(value)} />
                          </PieChart>
                        </ResponsiveContainer>
                        <Box sx={{ mt: 2, textAlign: 'center' }}>
                          <Typography variant="body2" fontWeight="bold" color="warning.main">
                            Total Restricted: {formatCurrencyValue(restrictedPortfolio.reduce((sum, item) => sum + item.value, 0))}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Pension, provident & study funds
                          </Typography>
                        </Box>
                      </>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300 }}>
                        <Typography variant="body2" color="text.secondary">
                          No long-term savings
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                          Add pension, provident, or study fund accounts
                        </Typography>
                      </Box>
                    )}
                  </Paper>
                </Grid>
              </Grid>
            )}

            {/* Existing breakdown panels */}
            {(['expense', 'income', 'investment'] as const).map((type) => (
              <Box key={type} sx={{ display: selectedBreakdownType === type ? 'block' : 'none' }}>
                {/* Zero Income Alert for Income Tab */}
                {type === 'income' && data && data.summary.totalIncome === 0 && hasBankAccounts !== null && (
                  <Alert
                    severity="info"
                    icon={<InfoOutlinedIcon />}
                    sx={{ mb: 2 }}
                  >
                    <AlertTitle>No Income Data</AlertTitle>
                    {hasBankAccounts === false ? (
                      <Typography variant="body2">
                        Add your bank account credentials to automatically track income transactions
                        and get a complete view of your financial flows.
                      </Typography>
                    ) : (
                      <Typography variant="body2">
                        No income transactions found for the selected period.
                        Verify your last bank scrape was successful or run a new scrape to update your data.
                      </Typography>
                    )}
                  </Alert>
                )}

                {breakdownLoading[type] ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress size={32} />
                  </Box>
                ) : breakdownData[type] ? (
                  <BreakdownPanel
                    breakdowns={breakdownData[type].breakdowns}
                    summary={breakdownData[type].summary}
                    startDate={startDate}
                    endDate={endDate}
                    categoryType={type}
                  />
                ) : (
                  <Typography color="text.secondary">
                    {type === 'investment'
                      ? 'Investment breakdown coming soon.'
                      : 'No breakdown data available for this period.'}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default HomePage;
