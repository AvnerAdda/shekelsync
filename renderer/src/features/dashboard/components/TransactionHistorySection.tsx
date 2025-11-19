import React from 'react';
import {
  Paper,
  Box,
  Typography,
  Chip,
  Button,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import MuiTooltip from '@mui/material/Tooltip';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';
import { useTheme } from '@mui/material/styles';
import { format } from 'date-fns';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import InstitutionBadge from '@renderer/shared/components/InstitutionBadge';
import { useDashboardFilters } from '../DashboardFiltersContext';

interface TransactionHistorySectionProps {
  data: any;
  yAxisScale: 'linear' | 'log';
  setYAxisScale: (scale: 'linear' | 'log') => void;
  shouldUseLogScale: (history: any[]) => boolean;
  formatCurrencyValue: (value: number) => string;
  formatXAxis: (value: string) => string;
  formatYAxisLog: (value: number) => string;
  getLogScaleData: (history: any[]) => any[];
  CustomDot: React.FC<any>;
  CustomTooltip: React.FC<any>;
  handleChartAreaClick: (payload: any) => void;
  detectAnomalies: (history: any[]) => any[];
  hoveredDate: string | null;
  setHoveredDate: (value: string | null) => void;
  fetchTransactionsByDate: (date: string) => void;
  dateTransactions: any[];
  loadingTransactions: boolean;
  parseLocalDate: (value: string) => Date;
  formatCurrency: (value: number, options?: any) => string;
}

const TransactionHistorySection: React.FC<TransactionHistorySectionProps> = ({
  data,
  yAxisScale,
  setYAxisScale,
  shouldUseLogScale,
  formatCurrencyValue,
  formatXAxis,
  formatYAxisLog,
  getLogScaleData,
  CustomDot,
  CustomTooltip,
  handleChartAreaClick,
  detectAnomalies,
  hoveredDate,
  setHoveredDate,
  fetchTransactionsByDate,
  dateTransactions,
  loadingTransactions,
  parseLocalDate,
  formatCurrency,
}) => {
  const theme = useTheme();
  const { aggregationPeriod, setAggregationPeriod } = useDashboardFilters();
  const anomalies = detectAnomalies(data.history);

  return (
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
          <ToggleButtonGroup value={yAxisScale} exclusive onChange={(_, newScale) => newScale && setYAxisScale(newScale)} size="small">
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
            onChange={(_, newPeriod) => {
              if (newPeriod) {
                setAggregationPeriod(newPeriod);
                setHoveredDate(null);
              }
            }}
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
              <stop offset="5%" stopColor={theme.palette.success.main} stopOpacity={0.1} />
              <stop offset="95%" stopColor={theme.palette.success.main} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tickFormatter={formatXAxis} tick={{ fill: theme.palette.text.secondary }} />
          <YAxis
            tick={{ fill: theme.palette.text.secondary }}
            tickFormatter={yAxisScale === 'log' ? formatYAxisLog : formatCurrencyValue}
            domain={['auto', 'auto']}
            allowDataOverflow={false}
            scale="linear"
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />

          {data.history.length > 0 && (() => {
            const avgExpenses = data.history.reduce((sum: number, item: any) => sum + (item.expenses ?? 0), 0) / data.history.length;
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

          {data.history.length > 0 && data.history.some((h: any) => h.income > 0) && (() => {
            const avgIncome =
              data.history.reduce((sum: number, item: any) => sum + (item.income ?? 0), 0) /
              data.history.filter((h: any) => h.income > 0).length;
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

          <Line
            type="monotone"
            dataKey="income"
            stroke={theme.palette.success.main}
            strokeWidth={2}
            dot={<CustomDot />}
            name="Income"
            fill="url(#savingsGradient)"
          />
          <Line type="monotone" dataKey="expenses" stroke={theme.palette.error.main} strokeWidth={2} dot={<CustomDot />} name="Expenses" />
        </LineChart>
      </ResponsiveContainer>

      {anomalies.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Detected Patterns
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Avg {aggregationPeriod === 'daily' ? 'Daily' : aggregationPeriod === 'weekly' ? 'Weekly' : 'Monthly'}
              </Typography>
              <Typography variant="body2" fontWeight="medium">
                ↓ {formatCurrencyValue(data.history.reduce((sum: number, item: any) => sum + (item.expenses ?? 0), 0) / data.history.length)}
                {' / '}
                ↑ {formatCurrencyValue(data.history.reduce((sum: number, item: any) => sum + (item.income ?? 0), 0) / data.history.length)}
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
            {anomalies.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Anomalies
                </Typography>
                <Typography variant="body2" fontWeight="medium" color="warning.main">
                  ⚠ {anomalies.length} spike{anomalies.length !== 1 ? 's' : ''}
                </Typography>
              </Box>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            {anomalies.slice(0, 2).map((anomaly, idx) => (
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
        </Box>
      )}

      {hoveredDate && (
        <Box sx={{ mt: 3, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle2">
              Transactions on {format(parseLocalDate(hoveredDate), 'MMM dd, yyyy')} ({dateTransactions.length} transactions):
            </Typography>
            <Button size="small" variant="outlined" onClick={() => setHoveredDate(null)} sx={{ minWidth: 'auto', px: 1 }}>
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
                    },
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
                          <Typography variant="caption" color="text.secondary">
                            •
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 500 }}>
                            {txn.parent_name && txn.category_name
                              ? `${txn.parent_name} > ${txn.category_name}`
                              : txn.category_name || txn.parent_name || txn.category}
                          </Typography>
                        </>
                      )}
                      {(txn.institution?.display_name_he || txn.vendor) && (
                        <>
                          <Typography variant="caption" color="text.secondary">
                            •
                          </Typography>
                          <InstitutionBadge institution={txn.institution} fallback={txn.vendor} />
                        </>
                      )}
                    </Box>
                  </Box>
                  <Typography variant="body2" fontWeight="bold" color={txn.price > 0 ? 'success.main' : 'error.main'} sx={{ ml: 2 }}>
                    {txn.price > 0 ? '+' : ''}
                    {formatCurrency(Math.abs(txn.price), { maximumFractionDigits: 0 })}
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
  );
};

export default TransactionHistorySection;
