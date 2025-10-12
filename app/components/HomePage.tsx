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
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import SummaryCards from '../components/SummaryCards';
import BreakdownPanel from '../components/BreakdownPanel';

interface DashboardData {
  dateRange: { start: Date; end: Date };
  summary: {
    totalIncome: number;
    totalExpenses: number;
    netBalance: number;
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

const HomePage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);
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
  // Default to last full month
  const lastMonthStart = startOfMonth(subMonths(new Date(), 1));
  const lastMonthEnd = endOfMonth(subMonths(new Date(), 1));
  const [startDate, setStartDate] = useState<Date>(lastMonthStart);
  const [endDate, setEndDate] = useState<Date>(lastMonthEnd);
  const [aggregationPeriod, setAggregationPeriod] = useState<AggregationPeriod>('daily');
  const [selectedBreakdownType, setSelectedBreakdownType] = useState<'expense' | 'income' | 'investment'>('expense');
  const [budgetUsage, setBudgetUsage] = useState<number | undefined>();
  const theme = useTheme();

  useEffect(() => {
    setBreakdownData(prev => ({ ...prev, investment: null }));
    setBreakdownLoading(prev => ({ ...prev, investment: false }));
    fetchDashboardData();
    fetchBreakdownData('expense');
    fetchBreakdownData('income');
    fetchBudgetUsage();
  }, [startDate, endDate, aggregationPeriod, selectedBreakdownType]);

  useEffect(() => {
    if (selectedBreakdownType === 'investment' && !breakdownData.investment && !breakdownLoading.investment) {
      fetchBreakdownData('investment');
    }
  }, [selectedBreakdownType, breakdownData.investment, breakdownLoading.investment]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/analytics/dashboard?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}&aggregation=${aggregationPeriod}`
      );
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
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

  const formatCurrency = (value: number) => {
    return `₪${value.toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
  };

  const formatXAxis = (value: string) => {
    if (aggregationPeriod === 'monthly') {
      return format(new Date(value), 'MMM');
    } else if (aggregationPeriod === 'weekly') {
      return format(new Date(value), 'MM/dd');
    }
    return format(new Date(value), 'dd');
  };

  return (
    <Box>
      {/* Summary Cards */}
      <Box sx={{ mb: 4 }}>
        <SummaryCards
          totalIncome={data.summary.totalIncome}
          totalExpenses={data.summary.totalExpenses}
          netBalance={data.summary.netBalance}
          budgetUsage={budgetUsage}
        />
      </Box>

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
          <LineChart data={data.history}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={formatXAxis}
              tick={{ fill: theme.palette.text.secondary }}
            />
            <YAxis
              tick={{ fill: theme.palette.text.secondary }}
              tickFormatter={formatCurrency}
            />
            <Tooltip
              formatter={(value: number) => formatCurrency(value)}
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="income"
              stroke={theme.palette.success.main}
              name="Income"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="expenses"
              stroke={theme.palette.error.main}
              name="Expenses"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </Paper>

      <Box sx={{ mb: 3 }}>
        <Paper>
          <Tabs
            value={selectedBreakdownType}
            onChange={(event, newValue) => newValue && setSelectedBreakdownType(newValue)}
            variant="fullWidth"
          >
            <Tab label="Cost" value="expense" />
            <Tab label="Income" value="income" />
            <Tab label="Investment" value="investment" />
          </Tabs>
          <Box sx={{ p: 3 }}>
            {(['expense', 'income', 'investment'] as const).map((type) => (
              <Box key={type} sx={{ display: selectedBreakdownType === type ? 'block' : 'none' }}>
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
