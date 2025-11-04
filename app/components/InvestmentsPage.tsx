import React, { useState, useEffect, useCallback } from 'react';
import { useOnboarding } from '../contexts/OnboardingContext';
import LockedPagePlaceholder from './EmptyState/LockedPagePlaceholder';
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
  LinearProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Tabs,
  Tab,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  Divider,
  IconButton,
  Collapse,
  ToggleButtonGroup,
  ToggleButton,
  Skeleton,
  Fab,
  Badge,
  Tooltip,
} from '@mui/material';
import {
  AccountBalance as AccountIcon,
  AttachMoney as MoneyIcon,
  ShowChart as StockIcon,
  Settings as SettingsIcon,
  ExpandMore as ExpandMoreIcon,
  Savings as PiggyBankIcon,
  School as SchoolIcon,
  CreditCard as CardIcon,
  CurrencyBitcoin as CryptoIcon,
  Link as LinkIcon,
  Pattern as PatternIcon,
  Timeline as TimelineIcon,
  Close as CloseIcon,
  Refresh as RefreshIcon,
  Dashboard as DashboardIcon,
  Visibility as ViewIcon,
  VisibilityOff as HideIcon,
  Add as AddIcon,
  Analytics as AnalyticsIcon,
} from '@mui/icons-material';
import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';
import UnifiedPortfolioModal from './UnifiedPortfolioModal';
import { apiClient } from '@/lib/api-client';

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

interface PortfolioSummary {
  summary: {
    totalPortfolioValue: number;
    totalCostBasis: number;
    unrealizedGainLoss: number;
    roi: number;
    totalAccounts: number;
    accountsWithValues: number;
    newestUpdateDate: string | null;
    liquid: {
      totalValue: number;
      totalCost: number;
      unrealizedGainLoss: number;
      roi: number;
      accountsCount: number;
    };
    restricted: {
      totalValue: number;
      totalCost: number;
      unrealizedGainLoss: number;
      roi: number;
      accountsCount: number;
    };
  };
  breakdown: Array<{
    type: string;
    name: string;
    name_he: string;
    totalValue: number;
    totalCost: number;
    count: number;
    percentage: number;
    accounts: any[];
  }>;
  timeline: Array<{
    date: string;
    totalValue: number;
    totalCost: number;
    gainLoss: number;
  }>;
  accounts: any[];
  liquidAccounts: any[];
  restrictedAccounts: any[];
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const InvestmentsPage: React.FC = () => {
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { getPageAccessStatus, status: onboardingStatus } = useOnboarding();
  const accessStatus = getPageAccessStatus('investments');
  const isLocked = accessStatus.isLocked;

  const [data, setData] = useState<InvestmentData | null>(null);
  const [portfolioData, setPortfolioData] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'all' | '3m' | '6m' | '1y'>('all');
  const [portfolioModalOpen, setPortfolioModalOpen] = useState(false);
  const [portfolioModalTab, setPortfolioModalTab] = useState(0);
  const [activeTab, setActiveTab] = useState(0);
  
  // Time series states
  const [historyTimeRange, setHistoryTimeRange] = useState<'1m' | '3m' | '6m' | '1y' | 'all'>('3m');
  const [overallHistory, setOverallHistory] = useState<any[]>([]);
  const [accountHistories, setAccountHistories] = useState<Record<number, any[]>>({});
  const [expandedAccounts, setExpandedAccounts] = useState<Record<number, boolean>>({});
  const [showOverallChart, setShowOverallChart] = useState(false);
  const [selectedAccountsFilter, setSelectedAccountsFilter] = useState<number[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<'summary' | 'detailed'>('summary');
  const [expandedSections, setExpandedSections] = useState<{[key: string]: boolean}>({
    portfolio: true,
    performance: false,
    transactions: false
  });

  const fetchHistoryData = useCallback(async () => {
    if (isLocked) {
      return;
    }
    setHistoryLoading(true);
    try {
      const overallResponse = await apiClient.get(`/api/investments/history?timeRange=${historyTimeRange}`);
      if (overallResponse.ok) {
        const overallResult = (overallResponse.data as any) || {};
        setOverallHistory(overallResult.history || []);
      } else {
        setOverallHistory([]);
      }

      if (portfolioData?.breakdown) {
        const histories: Record<number, any[]> = {};

        for (const group of portfolioData.breakdown) {
          for (const account of group.accounts) {
            if (account.id) {
              try {
                const accountResponse = await apiClient.get(`/api/investments/history?accountId=${account.id}&timeRange=${historyTimeRange}`);
                if (accountResponse.ok) {
                  const accountResult = (accountResponse.data as any) || {};
                  histories[account.id] = accountResult.history || [];
                } else {
                  histories[account.id] = [];
                }
              } catch (innerError) {
                console.error(`Error fetching history for account ${account.id}:`, innerError);
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

  useEffect(() => {
    if (isLocked) {
      return;
    }
    if (portfolioData && portfolioData.summary.totalAccounts > 0) {
      fetchHistoryData();
    }
  }, [fetchHistoryData, historyTimeRange, isLocked, portfolioData]);

  const toggleAccountChart = (accountId: number) => {
    setExpandedAccounts(prev => ({
      ...prev,
      [accountId]: !prev[accountId]
    }));
  };

  const fetchPortfolioData = useCallback(async () => {
    if (isLocked) {
      return;
    }
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
    if (isLocked) {
      return;
    }
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
    if (isLocked) {
      return;
    }
    fetchData();
    fetchPortfolioData();
  }, [fetchData, fetchPortfolioData, isLocked]);

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

  const getAccountTypeIcon = (type: string, investmentCategory?: string) => {
    // Enhanced icons with category-based coloring
    const iconProps = {
      fontSize: 'medium' as const,
      sx: {
        color: investmentCategory === 'liquid' ? 'info.main' :
               investmentCategory === 'restricted' ? 'warning.main' : 'primary.main'
      }
    };

    switch (type) {
      // Restricted long-term savings
      case 'pension':
        return <AccountIcon {...iconProps} />;
      case 'provident':
        return <SchoolIcon {...iconProps} />;
      case 'study_fund':
        return <SchoolIcon {...iconProps} />;

      // Liquid investments
      case 'brokerage':
        return <StockIcon {...iconProps} />;
      case 'crypto':
        return <CryptoIcon {...iconProps} />;
      case 'savings':
        return <PiggyBankIcon {...iconProps} />;
      case 'mutual_fund':
        return <TimelineIcon {...iconProps} />;
      case 'bonds':
        return <CardIcon {...iconProps} />;
      case 'real_estate':
        return <DashboardIcon {...iconProps} />;

      default:
        return <MoneyIcon {...iconProps} />;
    }
  };

  const handleSetupComplete = () => {
    fetchPortfolioData();
    fetchData();
  };

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        fetchData(),
        fetchPortfolioData(),
        portfolioData && portfolioData.summary.totalAccounts > 0 ? fetchHistoryData() : Promise.resolve()
      ]);
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  if (isLocked) {
    return (
      <LockedPagePlaceholder
        page="investments"
        accessStatus={accessStatus}
        onboardingStatus={onboardingStatus}
      />
    );
  }

  // Enhanced Skeleton Loading Component
  const InvestmentsSkeleton = () => (
    <Box sx={{ p: 3 }}>
      {/* Header Skeleton */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Skeleton variant="text" width={200} height={48} />
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Skeleton variant="rectangular" width={140} height={40} sx={{ borderRadius: 1 }} />
          <Skeleton variant="rectangular" width={120} height={40} sx={{ borderRadius: 1 }} />
        </Box>
      </Box>

      {/* Portfolio Cards Skeleton */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={5}>
          <Card sx={{ height: 180 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Skeleton variant="circular" width={24} height={24} sx={{ mr: 1 }} />
                <Skeleton variant="text" width={150} height={20} />
              </Box>
              <Skeleton variant="text" width={200} height={48} sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Box>
                  <Skeleton variant="text" width={60} height={16} />
                  <Skeleton variant="text" width={80} height={20} />
                </Box>
                <Box>
                  <Skeleton variant="text" width={80} height={16} />
                  <Skeleton variant="text" width={70} height={20} />
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3.5}>
          <Card sx={{ height: 180 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Skeleton variant="circular" width={24} height={24} sx={{ mr: 1 }} />
                <Skeleton variant="text" width={120} height={20} />
              </Box>
              <Skeleton variant="text" width={120} height={48} sx={{ mb: 1 }} />
              <Skeleton variant="text" width={100} height={16} />
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3.5}>
          <Card sx={{ height: 180 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Skeleton variant="circular" width={24} height={24} sx={{ mr: 1 }} />
                <Skeleton variant="text" width={130} height={20} />
              </Box>
              <Skeleton variant="text" width={100} height={48} sx={{ mb: 1 }} />
              <Skeleton variant="text" width={120} height={16} />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Portfolio Breakdown Skeleton */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Skeleton variant="text" width={180} height={32} />
          <Skeleton variant="rectangular" width={140} height={32} sx={{ borderRadius: 1 }} />
        </Box>

        {/* Accordion Skeletons */}
        {[1, 2, 3].map((i) => (
          <Paper key={i} variant="outlined" sx={{ mb: 1, borderRadius: 1 }}>
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Skeleton variant="circular" width={40} height={40} />
                <Box>
                  <Skeleton variant="text" width={120} height={20} />
                  <Skeleton variant="text" width={80} height={16} />
                </Box>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Skeleton variant="text" width={100} height={24} />
                <Skeleton variant="text" width={80} height={16} />
              </Box>
            </Box>
          </Paper>
        ))}
      </Paper>
    </Box>
  );

  // Render mini sparkline chart
  const renderSparkline = (history: any[]) => {
    if (!history || history.length === 0) {
      return null;
    }

    const data = history.map(h => ({
      date: h.date,
      value: h.currentValue
    }));

    return (
      <ResponsiveContainer width="100%" height={40}>
        <LineChart data={data}>
          <Line 
            type="monotone" 
            dataKey="value" 
            stroke="#3b82f6" 
            strokeWidth={2} 
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  };

  // Render full time series chart
  const renderFullChart = (history: any[], accountName?: string) => {
    if (!history || history.length === 0) {
      return (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No historical data available
          </Typography>
        </Box>
      );
    }

    const data = history.map(h => ({
      date: new Date(h.date).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: history.length > 90 ? '2-digit' : undefined 
      }),
      'Current Value': h.currentValue,
      'Cost Basis': h.costBasis,
      fullDate: h.date
    }));

    return (
      <Box sx={{ p: 2, height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 12 }}
              angle={history.length > 30 ? -45 : 0}
              textAnchor={history.length > 30 ? "end" : "middle"}
              height={history.length > 30 ? 60 : 30}
            />
            <YAxis 
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => maskAmounts ? '***' : `₪${(value / 1000).toFixed(0)}k`}
            />
            <RechartsTooltip
              formatter={(value: any) => formatCurrencyValue(value)}
              labelStyle={{ color: '#000' }}
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="Current Value" 
              stroke="#3b82f6" 
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line 
              type="monotone" 
              dataKey="Cost Basis" 
              stroke="#10b981" 
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>
    );
  };

  if (loading || portfolioLoading) {
    return <InvestmentsSkeleton />;
  }

  const pieData = (data?.byCategory ?? []).map(item => ({
    name: item.name_en || item.name,
    value: item.total,
  })) || [];

  const barData = (data?.byCategory ?? []).map(item => ({
    name: item.name_en || item.name,
    amount: item.total,
    count: item.count,
  })) || [];

  // Timeline data - already aggregated by month
  const lineData = (data?.timeline ?? []).map(item => ({
    month: formatMonth(item.month),
    Outflow: item.outflow,
    Inflow: item.inflow,
    Net: item.net,
  })).reverse() || [];

  return (
    <Box sx={{ p: 3 }}>
      <UnifiedPortfolioModal
        open={portfolioModalOpen}
        onClose={() => setPortfolioModalOpen(false)}
        onComplete={handleSetupComplete}
        defaultTab={portfolioModalTab}
      />

      {/* Enhanced Header */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box>
            <Typography variant="h4" fontWeight="bold" gutterBottom>
              Investments Dashboard
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Track your portfolio performance and investment transactions
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Tooltip title="Refresh all data">
              <Button
                variant="outlined"
                startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
                onClick={handleRefreshAll}
                disabled={refreshing}
                size="small"
                sx={{ textTransform: 'none', minWidth: 100 }}
              >
                {refreshing ? 'Refreshing...' : 'Refresh'}
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
              Portfolio Setup
            </Button>
          </Box>
        </Box>

        {/* Enhanced Control Bar */}
        <Paper sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, bgcolor: 'grey.50' }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tooltip title="Filter investment data by time period">
              <FormControl size="small" sx={{ minWidth: 140 }}>
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
            </Tooltip>

            <Tooltip title="Switch between summary and detailed view modes">
              <ToggleButtonGroup
                value={viewMode}
                exclusive
                onChange={(e, newMode) => newMode && setViewMode(newMode)}
                size="small"
              >
                <ToggleButton value="summary" aria-label="summary view">
                  <DashboardIcon fontSize="small" sx={{ mr: 0.5 }} />
                  Summary
                </ToggleButton>
                <ToggleButton value="detailed" aria-label="detailed view">
                  <AnalyticsIcon fontSize="small" sx={{ mr: 0.5 }} />
                  Detailed
                </ToggleButton>
              </ToggleButtonGroup>
            </Tooltip>
          </Box>
        </Paper>
      </Box>

      {/* Separated Investment Categories */}
      {portfolioData && portfolioData.summary.totalAccounts > 0 && (
        <Box sx={{ mb: 3 }}>
          {/* Overall Portfolio Summary */}
          <Card sx={{ p: 3, mb: 3, bgcolor: 'grey.50' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <AccountIcon sx={{ mr: 2, fontSize: 28, color: 'primary.main' }} />
              <Box>
                <Typography variant="h5" fontWeight="bold">
                  Total Portfolio
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {portfolioData.summary.accountsWithValues} active accounts • Last updated {portfolioData.summary.newestUpdateDate ?
                    new Date(portfolioData.summary.newestUpdateDate).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric'
                    }) : 'N/A'}
                </Typography>
              </Box>
            </Box>
            <Grid container spacing={3}>
              <Grid item xs={6} md={3}>
                <Typography variant="caption" color="text.secondary">TOTAL VALUE</Typography>
                <Typography variant="h4" fontWeight="bold" color="primary.main">
                  {formatCurrencyValue(portfolioData.summary.totalPortfolioValue)}
                </Typography>
              </Grid>
              <Grid item xs={6} md={3}>
                <Typography variant="caption" color="text.secondary">TOTAL COST</Typography>
                <Typography variant="h5" fontWeight="medium">
                  {formatCurrencyValue(portfolioData.summary.totalCostBasis)}
                </Typography>
              </Grid>
              <Grid item xs={6} md={3}>
                <Typography variant="caption" color="text.secondary">UNREALIZED P&L</Typography>
                <Typography variant="h5" fontWeight="medium"
                  color={portfolioData.summary.unrealizedGainLoss >= 0 ? 'success.main' : 'error.main'}>
                  {portfolioData.summary.unrealizedGainLoss >= 0 ? '+' : ''}
                  {formatCurrencyValue(portfolioData.summary.unrealizedGainLoss)}
                </Typography>
              </Grid>
              <Grid item xs={6} md={3}>
                <Typography variant="caption" color="text.secondary">OVERALL ROI</Typography>
                <Typography variant="h5" fontWeight="medium"
                  color={portfolioData.summary.roi >= 0 ? 'success.main' : 'error.main'}>
                  {portfolioData.summary.roi >= 0 ? '+' : ''}{portfolioData.summary.roi.toFixed(2)}%
                </Typography>
              </Grid>
            </Grid>
          </Card>

          {/* Liquid Investments Section */}
          <Card sx={{ p: 3, mb: 2, border: '2px solid', borderColor: 'info.light' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
              <StockIcon sx={{ mr: 2, fontSize: 28, color: 'info.main' }} />
              <Box>
                <Typography variant="h5" fontWeight="bold" color="info.main">
                  Liquid Investments
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Accessible investments • {portfolioData.summary.liquid.accountsCount} accounts
                </Typography>
              </Box>
            </Box>
            <Grid container spacing={3}>
              <Grid item xs={6} md={3}>
                <Typography variant="caption" color="text.secondary">CURRENT VALUE</Typography>
                <Typography variant="h4" fontWeight="bold" color="info.main">
                  {formatCurrencyValue(portfolioData.summary.liquid.totalValue)}
                </Typography>
              </Grid>
              <Grid item xs={6} md={3}>
                <Typography variant="caption" color="text.secondary">COST BASIS</Typography>
                <Typography variant="h6" fontWeight="medium">
                  {formatCurrencyValue(portfolioData.summary.liquid.totalCost)}
                </Typography>
              </Grid>
              <Grid item xs={6} md={3}>
                <Typography variant="caption" color="text.secondary">UNREALIZED P&L</Typography>
                <Typography variant="h6" fontWeight="medium"
                  color={portfolioData.summary.liquid.unrealizedGainLoss >= 0 ? 'success.main' : 'error.main'}>
                  {portfolioData.summary.liquid.unrealizedGainLoss >= 0 ? '+' : ''}
                  {formatCurrencyValue(portfolioData.summary.liquid.unrealizedGainLoss)}
                </Typography>
              </Grid>
              <Grid item xs={6} md={3}>
                <Typography variant="caption" color="text.secondary">ROI</Typography>
                <Typography variant="h6" fontWeight="medium"
                  color={portfolioData.summary.liquid.roi >= 0 ? 'success.main' : 'error.main'}>
                  {portfolioData.summary.liquid.roi >= 0 ? '+' : ''}{portfolioData.summary.liquid.roi.toFixed(2)}%
                </Typography>
              </Grid>
            </Grid>
          </Card>

          {/* Restricted Long-term Savings Section */}
          <Card sx={{ p: 3, mb: 2, border: '2px solid', borderColor: 'warning.light' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
              <SchoolIcon sx={{ mr: 2, fontSize: 28, color: 'warning.main' }} />
              <Box>
                <Typography variant="h5" fontWeight="bold" color="warning.main">
                  Long-term Savings
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Pension, provident & study funds • {portfolioData.summary.restricted.accountsCount} accounts
                </Typography>
              </Box>
            </Box>
            <Grid container spacing={3}>
              <Grid item xs={6} md={3}>
                <Typography variant="caption" color="text.secondary">CURRENT VALUE</Typography>
                <Typography variant="h4" fontWeight="bold" color="warning.main">
                  {formatCurrencyValue(portfolioData.summary.restricted.totalValue)}
                </Typography>
              </Grid>
              <Grid item xs={6} md={3}>
                <Typography variant="caption" color="text.secondary">COST BASIS</Typography>
                <Typography variant="h6" fontWeight="medium">
                  {formatCurrencyValue(portfolioData.summary.restricted.totalCost)}
                </Typography>
              </Grid>
              <Grid item xs={6} md={3}>
                <Typography variant="caption" color="text.secondary">UNREALIZED P&L</Typography>
                <Typography variant="h6" fontWeight="medium"
                  color={portfolioData.summary.restricted.unrealizedGainLoss >= 0 ? 'success.main' : 'error.main'}>
                  {portfolioData.summary.restricted.unrealizedGainLoss >= 0 ? '+' : ''}
                  {formatCurrencyValue(portfolioData.summary.restricted.unrealizedGainLoss)}
                </Typography>
              </Grid>
              <Grid item xs={6} md={3}>
                <Typography variant="caption" color="text.secondary">ROI</Typography>
                <Typography variant="h6" fontWeight="medium"
                  color={portfolioData.summary.restricted.roi >= 0 ? 'success.main' : 'error.main'}>
                  {portfolioData.summary.restricted.roi >= 0 ? '+' : ''}{portfolioData.summary.restricted.roi.toFixed(2)}%
                </Typography>
              </Grid>
            </Grid>
          </Card>

          {/* Compact Account Breakdown */}
          <Paper sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">
                Portfolio Breakdown
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>Time Range</InputLabel>
                  <Select
                    value={historyTimeRange}
                    onChange={(e) => setHistoryTimeRange(e.target.value as any)}
                    label="Time Range"
                  >
                    <MenuItem value="1m">Last Month</MenuItem>
                    <MenuItem value="3m">Last 3 Months</MenuItem>
                    <MenuItem value="6m">Last 6 Months</MenuItem>
                    <MenuItem value="1y">Last Year</MenuItem>
                    <MenuItem value="all">All Time</MenuItem>
                  </Select>
                </FormControl>
                <Button
                  size="small"
                  onClick={() => setActiveTab(activeTab === 0 ? 1 : 0)}
                  sx={{ textTransform: 'none' }}
                >
                  {activeTab === 0 ? 'View Transaction History' : 'Hide Transactions'}
                </Button>
              </Box>
            </Box>

            {/* Overall Portfolio Time Series */}
            <Accordion 
              expanded={showOverallChart}
              onChange={() => setShowOverallChart(!showOverallChart)}
              sx={{ mb: 2, '&:before': { display: 'none' } }}
            >
              <AccordionSummary 
                expandIcon={<ExpandMoreIcon />}
                sx={{ 
                  bgcolor: 'primary.light',
                  color: 'primary.dark',
                  '&:hover': { bgcolor: 'primary.main', color: 'white' },
                  borderRadius: 1,
                  minHeight: 56
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
                  <TimelineIcon />
                  <Box sx={{ flex: 1 }}>
                    <Typography fontWeight="medium">Overall Portfolio Time Series</Typography>
                    <Typography variant="caption">
                      View combined performance across all accounts
                    </Typography>
                  </Box>
                  {!showOverallChart && overallHistory.length > 0 && (
                    <Box sx={{ width: 150, height: 40, mr: 2 }}>
                      {renderSparkline(overallHistory)}
                    </Box>
                  )}
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 2 }}>
                {historyLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                    <CircularProgress size={30} />
                  </Box>
                ) : (
                  renderFullChart(overallHistory, 'Overall Portfolio')
                )}
              </AccordionDetails>
            </Accordion>
            {(portfolioData?.breakdown ?? []).map((group, index) => (
              <Accordion key={index} sx={{ '&:before': { display: 'none' } }}>
                <AccordionSummary 
                  expandIcon={<ExpandMoreIcon />}
                  sx={{ 
                    '&:hover': { bgcolor: 'action.hover' },
                    minHeight: 56
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, justifyContent: 'space-between', pr: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box sx={{ 
                        width: 40, 
                        height: 40, 
                        borderRadius: '50%', 
                        bgcolor: 'primary.light',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'primary.main'
                      }}>
                        {getAccountTypeIcon(group.type)}
                      </Box>
                      <Box>
                        <Typography fontWeight="medium">{group.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {group.count} account{group.count !== 1 ? 's' : ''}
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="h6" fontWeight="bold">
                        {formatCurrencyValue(group.totalValue)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {group.percentage.toFixed(1)}% • 
                        {group.totalCost > 0 && (
                          <span style={{ 
                            color: (group.totalValue - group.totalCost) >= 0 ? '#10b981' : '#ef4444',
                            fontWeight: 500,
                            marginLeft: 4
                          }}>
                            {((group.totalValue - group.totalCost) / group.totalCost * 100).toFixed(1)}% ROI
                          </span>
                        )}
                      </Typography>
                    </Box>
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0 }}>
                  <List disablePadding>
                    {(group.accounts ?? []).map((account: any, accIndex: number) => {
                      const accountHistory = accountHistories[account.id] || [];
                      const hasHistory = accountHistory.length > 0;
                      const isExpanded = expandedAccounts[account.id] || false;
                      
                      return (
                        <React.Fragment key={accIndex}>
                          <ListItem
                            sx={{ 
                              py: 1.5,
                              px: 2,
                              bgcolor: accIndex % 2 === 0 ? 'transparent' : 'action.hover',
                              borderRadius: 1,
                              flexDirection: 'column',
                              alignItems: 'stretch'
                            }}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                              <ListItemText
                                primary={
                                  <Typography variant="body2" fontWeight="medium">
                                    {account.account_name}
                                  </Typography>
                                }
                                secondary={
                                  <Box component="span">
                                    {account.institution && `${account.institution} • `}
                                    {account.as_of_date && `Updated ${new Date(account.as_of_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                                    {account.assets && account.assets.length > 0 && ` • ${account.assets.length} holdings`}
                                  </Box>
                                }
                              />
                              
                              {/* Mini sparkline */}
                              {hasHistory && !isExpanded && (
                                <Box 
                                  sx={{ 
                                    width: 120, 
                                    height: 40, 
                                    mx: 2,
                                    cursor: 'pointer',
                                    '&:hover': { opacity: 0.7 }
                                  }}
                                  onClick={() => toggleAccountChart(account.id)}
                                >
                                  {renderSparkline(accountHistory)}
                                </Box>
                              )}
                              
                              <Box sx={{ textAlign: 'right', ml: 2, minWidth: 120 }}>
                                <Typography variant="body1" fontWeight="600">
                                  {formatCurrencyValue(account.current_value || 0)}
                                </Typography>
                                {account.cost_basis > 0 && (
                                  <Typography 
                                    variant="caption" 
                                    sx={{ 
                                      color: (account.current_value - account.cost_basis) >= 0 ? 'success.main' : 'error.main',
                                      fontWeight: 500
                                    }}
                                  >
                                    {((account.current_value - account.cost_basis) / account.cost_basis * 100 >= 0 ? '+' : '')}
                                    {((account.current_value - account.cost_basis) / account.cost_basis * 100).toFixed(1)}%
                                  </Typography>
                                )}
                              </Box>
                              
                              {/* Chart toggle button */}
                              {hasHistory && (
                                <IconButton 
                                  size="small" 
                                  onClick={() => toggleAccountChart(account.id)}
                                  sx={{ ml: 1 }}
                                >
                                  <TimelineIcon fontSize="small" />
                                </IconButton>
                              )}
                            </Box>
                            
                            {/* Expandable chart */}
                            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                              <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="subtitle2" fontWeight="medium">
                                    Performance Over Time
                                  </Typography>
                                  <IconButton 
                                    size="small" 
                                    onClick={() => toggleAccountChart(account.id)}
                                  >
                                    <CloseIcon fontSize="small" />
                                  </IconButton>
                                </Box>
                                {historyLoading ? (
                                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                                    <CircularProgress size={30} />
                                  </Box>
                                ) : (
                                  renderFullChart(accountHistory, account.account_name)
                                )}
                              </Box>
                            </Collapse>
                          </ListItem>
                        </React.Fragment>
                      );
                    })}
                  </List>
                </AccordionDetails>
              </Accordion>
            ))}
          </Paper>
        </Box>
      )}

      {/* Transaction History - Collapsible */}
      {activeTab === 1 && data && data.summary.totalCount > 0 && (
        <Paper sx={{ p: 2, mt: 3 }}>
          <Typography variant="h6" gutterBottom>
            Recent Investment Transactions
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Showing {data.transactions.length} investment-related transactions from your bank accounts
          </Typography>
          <TableContainer sx={{ maxHeight: 400, mt: 2 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.transactions.slice(0, 50).map((txn) => (
                  <TableRow key={`${txn.identifier}-${txn.vendor}`} hover>
                    <TableCell>
                      <Typography variant="caption">
                        {formatDate(txn.date)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{txn.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={txn.category_name_en || txn.category_name || 'Investment'}
                        size="small"
                        variant="outlined"
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {data.transactions.length > 50 && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block', textAlign: 'center' }}>
              Showing 50 of {data.transactions.length} transactions
            </Typography>
          )}
        </Paper>
      )}

      {/* Enhanced No Data State */}
      {(!data || data.summary.totalCount === 0) && (!portfolioData || portfolioData.summary.totalAccounts === 0) && (
        <Paper sx={{ p: 4, textAlign: 'center', mt: 4 }}>
          <AccountIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h5" gutterBottom fontWeight="medium">
            Get Started with Your Investment Portfolio
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 500, mx: 'auto' }}>
            Track your investment performance across multiple accounts. Connect your brokerage, pension, and savings accounts to see your complete financial picture.
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
            Setup Portfolio
          </Button>
        </Paper>
      )}
    </Box>
  );
};

export default InvestmentsPage;
