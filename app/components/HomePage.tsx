import React, { useState, useEffect } from 'react';
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
} from '@mui/material';
import {
  AccountBalance as AccountBalanceIcon,
  DateRange as DateRangeIcon,
  Add as AddIcon,
  InfoOutlined as InfoOutlinedIcon,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import SankeyChart from './SankeyChart';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import SummaryCards from '../components/SummaryCards';
import BreakdownPanel from '../components/BreakdownPanel';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import { EmptyState, OnboardingChecklist } from './EmptyState';

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
}

interface PortfolioBreakdownItem {
  name: string;
  value: number;
  percentage: number;
  [key: string]: any;
}

interface MonthlyFlowItem {
  name: string;
  value: number;
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
  const [portfolioBreakdown, setPortfolioBreakdown] = useState<PortfolioBreakdownItem[]>([]);
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
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const { status: onboardingStatus } = useOnboarding();

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
  }, [startDate, endDate, aggregationPeriod, selectedBreakdownType]);

  useEffect(() => {
    if (selectedBreakdownType === 'investment' && !breakdownData.investment && !breakdownLoading.investment) {
      fetchBreakdownData('investment');
    }
  }, [selectedBreakdownType, breakdownData.investment, breakdownLoading.investment]);

  const fetchTransactionsByDate = async (date: string) => {
    setLoadingTransactions(true);
    console.log('fetchTransactionsByDate called with:', date);
    try {
      const formattedDate = format(new Date(date), 'yyyy-MM-dd');
      console.log('Formatted date for API:', formattedDate);
      const response = await fetch(`/api/analytics/transactions-by-date?date=${formattedDate}`);
      if (response.ok) {
        const result = await response.json();
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

  const handleChartClick = (data: any, index: number) => {
    console.log('Dot click - data:', data, 'index:', index);
    // The actual payload is in the index parameter when clicking dots
    if (index && (index as any).payload && (index as any).payload.date) {
      const clickedDate = (index as any).payload.date;
      console.log('Fetching transactions for date:', clickedDate);
      fetchTransactionsByDate(clickedDate);
      setHoveredDate(clickedDate);
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
    const { cx, cy, payload } = props;
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

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/analytics/dashboard?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}&aggregation=${aggregationPeriod}`
      );
      const result = await response.json();

      // Fill in missing days/weeks/months with zero values for better visualization
      if (result.history && aggregationPeriod === 'daily') {
        result.history = fillMissingDates(result.history, startDate, endDate);
      }

      setData(result);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to fill missing dates in the history array
  const fillMissingDates = (history: any[], start: Date, end: Date) => {
    if (!history || history.length === 0) {
      return history;
    }

    const dateMap = new Map(history.map(h => [h.date, h]));
    const filled = [];
    const current = new Date(start.getTime()); // Clone to avoid mutation

    while (current <= end) {
      const dateStr = format(current, 'yyyy-MM-dd');
      if (dateMap.has(dateStr)) {
        filled.push(dateMap.get(dateStr));
      } else {
        filled.push({ date: dateStr, income: 0, expenses: 0 });
      }
      current.setDate(current.getDate() + 1);
    }

    return filled;
  };

  const fetchPortfolioValue = async () => {
    try {
      const response = await fetch('/api/investments/summary');
      if (response.ok) {
        const result = await response.json();
        setPortfolioValue(result.summary.totalPortfolioValue);

        // Set overall portfolio breakdown
        if (result.breakdown && result.breakdown.length > 0) {
          setPortfolioBreakdown(result.breakdown.map((item: any) => ({
            name: item.name || item.type,
            value: item.totalValue,
            percentage: item.percentage,
            category: item.category
          })));

          // Separate liquid and restricted portfolios
          const liquidItems = result.breakdown
            .filter((item: any) => item.category === 'liquid')
            .map((item: any) => ({
              name: item.name || item.type,
              value: item.totalValue,
              percentage: result.summary.liquid.totalValue > 0
                ? (item.totalValue / result.summary.liquid.totalValue) * 100
                : 0,
              category: item.category
            }));

          const restrictedItems = result.breakdown
            .filter((item: any) => item.category === 'restricted')
            .map((item: any) => ({
              name: item.name || item.type,
              value: item.totalValue,
              percentage: result.summary.restricted.totalValue > 0
                ? (item.totalValue / result.summary.restricted.totalValue) * 100
                : 0,
              category: item.category
            }));

          setLiquidPortfolio(liquidItems);
          setRestrictedPortfolio(restrictedItems);
        }
      }
    } catch (error) {
      console.error('Error fetching portfolio value:', error);
    }
  };

  const fetchWaterfallData = async () => {
    setWaterfallLoading(true);
    try {
      const response = await fetch(
        `/api/analytics/waterfall-flow?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`
      );
      if (response.ok) {
        const result = await response.json();
        setWaterfallData(result);
      }
    } catch (error) {
      console.error('Error fetching waterfall data:', error);
    } finally {
      setWaterfallLoading(false);
    }
  };

  const fetchBreakdownData = async (type: 'expense' | 'income' | 'investment') => {
    setBreakdownLoading(prev => ({ ...prev, [type]: true }));

    try {
      const params = new URLSearchParams({
        type,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
      const response = await fetch(`/api/analytics/breakdown?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${type} breakdown`);
      }
      const result = await response.json();
      setBreakdownData(prev => ({ ...prev, [type]: result }));
    } catch (error) {
      console.error(`Error fetching ${type} breakdown:`, error);
      setBreakdownData(prev => ({ ...prev, [type]: null }));
    } finally {
      setBreakdownLoading(prev => ({ ...prev, [type]: false }));
    }
  };

  const fetchBudgetUsage = async () => {
    try {
      const response = await fetch('/api/budgets/usage');
      if (!response.ok) {
        console.warn('Budget usage API not available yet');
        return;
      }
      const budgets = await response.json();

      if (Array.isArray(budgets) && budgets.length > 0) {
        const avgUsage = budgets.reduce((sum: number, b: any) => sum + b.percentage, 0) / budgets.length;
        setBudgetUsage(avgUsage);
      }
    } catch (error) {
      console.error('Error fetching budget usage:', error);
    }
  };

  const fetchBankAccountsStatus = async () => {
    try {
      const response = await fetch('/api/credentials');
      if (response.ok) {
        const credentials = await response.json();
        setHasBankAccounts(Array.isArray(credentials) && credentials.length > 0);
      }
    } catch (error) {
      console.error('Error fetching bank accounts status:', error);
      setHasBankAccounts(null);
    }
  };

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
            // Profile modal will be handled by parent (MainLayout)
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
                onChange={(newValue) => newValue && setStartDate(newValue)}
                slotProps={{ textField: { size: 'small' } }}
              />
              <DatePicker
                label="End Date"
                value={endDate}
                onChange={(newValue) => newValue && setEndDate(newValue)}
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

  // Custom tooltip for transaction history chart
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const dateStr = payload[0].payload.date;
      const income = payload.find((p: any) => p.dataKey === 'income')?.value || 0;
      const expenses = payload.find((p: any) => p.dataKey === 'expenses')?.value || 0;
      const localDate = parseLocalDate(dateStr);

      return (
        <Paper sx={{ p: 2, border: `1px solid ${theme.palette.divider}` }}>
          <Typography variant="body2" fontWeight="bold">
            {format(localDate, 'MMM dd, yyyy')}
          </Typography>
          <Typography variant="body2" color="success.main">
            Income: {formatCurrencyValue(income)}
          </Typography>
          <Typography variant="body2" color="error.main">
            Expenses: {formatCurrencyValue(expenses)}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Click to see transactions
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
              We haven't detected any income transactions in the selected period.
              If you're expecting income data, please verify that your most recent bank scrape was successful
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
              onChange={(newValue) => newValue && setStartDate(newValue)}
              slotProps={{ textField: { size: 'small' } }}
            />
            <DatePicker
              label="End Date"
              value={endDate}
              onChange={(newValue) => newValue && setEndDate(newValue)}
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
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">
            Transaction History
          </Typography>
          <ToggleButtonGroup
            value={aggregationPeriod}
            exclusive
            onChange={(e, newPeriod) => newPeriod && setAggregationPeriod(newPeriod)}
            size="small"
          >
            <ToggleButton value="daily">Daily</ToggleButton>
            <ToggleButton value="weekly">Weekly</ToggleButton>
            <ToggleButton value="monthly">Monthly</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data.history} onClick={handleChartAreaClick} style={{ cursor: 'pointer' }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={formatXAxis}
              tick={{ fill: theme.palette.text.secondary }}
            />
            <YAxis
              tick={{ fill: theme.palette.text.secondary }}
              tickFormatter={formatCurrencyValue}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line
              type="monotone"
              dataKey="income"
              stroke={theme.palette.success.main}
              name="Income"
              strokeWidth={2}
              dot={<CustomDot stroke={theme.palette.success.main} />}
              activeDot={{ r: 8, cursor: 'pointer' }}
            />
            <Line
              type="monotone"
              dataKey="expenses"
              stroke={theme.palette.error.main}
              name="Expenses"
              strokeWidth={2}
              dot={<CustomDot stroke={theme.palette.error.main} />}
              activeDot={{ r: 8, cursor: 'pointer' }}
            />
          </LineChart>
        </ResponsiveContainer>
        
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
                        {txn.vendor && (
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
                              {txn.vendor}
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
