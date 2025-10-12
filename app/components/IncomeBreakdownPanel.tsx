import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Grid,
  Card,
  CardContent,
  Chip,
  useTheme,
  List,
  ListItem,
  ListItemText,
  Divider,
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
  AccountBalance as AccountIcon,
  CalendarToday as CalendarIcon,
  Category as CategoryIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';

const COLORS = [
  '#4caf50', '#66bb6a', '#81c784', '#a5d6a7', '#c8e6c9',
  '#00acc1', '#26c6da', '#4dd0e1', '#80deea', '#b2ebf2',
  '#ffa726', '#ffb74d', '#ffcc80', '#ffe0b2', '#fff3e0'
];

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
    byType: Array<{ type: string; total: number; count: number; average: number }>;
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

const IncomeBreakdownPanel: React.FC<IncomeBreakdownPanelProps> = ({
  data,
  startDate,
  endDate,
}) => {
  const [view, setView] = useState<'overview' | 'type' | 'source' | 'timeline'>('overview');
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();

  const formatCurrencyValue = (value: number, options?: Partial<{ minimumFractionDigits: number; maximumFractionDigits: number }>) =>
    formatCurrency(value, {
      absolute: true,
      minimumFractionDigits: options?.minimumFractionDigits ?? 0,
      maximumFractionDigits: options?.maximumFractionDigits ?? 0,
    });

  const renderOverview = () => {
    const typeData = data.breakdowns.byType.map(item => ({
      name: item.type,
      value: item.total,
      count: item.count,
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

        {/* Type Cards */}
        <Grid item xs={12} md={6}>
          <Box sx={{ maxHeight: 400, overflowY: 'auto', pr: 1 }}>
            {typeData.map((item, index) => {
              const percentage = ((item.value / totalIncome) * 100).toFixed(1);
              return (
                <Card
                  key={index}
                  sx={{
                    mb: 2,
                    transition: 'all 0.2s',
                    '&:hover': {
                      boxShadow: 3,
                    },
                  }}
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

  const renderTypeView = () => {
    const typeData = data.breakdowns.byType.map(item => ({
      name: item.type,
      value: item.total,
      count: item.count,
    }));

    return (
      <Box>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={typeData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tickFormatter={formatCurrency} />
            <YAxis type="category" dataKey="name" width={120} />
            <Tooltip
              formatter={(value: number) => formatCurrencyValue(value)}
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
              }}
            />
            <Bar dataKey="value" fill={theme.palette.success.main}>
              {typeData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    );
  };

  const renderSourceView = () => {
    const vendorData = data.breakdowns.byVendor.map(item => ({
      name: item.vendor,
      value: item.total,
    }));

    return (
      <Grid container spacing={2}>
        {vendorData.map((item, index) => (
          <Grid item xs={12} sm={6} md={4} key={index}>
            <Card>
              <CardContent>
                <Typography variant="h6" color="success.main" gutterBottom>
                  {item.name}
                </Typography>
                <Typography variant="h4" fontWeight="bold">
                  {formatCurrencyValue(item.value)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    );
  };

  const renderTimelineView = () => {
    const monthData = data.breakdowns.byMonth;

    return (
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={monthData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis tickFormatter={formatCurrency} />
          <Tooltip
            formatter={(value: number) => formatCurrencyValue(value)}
            contentStyle={{
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="total"
            stroke={theme.palette.success.main}
            strokeWidth={2}
            name="Income"
          />
        </LineChart>
      </ResponsiveContainer>
    );
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6">
          Income Breakdown
        </Typography>
        <ToggleButtonGroup
          value={view}
          exclusive
          onChange={(e, newView) => newView && setView(newView)}
          size="small"
        >
          <ToggleButton value="overview">
            <CategoryIcon sx={{ mr: 0.5, fontSize: 18 }} />
            Overview
          </ToggleButton>
          <ToggleButton value="type">Type</ToggleButton>
          <ToggleButton value="source">
            <AccountIcon sx={{ mr: 0.5, fontSize: 18 }} />
            Source
          </ToggleButton>
          <ToggleButton value="timeline">
            <CalendarIcon sx={{ mr: 0.5, fontSize: 18 }} />
            Timeline
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {view === 'overview' && renderOverview()}
      {view === 'type' && renderTypeView()}
      {view === 'source' && renderSourceView()}
      {view === 'timeline' && renderTimelineView()}

      {/* Recent Transactions */}
      {view === 'overview' && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" gutterBottom>
            Recent Income
          </Typography>
          <List dense>
            {data.recentTransactions.slice(0, 10).map((txn, index) => (
              <React.Fragment key={index}>
                <ListItem>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2">{txn.name}</Typography>
                        {txn.accountNumber && (
                          <Chip
                            label={`****${txn.accountNumber}`}
                            size="small"
                            variant="outlined"
                            sx={{
                              fontSize: '0.7rem',
                              height: 20,
                              fontFamily: 'monospace',
                            }}
                          />
                        )}
                      </Box>
                    }
                    secondary={`${new Date(txn.date).toLocaleDateString()} • ${txn.vendor}`}
                  />
                  <Typography variant="body2" fontWeight="bold" color="success.main">
                    {formatCurrencyValue(txn.price)}
                  </Typography>
                </ListItem>
                {index < data.recentTransactions.slice(0, 10).length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
        </Box>
      )}
    </Paper>
  );
};

export default IncomeBreakdownPanel;
