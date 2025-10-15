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
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';

interface InvestmentData {
  summary: {
    totalMovement: number;
    investmentOutflow: number;
    investmentInflow: number;
    netInvestments: number;
    totalCount: number;
  };
  byCategory: Array<{
    name: string;
    name_en: string;
    total: number;
    count: number;
    outflow: number;
    inflow: number;
  }>;
  timeline: Array<{
    month: string;
    outflow: number;
    inflow: number;
    net: number;
    count: number;
  }>;
  transactions: Array<{
    identifier: string;
    vendor: string;
    date: string;
    name: string;
    price: number;
    category_name?: string;
    category_name_en?: string;
    parent_name?: string;
    parent_name_en?: string;
    account_number?: string;
  }>;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const InvestmentsPage: React.FC = () => {
  const [data, setData] = useState<InvestmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'all' | '3m' | '6m' | '1y'>('all');
  const { formatCurrency, maskAmounts } = useFinancePrivacy();

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

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  const formatCurrencyThousands = (value: number) => {
    if (maskAmounts) {
      return formatCurrencyValue(value);
    }
    return `₪${(value / 1000).toFixed(0)}k`;
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
          Investments
        </Typography>
        <Alert severity="info">
          No investment transactions found.
        </Alert>
      </Box>
    );
  }

  const pieData = data.byCategory.map(item => ({
    name: item.name_en || item.name,
    value: item.total,
  }));

  const barData = data.byCategory.map(item => ({
    name: item.name_en || item.name,
    amount: item.total,
    count: item.count,
  }));

  // Timeline data - already aggregated by month
  const lineData = data.timeline.map(item => ({
    month: formatMonth(item.month),
    Outflow: item.outflow,
    Inflow: item.inflow,
    Net: item.net,
  })).reverse();

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Investments
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
          <Card sx={{ 
            background: data.summary.netInvestments >= 0 
              ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' 
              : 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            color: 'white'
          }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <TrendingUpIcon sx={{ mr: 1 }} />
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  Net Investments
                </Typography>
              </Box>
              <Typography variant="h4" fontWeight="bold">
                {formatCurrencyValue(data.summary.netInvestments)}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                {data.summary.netInvestments >= 0 ? 'Actively investing' : 'Withdrawing'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <MoneyIcon sx={{ mr: 1, color: '#ef4444' }} />
                <Typography variant="body2" color="text.secondary">
                  Total Outflow
                </Typography>
              </Box>
              <Typography variant="h5" fontWeight="bold">
                {formatCurrencyValue(data.summary.investmentOutflow)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Deposits & purchases
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
                  Total Inflow
                </Typography>
              </Box>
              <Typography variant="h5" fontWeight="bold">
                {formatCurrencyValue(data.summary.investmentInflow)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Withdrawals & returns
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <ChartIcon sx={{ mr: 1, color: '#f59e0b' }} />
                <Typography variant="body2" color="text.secondary">
                  Total Movement
                </Typography>
              </Box>
              <Typography variant="h5" fontWeight="bold">
                {formatCurrencyValue(data.summary.totalMovement)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {data.summary.totalCount} transactions
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Charts */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {/* Pie Chart - By Category */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Investment Breakdown
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Investments by Category
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                   label={({ name, value }) => `${name}: ${formatCurrencyValue(value as number)}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                 <Tooltip formatter={(value: number) => formatCurrencyValue(value)} />
              </PieChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* Bar Chart - By Category */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              By Category
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" />
                 <XAxis dataKey="name" angle={-15} textAnchor="end" height={80} />
                 <YAxis tickFormatter={(value) => formatCurrencyThousands(Number(value))} />
                 <Tooltip formatter={(value: number) => formatCurrencyValue(value)} />
                <Bar dataKey="amount" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* Line Chart - Timeline */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Investment Timeline
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                 <YAxis tickFormatter={(value) => formatCurrencyThousands(Number(value))} />
                 <Tooltip formatter={(value: number) => formatCurrencyValue(value)} />
                <Legend />
                <Line type="monotone" dataKey="Outflow" stroke="#ef4444" strokeWidth={2} name="Deposits" />
                <Line type="monotone" dataKey="Inflow" stroke="#10b981" strokeWidth={2} name="Withdrawals" />
                <Line type="monotone" dataKey="Net" stroke="#3b82f6" strokeWidth={3} name="Net Investments" />
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
                    {txn.category_name && (
                      <Typography variant="caption" color="text.secondary">
                        {txn.category_name_en || txn.category_name}
                        {txn.parent_name && ` • ${txn.parent_name_en || txn.parent_name}`}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={txn.price < 0 ? 'Deposit' : 'Withdrawal'}
                      color={txn.price < 0 ? 'error' : 'success'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Typography 
                      variant="body2" 
                      fontWeight="medium"
                      color={txn.price < 0 ? 'error.main' : 'success.main'}
                    >
                      {formatCurrencyValue(txn.price)}
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
