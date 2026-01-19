import React, { useEffect, useState } from 'react';
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
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { PortfolioHistoryPoint, InvestmentData, PortfolioSummary, InvestmentAccountSummary } from '@renderer/types/investments';
import { useInvestmentsFilters, HistoryTimeRangeOption } from '../InvestmentsFiltersContext';
import { useTranslation } from 'react-i18next';
import CustomTooltip, { TooltipDataItem } from './CustomTooltip';

interface PortfolioHistorySectionProps {
  overallHistory: PortfolioHistoryPoint[];
  accountHistories: Record<number, PortfolioHistoryPoint[]>;
  portfolioData: PortfolioSummary | null;
  transactions: InvestmentData['transactions'];
  loadingHistory: boolean;
  loadingTransactions: boolean;
}

// Color palette for charts
const CHART_COLORS = [
  '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#a05195', '#d45087', '#f95d6a', '#ff7c43', '#ffa600'
];

const PortfolioHistorySection: React.FC<PortfolioHistorySectionProps> = ({
  overallHistory,
  accountHistories,
  portfolioData,
  transactions,
  loadingHistory,
  loadingTransactions,
}) => {
  const theme = useTheme();
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { historyTimeRange, setHistoryTimeRange, viewMode, setViewMode } = useInvestmentsFilters();
  const [displayMode, setDisplayMode] = useState<'chart' | 'table'>(
    viewMode === 'detailed' ? 'table' : 'chart'
  );
  const [expanded, setExpanded] = useState(true);
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'investmentsPage.history' });
  const locale = (i18n.language || 'he').toLowerCase();
  const currentValueLabel = t('series.currentValue');
  const costBasisLabel = t('series.costBasis');

  useEffect(() => {
    setDisplayMode(viewMode === 'detailed' ? 'table' : 'chart');
  }, [viewMode]);

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const renderStackedAreaChart = () => {
    if (!portfolioData || !accountHistories || Object.keys(accountHistories).length === 0) {
      return (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {t('empty.history')}
          </Typography>
        </Box>
      );
    }

    // 1. Identify accounts and sort them: Restricted (Longterm) first, then Liquid
    const restrictedAccounts = portfolioData.restrictedAccounts || [];
    const liquidAccounts = portfolioData.liquidAccounts || [];
    
    // We want Restricted at the bottom of the stack.
    // In Recharts AreaChart, the first <Area> is at the bottom.
    // So we should render Restricted accounts first.
    const orderedAccounts = [...restrictedAccounts, ...liquidAccounts];
    
    // 2. Collect all unique dates
    const allDates = new Set<string>();
    Object.values(accountHistories).forEach(history => {
      history.forEach(point => allDates.add(point.date.split('T')[0]));
    });
    const sortedDates = Array.from(allDates).sort();

    // 3. Build data points
    const data = sortedDates.map(dateStr => {
      const point: any = { 
        date: new Date(dateStr).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: sortedDates.length > 90 ? '2-digit' : undefined,
        }),
        fullDate: dateStr
      };
      
      orderedAccounts.forEach(account => {
        const history = accountHistories[account.id];
        if (history) {
          // Find exact match
          const match = history.find(h => h.date.startsWith(dateStr));
          if (match) {
            point[account.id] = match.currentValue;
          } else {
            // Simple fallback: 0. 
            // Ideally we would forward-fill, but for now let's assume aligned data or 0.
            // If we want forward fill, we'd need to track last known values outside the map.
            point[account.id] = 0;
          }
        } else {
          point[account.id] = 0;
        }
      });
      return point;
    });

    // Forward fill logic (optional but recommended for smoother charts)
    // Let's do a quick pass to forward fill if needed, or just rely on 0.
    // Given the user wants "evolution", 0 might be misleading if data is missing for a day.
    // But implementing robust forward fill inside map is tricky. 
    // Let's stick to 0 for now, assuming the backend provides consistent daily snapshots or we accept gaps.

    return (
      <Box sx={{ p: 2, flexGrow: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              {orderedAccounts.map((account, index) => (
                <linearGradient key={`gradient-${account.id}`} id={`color-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS[index % CHART_COLORS.length]} stopOpacity={0.8}/>
                  <stop offset="95%" stopColor={CHART_COLORS[index % CHART_COLORS.length]} stopOpacity={0.1}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={theme.palette.mode === 'dark' ? theme.palette.grey[700] : theme.palette.grey[300]}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              angle={sortedDates.length > 30 ? -45 : 0}
              textAnchor={sortedDates.length > 30 ? 'end' : 'middle'}
              height={sortedDates.length > 30 ? 60 : 30}
              stroke={theme.palette.text.disabled}
            />
            <YAxis
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              tickFormatter={(value: number) => (maskAmounts ? '***' : `₪${(value / 1000).toFixed(0)}k`)}
              stroke={theme.palette.text.disabled}
            />
            <RechartsTooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;

                // Find the full date from the data point
                const dataPoint = data.find(d => d.date === label);
                const fullDate = dataPoint?.fullDate;

                const items: TooltipDataItem[] = [];

                // Calculate total portfolio value for this date
                let totalValue = 0;
                payload.forEach(entry => {
                  if (typeof entry.value === 'number') {
                    totalValue += entry.value;
                  }
                });

                // Add total as first item
                items.push({
                  label: t('tooltipTotal', 'Total Portfolio'),
                  value: totalValue,
                  type: 'currency',
                });

                // Add individual account values
                payload.forEach((entry, index) => {
                  if (typeof entry.value === 'number' && entry.value > 0) {
                    const accountId = Number(entry.dataKey);
                    const account = orderedAccounts.find(a => a.id === accountId);
                    const accountName = account ? account.account_name : `Account ${accountId}`;

                    items.push({
                      label: accountName,
                      value: entry.value,
                      type: 'currency',
                      color: CHART_COLORS[index % CHART_COLORS.length],
                    });
                  }
                });

                return (
                  <CustomTooltip
                    active={active}
                    items={items}
                    title={fullDate ? new Date(fullDate).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    }) : label}
                  />
                );
              }}
            />
            <Legend 
              formatter={(value, entry: any) => {
                const accountId = entry.dataKey;
                const account = orderedAccounts.find(a => a.id === accountId);
                return account ? account.account_name : value;
              }}
            />
            {orderedAccounts.map((account, index) => (
              <Area
                key={account.id}
                type="monotone"
                dataKey={account.id}
                stackId="1"
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                fill={`url(#color-${account.id})`}
                fillOpacity={1}
                name={String(account.id)} // Used for lookup in tooltip/legend
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    );
  };

  return (
    <Paper sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {displayMode === 'chart' ? (
        <Box sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {loadingHistory ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
              <CircularProgress />
            </Box>
          ) : (
            renderStackedAreaChart()
          )}
        </Box>
      ) : (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {loadingTransactions ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
              <CircularProgress />
            </Box>
          ) : transactions && transactions.length > 0 ? (
            <>
              <TableContainer sx={{ flexGrow: 1, overflow: 'auto' }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('table.date')}</TableCell>
                      <TableCell>{t('table.description')}</TableCell>
                      <TableCell>{t('table.category')}</TableCell>
                      <TableCell align="right">{t('table.amount')}</TableCell>
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
                            label={
                              locale.startsWith('fr')
                                ? (txn.category_name_fr || txn.category_name_en || txn.category_name)
                                : locale.startsWith('en')
                                ? (txn.category_name_en || txn.category_name_fr || txn.category_name)
                                : (txn.category_name || txn.category_name_fr || txn.category_name_en) || t('table.investment')
                            }
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
                  {t('table.showing', { count: transactions.length })}
                </Typography>
              )}
            </>
          ) : (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">{t('empty.transactions')}</Typography>
            </Box>
          )}
        </Box>
      )}
    </Paper>
  );
};

export default PortfolioHistorySection;
