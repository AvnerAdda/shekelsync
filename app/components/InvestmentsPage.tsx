import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  AccountBalance as SavingsIcon,
  AttachMoney as MoneyIcon,
  ShowChart as ChartIcon,
} from '@mui/icons-material';
import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface InvestmentData {
  summary: {
    totalInvested: number;
    totalSavings: number;
    totalCount: number;
    investmentCount: number;
    savingsCount: number;
  };
  byType: Array<{
    type: string;
    total: number;
    count: number;
  }>;
  byPlatform: Array<{
    platform: string;
    total: number;
    count: number;
    type: string;
  }>;
  timeline: Array<{
    month: string;
    type: string;
    total: number;
    count: number;
  }>;
  transactions: Array<{
    identifier: string;
    vendor: string;
    date: string;
    name: string;
    price: number;
    override_category: string;
    account_number?: string;
    notes?: string;
  }>;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const InvestmentsPage: React.FC = () => {
  const [data, setData] = useState<InvestmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'all' | '3m' | '6m' | '1y'>('all');

  useEffect(() => {
    fetchData();
  }, [dateRange]);

  const fetchData = async () => {
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

      const response = await fetch(`/api/analytics/investments?${params}`);
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Error fetching investment data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return `₪${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatMonth = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!data || data.summary.totalCount === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom fontWeight="bold">
          Investments & Savings
        </Typography>
        <Alert severity="info">
          No investment or savings transactions found. Use the Duplicate Management modal to mark transactions as investments or savings.
        </Alert>
      </Box>
    );
  }

  const pieData = data.byType.map(item => ({
    name: item.type,
    value: item.total,
  }));

  const barData = data.byPlatform.map(item => ({
    name: item.platform,
    amount: item.total,
    count: item.count,
  }));

  // Aggregate timeline by month (combine Investment + Savings)
  const timelineMap = new Map<string, { month: string; Investment: number; Savings: number }>();
  data.timeline.forEach(item => {
    const month = formatMonth(item.month);
    if (!timelineMap.has(month)) {
      timelineMap.set(month, { month, Investment: 0, Savings: 0 });
    }
    const entry = timelineMap.get(month)!;
    if (item.type === 'Investment') entry.Investment = item.total;
    if (item.type === 'Savings') entry.Savings = item.total;
  });
  const lineData = Array.from(timelineMap.values()).reverse();

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Investments & Savings
        </Typography>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Date Range</InputLabel>
          <Select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as any)}
            label="Date Range"
          >
            <MenuItem value="all">All Time</MenuItem>
            <MenuItem value="3m">Last 3 Months</MenuItem>
            <MenuItem value="6m">Last 6 Months</MenuItem>
            <MenuItem value="1y">Last Year</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <TrendingUpIcon sx={{ mr: 1, color: '#3b82f6' }} />
                <Typography variant="body2" color="text.secondary">
                  Total Invested
                </Typography>
              </Box>
              <Typography variant="h5" fontWeight="bold">
                {formatCurrency(data.summary.totalInvested)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {data.summary.investmentCount} transactions
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <SavingsIcon sx={{ mr: 1, color: '#10b981' }} />
                <Typography variant="body2" color="text.secondary">
                  Total Savings
                </Typography>
              </Box>
              <Typography variant="h5" fontWeight="bold">
                {formatCurrency(data.summary.totalSavings)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {data.summary.savingsCount} transactions
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <MoneyIcon sx={{ mr: 1, color: '#f59e0b' }} />
                <Typography variant="body2" color="text.secondary">
                  Combined Total
                </Typography>
              </Box>
              <Typography variant="h5" fontWeight="bold">
                {formatCurrency(data.summary.totalInvested + data.summary.totalSavings)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {data.summary.totalCount} transactions
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <ChartIcon sx={{ mr: 1, color: '#8b5cf6' }} />
                <Typography variant="body2" color="text.secondary">
                  Platforms
                </Typography>
              </Box>
              <Typography variant="h5" fontWeight="bold">
                {data.byPlatform.length}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Active platforms
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Charts */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {/* Pie Chart - By Type */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              By Type
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${formatCurrency(value as number)}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* Bar Chart - By Platform */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              By Platform
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-15} textAnchor="end" height={80} />
                <YAxis tickFormatter={(value) => `₪${(value / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="amount" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* Line Chart - Timeline */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Timeline
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis tickFormatter={(value) => `₪${(value / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Legend />
                <Line type="monotone" dataKey="Investment" stroke="#3b82f6" strokeWidth={2} />
                <Line type="monotone" dataKey="Savings" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
      </Grid>

      {/* Transactions Table */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          All Transactions ({data.transactions.length})
        </Typography>
        <TableContainer sx={{ maxHeight: 500 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Account</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.transactions.map((txn) => (
                <TableRow key={`${txn.identifier}-${txn.vendor}`} hover>
                  <TableCell>{formatDate(txn.date)}</TableCell>
                  <TableCell>
                    <Typography variant="body2">{txn.name}</Typography>
                    {txn.notes && (
                      <Typography variant="caption" color="text.secondary">
                        {txn.notes}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={txn.override_category}
                      color={txn.override_category === 'Investment' ? 'primary' : 'success'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight="medium">
                      {formatCurrency(txn.price)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {txn.account_number && (
                      <Typography variant="caption" color="text.secondary">
                        ****{txn.account_number}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};

export default InvestmentsPage;
