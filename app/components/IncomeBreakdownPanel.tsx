import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Grid,
  Card,
  CardContent,
  Chip,
  useTheme,
  List,
  ListItem,
  ListItemText,
  Divider,
  Breadcrumbs,
  Link,
  Fade,
  Zoom,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import {
  TrendingUp as IncomeIcon,
  ChevronRight as ChevronRightIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';

const COLORS = [
  '#4caf50', '#66bb6a', '#81c784', '#a5d6a7', '#c8e6c9',
  '#00acc1', '#26c6da', '#4dd0e1', '#80deea', '#b2ebf2',
  '#ffa726', '#ffb74d', '#ffcc80', '#ffe0b2', '#fff3e0'
];

interface Subcategory {
  id: number;
  name: string;
  count: number;
  total: number;
}

interface IncomeType {
  parentId: number;
  category: string;
  count: number;
  total: number;
  subcategories: Subcategory[];
}

interface IncomeBreakdownData {
  summary: {
    totalIncome: number;
    transactionCount: number;
    averageIncome: number;
    minIncome: number;
    maxIncome: number;
  };
  breakdowns: {
    byVendor: Array<{ vendor: string; total: number; count: number; average: number }>;
    byMonth: Array<{ month: string; total: number; count: number; average: number }>;
    byType: IncomeType[];
    byAccount: Array<{ vendor: string; accountNumber: string; total: number; count: number }>;
    byDayOfWeek: Array<{ dayName: string; dayNumber: number; total: number; count: number }>;
  };
  recentTransactions: Array<{
    date: string;
    name: string;
    price: number;
    vendor: string;
    accountNumber: string;
  }>;
}

interface IncomeBreakdownPanelProps {
  data: IncomeBreakdownData;
  startDate: Date;
  endDate: Date;
}

interface DrillLevel {
  type: 'parent' | 'subcategory';
  parentId?: number;
  parentName?: string;
  subcategoryId?: number;
  subcategoryName?: string;
}

interface CategoryDetails {
  summary: {
    count: number;
    total: number;
    average: number;
    minAmount: number;
    maxAmount: number;
  };
  subcategories: Subcategory[];
  byVendor: Array<{ vendor: string; count: number; total: number }>;
  transactions: Array<{
    date: string;
    name: string;
    price: number;
    vendor: string;
    account_number: string;
  }>;
  trend: Array<{ month: string; total: number; count: number }>;
}

const IncomeBreakdownPanel: React.FC<IncomeBreakdownPanelProps> = ({
  data,
  startDate,
  endDate,
}) => {
  const [drillStack, setDrillStack] = useState<DrillLevel[]>([]);
  const [categoryDetails, setCategoryDetails] = useState<CategoryDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();

  const formatCurrencyValue = (value: number, options?: Partial<{ minimumFractionDigits: number; maximumFractionDigits: number }>) =>
    formatCurrency(value, {
      absolute: true,
      minimumFractionDigits: options?.minimumFractionDigits ?? 0,
      maximumFractionDigits: options?.maximumFractionDigits ?? 0,
    });

  const fetchCategoryDetails = async (
    parentId?: number,
    subcategoryId?: number,
    categoryName?: string
  ) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (parentId) params.append('parentId', parentId.toString());
      if (subcategoryId) params.append('subcategoryId', subcategoryId.toString());
      if (categoryName) params.append('category', categoryName);
      params.append('type', 'income');
      params.append('startDate', startDate.toISOString());
      params.append('endDate', endDate.toISOString());

      const response = await fetch(`/api/analytics/category-details?${params}`);
      const details = await response.json();
      setCategoryDetails(details);
    } catch (error) {
      console.error('Error fetching category details:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrillDown = (parentId: number, parentName: string) => {
    setIsZooming(true);
    setDrillStack([...drillStack, { type: 'parent', parentId, parentName }]);
    fetchCategoryDetails(parentId, undefined, parentName);
    setTimeout(() => setIsZooming(false), 300);
  };

  const handleSubcategoryClick = (subcategoryId: number, subcategoryName: string) => {
    setIsZooming(true);
    const currentLevel = drillStack[drillStack.length - 1];
    setDrillStack([
      ...drillStack,
      {
        type: 'subcategory',
        parentId: currentLevel?.parentId,
        parentName: currentLevel?.parentName,
        subcategoryId,
        subcategoryName,
      },
    ]);
    fetchCategoryDetails(undefined, subcategoryId, subcategoryName);
    setTimeout(() => setIsZooming(false), 300);
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      setDrillStack([]);
      setCategoryDetails(null);
    } else {
      const newStack = drillStack.slice(0, index + 1);
      setDrillStack(newStack);
      const level = newStack[newStack.length - 1];
      if (level.type === 'parent') {
        fetchCategoryDetails(level.parentId, undefined, level.parentName);
      } else {
        fetchCategoryDetails(undefined, level.subcategoryId, level.subcategoryName);
      }
    }
  };

  const renderBreadcrumbs = () => {
    if (drillStack.length === 0) return null;

    return (
      <Breadcrumbs separator={<ChevronRightIcon fontSize="small" />} sx={{ mb: 2 }}>
        <Link
          component="button"
          variant="body2"
          onClick={() => handleBreadcrumbClick(-1)}
          sx={{ cursor: 'pointer', textDecoration: 'none' }}
        >
          All Income Categories
        </Link>
        {drillStack.map((level, index) => (
          <Link
            key={index}
            component="button"
            variant="body2"
            onClick={() => handleBreadcrumbClick(index)}
            sx={{
              cursor: index < drillStack.length - 1 ? 'pointer' : 'default',
              textDecoration: 'none',
              fontWeight: index === drillStack.length - 1 ? 600 : 400,
            }}
          >
            {level.type === 'parent' ? level.parentName : level.subcategoryName}
          </Link>
        ))}
      </Breadcrumbs>
    );
  };

  const renderOverview = () => {
    const typeData = data.breakdowns.byType.map(item => ({
      name: item.category,
      value: item.total,
      count: item.count,
      parentId: item.parentId,
      subcategories: item.subcategories,
    }));

    const totalIncome = data.summary.totalIncome;

    return (
      <Grid container spacing={3}>
        {/* Summary Cards */}
        <Grid item xs={12}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    Total Income
                  </Typography>
                  <Typography variant="h5" fontWeight="bold" color="success.main">
                    {formatCurrencyValue(data.summary.totalIncome)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    Transactions
                  </Typography>
                  <Typography variant="h5" fontWeight="bold">
                    {data.summary.transactionCount}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    Average
                  </Typography>
                  <Typography variant="h5" fontWeight="bold">
                    {formatCurrencyValue(data.summary.averageIncome)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    Largest
                  </Typography>
                  <Typography variant="h5" fontWeight="bold">
                    {formatCurrencyValue(data.summary.maxIncome)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Grid>

        {/* Pie Chart */}
        <Grid item xs={12} md={6}>
          <Box sx={{ position: 'relative' }}>
            <Typography variant="h6" gutterBottom align="center">
              Income by Type
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={typeData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={(entry: any) => {
                    const percent = ((entry.value / totalIncome) * 100).toFixed(0);
                    return `${percent}%`;
                  }}
                >
                  {typeData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => formatCurrencyValue(value)}
                  contentStyle={{
                    backgroundColor: theme.palette.background.paper,
                    border: `1px solid ${theme.palette.divider}`,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </Box>
        </Grid>

        {/* Category Cards - Interactive */}
        <Grid item xs={12} md={6}>
          <Box sx={{ maxHeight: 400, overflowY: 'auto', pr: 1 }}>
            {typeData.map((item, index) => {
              const percentage = ((item.value / totalIncome) * 100).toFixed(1);
              return (
                <Card
                  key={index}
                  sx={{
                    mb: 2,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    '&:hover': {
                      boxShadow: 3,
                      transform: 'translateX(4px)',
                    },
                  }}
                  onClick={() => handleDrillDown(item.parentId, item.name)}
                >
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          backgroundColor: COLORS[index % COLORS.length],
                          flexShrink: 0,
                        }}
                      />
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                          <Typography variant="body2" fontWeight="medium" noWrap>
                            {item.name}
                          </Typography>
                          <Typography variant="body2" fontWeight="bold" color="success.main">
                            {formatCurrencyValue(item.value)}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Chip label={`${item.count} transactions`} size="small" variant="outlined" />
                          <Chip label={`${percentage}%`} size="small" color="success" />
                        </Box>
                      </Box>
                      <ChevronRightIcon sx={{ color: 'text.secondary' }} />
                    </Box>
                  </CardContent>
                </Card>
              );
            })}
          </Box>
        </Grid>
      </Grid>
    );
  };

  const renderDrillDownView = () => {
    if (!categoryDetails || isLoading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <Typography>Loading...</Typography>
        </Box>
      );
    }

    const currentLevel = drillStack[drillStack.length - 1];
    const isParentLevel = currentLevel.type === 'parent';

    return (
      <Zoom in={!isZooming}>
        <Box>
          {/* Summary Cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    Total Income
                  </Typography>
                  <Typography variant="h5" fontWeight="bold" color="success.main">
                    {formatCurrencyValue(categoryDetails.summary.total)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    Transactions
                  </Typography>
                  <Typography variant="h5" fontWeight="bold">
                    {categoryDetails.summary.count}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    Average
                  </Typography>
                  <Typography variant="h5" fontWeight="bold">
                    {formatCurrencyValue(categoryDetails.summary.average)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    Largest
                  </Typography>
                  <Typography variant="h5" fontWeight="bold">
                    {formatCurrencyValue(categoryDetails.summary.maxAmount)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Subcategories (if viewing parent) */}
          {isParentLevel && categoryDetails.subcategories && categoryDetails.subcategories.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Subcategories
              </Typography>
              <Grid container spacing={2}>
                {categoryDetails.subcategories.map((subcat, index) => (
                  <Grid item xs={12} sm={6} md={4} key={subcat.id}>
                    <Card
                      sx={{
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        '&:hover': {
                          boxShadow: 3,
                          transform: 'translateY(-2px)',
                        },
                      }}
                      onClick={() => handleSubcategoryClick(subcat.id, subcat.name)}
                    >
                      <CardContent>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 1 }}>
                          <Typography variant="subtitle1" fontWeight="medium">
                            {subcat.name}
                          </Typography>
                          <ChevronRightIcon sx={{ color: 'text.secondary' }} />
                        </Box>
                        <Typography variant="h6" color="success.main" gutterBottom>
                          {formatCurrencyValue(subcat.total)}
                        </Typography>
                        <Chip
                          label={`${subcat.count} transactions`}
                          size="small"
                          variant="outlined"
                        />
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {/* Recent Transactions */}
          <Box>
            <Typography variant="h6" gutterBottom>
              Recent Transactions
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>Vendor</TableCell>
                    <TableCell>Account</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {categoryDetails.transactions.map((txn, index) => (
                    <TableRow key={index} hover>
                      <TableCell>
                        {new Date(txn.date).toLocaleDateString()}
                      </TableCell>
                      <TableCell>{txn.name}</TableCell>
                      <TableCell>{txn.vendor}</TableCell>
                      <TableCell>
                        {txn.account_number && (
                          <Chip
                            label={`****${txn.account_number.slice(-4)}`}
                            size="small"
                            variant="outlined"
                            sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
                          />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" fontWeight="bold" color="success.main">
                          {formatCurrencyValue(txn.price)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </Box>
      </Zoom>
    );
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {drillStack.length > 0 && (
            <IconButton
              size="small"
              onClick={() => handleBreadcrumbClick(drillStack.length - 2)}
              sx={{ mr: 1 }}
            >
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography variant="h6">
            {drillStack.length === 0 ? 'Income Breakdown' : 'Income Details'}
          </Typography>
        </Box>
      </Box>

      {renderBreadcrumbs()}

      <Fade in={drillStack.length === 0}>
        <Box sx={{ display: drillStack.length === 0 ? 'block' : 'none' }}>
          {renderOverview()}
        </Box>
      </Fade>

      {drillStack.length > 0 && renderDrillDownView()}
    </Paper>
  );
};

export default IncomeBreakdownPanel;
