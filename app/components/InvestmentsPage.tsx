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
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
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
} from '@mui/icons-material';
import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';
import UnifiedPortfolioModal from './UnifiedPortfolioModal';

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
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const InvestmentsPage: React.FC = () => {
  const [data, setData] = useState<InvestmentData | null>(null);
  const [portfolioData, setPortfolioData] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'all' | '3m' | '6m' | '1y'>('all');
  const [portfolioModalOpen, setPortfolioModalOpen] = useState(false);
  const [portfolioModalTab, setPortfolioModalTab] = useState(0);
  const [activeTab, setActiveTab] = useState(0);
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  
  // Time series states
  const [historyTimeRange, setHistoryTimeRange] = useState<'1m' | '3m' | '6m' | '1y' | 'all'>('3m');
  const [overallHistory, setOverallHistory] = useState<any[]>([]);
  const [accountHistories, setAccountHistories] = useState<Record<number, any[]>>({});
  const [expandedAccounts, setExpandedAccounts] = useState<Record<number, boolean>>({});
  const [showOverallChart, setShowOverallChart] = useState(false);
  const [selectedAccountsFilter, setSelectedAccountsFilter] = useState<number[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    fetchData();
    fetchPortfolioData();
  }, [dateRange]);

  useEffect(() => {
    if (portfolioData && portfolioData.summary.totalAccounts > 0) {
      fetchHistoryData();
    }
  }, [historyTimeRange, portfolioData]);

  const fetchHistoryData = async () => {
    setHistoryLoading(true);
    try {
      // Fetch overall aggregated history
      const overallResponse = await fetch(`/api/investments/history?timeRange=${historyTimeRange}`);
      if (overallResponse.ok) {
        const overallResult = await overallResponse.json();
        setOverallHistory(overallResult.history || []);
      }

      // Fetch individual account histories
      if (portfolioData?.breakdown) {
        const histories: Record<number, any[]> = {};
        
        for (const group of portfolioData.breakdown) {
          for (const account of group.accounts) {
            if (account.id) {
              const accountResponse = await fetch(`/api/investments/history?accountId=${account.id}&timeRange=${historyTimeRange}`);
              if (accountResponse.ok) {
                const accountResult = await accountResponse.json();
                histories[account.id] = accountResult.history || [];
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
  };

  const toggleAccountChart = (accountId: number) => {
    setExpandedAccounts(prev => ({
      ...prev,
      [accountId]: !prev[accountId]
    }));
  };

  const fetchPortfolioData = async () => {
    setPortfolioLoading(true);
    try {
      const response = await fetch('/api/investments/summary');
      if (response.ok) {
        const result = await response.json();
        setPortfolioData(result);
      }
    } catch (error) {
      console.error('Error fetching portfolio data:', error);
    } finally {
      setPortfolioLoading(false);
    }
  };

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

  const getAccountTypeIcon = (type: string) => {
    switch (type) {
      case 'pension':
        return <AccountIcon />;
      case 'provident':
      case 'study_fund':
        return <SchoolIcon />;
      case 'savings':
        return <PiggyBankIcon />;
      case 'brokerage':
        return <StockIcon />;
      case 'crypto':
        return <CryptoIcon />;
      default:
        return <MoneyIcon />;
    }
  };

  const handleSetupComplete = () => {
    fetchPortfolioData();
    fetchData();
  };

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
            <Tooltip 
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
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  const pieData = data?.byCategory.map(item => ({
    name: item.name_en || item.name,
    value: item.total,
  })) || [];

  const barData = data?.byCategory.map(item => ({
    name: item.name_en || item.name,
    amount: item.total,
    count: item.count,
  })) || [];

  // Timeline data - already aggregated by month
  const lineData = data?.timeline.map(item => ({
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

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Investments
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<SettingsIcon />}
            onClick={() => {
              setPortfolioModalTab(0);
              setPortfolioModalOpen(true);
            }}
          >
            Portfolio Setup
          </Button>
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
      </Box>

      {/* Portfolio Overview Section */}
      {portfolioData && portfolioData.summary.totalAccounts > 0 && (
        <Box sx={{ mb: 3 }}>
          {/* Compact Portfolio Summary Cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} md={5}>
              <Card sx={{ 
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                height: '100%'
              }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <AccountIcon sx={{ mr: 1 }} />
                    <Typography variant="body2" sx={{ opacity: 0.9 }}>
                      Total Portfolio Value
                    </Typography>
                  </Box>
                  <Typography variant="h3" fontWeight="bold">
                    {formatCurrencyValue(portfolioData.summary.totalPortfolioValue)}
                  </Typography>
                  <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography variant="caption" sx={{ opacity: 0.8 }} display="block">
                        Invested
                      </Typography>
                      <Typography variant="body2" fontWeight="medium">
                        {formatCurrencyValue(portfolioData.summary.totalCostBasis)}
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="caption" sx={{ opacity: 0.8 }} display="block">
                        {portfolioData.summary.accountsWithValues} accounts
                      </Typography>
                      <Typography variant="body2" fontWeight="medium">
                        Updated {portfolioData.summary.newestUpdateDate ? 
                          new Date(portfolioData.summary.newestUpdateDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) 
                          : 'N/A'}
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} md={3.5}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <TrendingUpIcon sx={{ 
                      mr: 1, 
                      color: portfolioData.summary.unrealizedGainLoss >= 0 ? '#10b981' : '#ef4444' 
                    }} />
                    <Typography variant="body2" color="text.secondary">
                      Unrealized Gains/Loss
                    </Typography>
                  </Box>
                  <Typography 
                    variant="h4" 
                    fontWeight="bold"
                    color={portfolioData.summary.unrealizedGainLoss >= 0 ? 'success.main' : 'error.main'}
                  >
                    {formatCurrencyValue(portfolioData.summary.unrealizedGainLoss)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {portfolioData.summary.unrealizedGainLoss >= 0 ? '+' : ''}
                    {formatCurrencyValue(portfolioData.summary.unrealizedGainLoss)} from cost basis
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} md={3.5}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <StockIcon sx={{ mr: 1, color: '#f59e0b' }} />
                    <Typography variant="body2" color="text.secondary">
                      Return on Investment
                    </Typography>
                  </Box>
                  <Typography 
                    variant="h4" 
                    fontWeight="bold"
                    color={portfolioData.summary.roi >= 0 ? 'success.main' : 'error.main'}
                  >
                    {portfolioData.summary.roi >= 0 ? '+' : ''}{portfolioData.summary.roi.toFixed(2)}%
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Overall portfolio performance
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

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
            {portfolioData.breakdown.map((group, index) => (
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
                    {group.accounts.map((account: any, accIndex: number) => {
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

      {/* No data state */}
      {(!data || data.summary.totalCount === 0) && (!portfolioData || portfolioData.summary.totalAccounts === 0) && (
        <Alert severity="info">
          No investment data found. Click "Portfolio Setup" to add your investment accounts and track your portfolio.
        </Alert>
      )}
    </Box>
  );
};

export default InvestmentsPage;
