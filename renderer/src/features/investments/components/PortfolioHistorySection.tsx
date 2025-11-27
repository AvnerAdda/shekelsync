import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
  useTheme,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Chip,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import {
  Timeline as TimelineIcon,
  ExpandMore as ExpandMoreIcon,
  TableChart as TableIcon,
  ShowChart as ChartIcon,
} from '@mui/icons-material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { PortfolioHistoryPoint, InvestmentData } from '@renderer/types/investments';
import { useInvestmentsFilters, HistoryTimeRangeOption } from '../InvestmentsFiltersContext';

interface PortfolioHistorySectionProps {
  overallHistory: PortfolioHistoryPoint[];
  transactions: InvestmentData['transactions'];
  loadingHistory: boolean;
  loadingTransactions: boolean;
}

const PortfolioHistorySection: React.FC<PortfolioHistorySectionProps> = ({
  overallHistory,
  transactions,
  loadingHistory,
  loadingTransactions,
}) => {
  const theme = useTheme();
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { historyTimeRange, setHistoryTimeRange } = useInvestmentsFilters();
  const [displayMode, setDisplayMode] = useState<'chart' | 'table'>('chart');
  const [expanded, setExpanded] = useState(true);

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const renderFullChart = (history: PortfolioHistoryPoint[]) => {
    if (!history || history.length === 0) {
      return (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No historical data available
          </Typography>
        </Box>
      );
    }

    const data = history.map((h) => ({
      date: new Date(h.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: history.length > 90 ? '2-digit' : undefined,
      }),
      'Current Value': h.currentValue,
      'Cost Basis': h.costBasis,
      fullDate: h.date,
    }));

    return (
      <Box sx={{ p: 2, height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={theme.palette.mode === 'dark' ? theme.palette.grey[700] : theme.palette.grey[300]}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              angle={history.length > 30 ? -45 : 0}
              textAnchor={history.length > 30 ? 'end' : 'middle'}
              height={history.length > 30 ? 60 : 30}
              stroke={theme.palette.text.disabled}
            />
            <YAxis
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              tickFormatter={(value: number) => (maskAmounts ? '***' : `₪${(value / 1000).toFixed(0)}k`)}
              stroke={theme.palette.text.disabled}
            />
            <RechartsTooltip
              formatter={(value: number | string) =>
                typeof value === 'number' ? formatCurrencyValue(value) : value
              }
              labelStyle={{ color: theme.palette.text.primary }}
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: theme.shape.borderRadius,
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="Current Value"
              stroke={theme.palette.primary.main}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="Cost Basis"
              stroke={theme.palette.success.main}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>
    );
  };

  return (
    <Paper sx={{ mb: 3, overflow: 'hidden' }}>
      <Box
        sx={{
          p: 2,
          borderBottom: `1px solid ${theme.palette.divider}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <TimelineIcon color="action" />
          <Typography variant="h6">Portfolio Performance</Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <ToggleButtonGroup
            value={displayMode}
            exclusive
            onChange={(e, newMode) => newMode && setDisplayMode(newMode)}
            size="small"
            aria-label="display mode"
          >
            <ToggleButton value="chart" aria-label="chart view">
              <ChartIcon fontSize="small" sx={{ mr: 1 }} />
              Chart
            </ToggleButton>
            <ToggleButton value="table" aria-label="table view">
              <TableIcon fontSize="small" sx={{ mr: 1 }} />
              Transactions
            </ToggleButton>
          </ToggleButtonGroup>

          {displayMode === 'chart' && (
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <Select
                value={historyTimeRange}
                onChange={(e) => setHistoryTimeRange(e.target.value as HistoryTimeRangeOption)}
                displayEmpty
                inputProps={{ 'aria-label': 'Time Range' }}
              >
                <MenuItem value="1m">1 Month</MenuItem>
                <MenuItem value="3m">3 Months</MenuItem>
                <MenuItem value="6m">6 Months</MenuItem>
                <MenuItem value="1y">1 Year</MenuItem>
                <MenuItem value="all">All Time</MenuItem>
              </Select>
            </FormControl>
          )}
        </Box>
      </Box>

      {displayMode === 'chart' ? (
        <Box>
          {loadingHistory ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
              <CircularProgress />
            </Box>
          ) : (
            renderFullChart(overallHistory)
          )}
        </Box>
      ) : (
        <Box>
          {loadingTransactions ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
              <CircularProgress />
            </Box>
          ) : transactions && transactions.length > 0 ? (
            <>
              <TableContainer sx={{ maxHeight: 400 }}>
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
                    {transactions.slice(0, 50).map((txn) => (
                      <TableRow key={`${txn.identifier}-${txn.vendor}`} hover>
                        <TableCell>
                          <Typography variant="caption">{formatDate(txn.date)}</Typography>
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
              {transactions.length > 50 && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 2, mb: 2, display: 'block', textAlign: 'center' }}
                >
                  Showing 50 of {transactions.length} transactions
                </Typography>
              )}
            </>
          ) : (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">No investment transactions found for this period</Typography>
            </Box>
          )}
        </Box>
      )}
    </Paper>
  );
};

export default PortfolioHistorySection;

