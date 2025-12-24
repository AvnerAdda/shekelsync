import React, { useState, useEffect, useCallback } from 'react';
import {
  Paper,
  Box,
  Typography,
  Chip,
  Button,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
  Alert,
  IconButton,
} from '@mui/material';
import MuiTooltip from '@mui/material/Tooltip';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { useTheme } from '@mui/material/styles';
import { format, endOfMonth, differenceInDays } from 'date-fns';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import TimelineIcon from '@mui/icons-material/Timeline';
import InstitutionBadge from '@renderer/shared/components/InstitutionBadge';
import { useDashboardFilters } from '../DashboardFiltersContext';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';

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
  const { t } = useTranslation('translation', { keyPrefix: 'transactionHistory' });

  // Tab state
  const [activeTab, setActiveTab] = useState(0);
  
  // Forecast state
  const [forecastData, setForecastData] = useState<any>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  // Fetch forecast data when switching to forecast tabs
  const fetchForecast = useCallback(async () => {
    setForecastLoading(true);
    setForecastError(null);
    try {
      console.log('[TransactionHistory] Fetching forecast data from /api/forecast/daily');
      const response = await apiClient.get<any>('/api/forecast/daily');
      console.log('[TransactionHistory] Forecast response:', { ok: response.ok, status: response.status, hasData: !!response.data });
      if (!response.ok) throw new Error(`Failed to fetch forecast: ${response.statusText}`);
      setForecastData(response.data);
      console.log('[TransactionHistory] Forecast data set successfully');
    } catch (err) {
      console.error('[TransactionHistory] Forecast fetch error:', err);
      setForecastError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setForecastLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch forecast data on mount if not already loaded
    console.log('[TransactionHistory useEffect]', {
      hasForecastData: !!forecastData,
      forecastLoading,
      dailyForecastsCount: forecastData?.dailyForecasts?.length
    });
    if (!forecastData && !forecastLoading) {
      console.log('[TransactionHistory] Triggering forecast fetch from useEffect');
      fetchForecast();
    }
  }, [forecastData, forecastLoading, fetchForecast]);

  // Calculate cumulative net position data (historical only)
  const getNetPositionData = useCallback(() => {
    if (!data.history || data.history.length === 0) return [];
    let cumulative = 0;
    return data.history.map((item: any) => {
      const netFlow = (item.income || 0) - (item.expenses || 0);
      cumulative += netFlow;
      return {
        date: item.date,
        netFlow,
        cumulative,
        historicalNetFlow: netFlow,
        historicalCumulative: cumulative,
        isForecast: false,
      };
    });
  }, [data.history]);

  // Get combined data for Daily Income vs Expenses (historical + forecast)
  // Only shows forecast when aggregation is 'daily' since forecast data is daily
  const getDailyIncomeExpenseData = useCallback(() => {
    // For log scale, we need raw data first to properly handle forecast values
    const baseHistoricalData = data.history;

    console.log('[getDailyIncomeExpenseData]', {
      aggregationPeriod,
      hasForecastData: !!forecastData,
      hasDailyForecasts: !!forecastData?.dailyForecasts,
      forecastLength: forecastData?.dailyForecasts?.length,
      historicalLength: baseHistoricalData.length,
      yAxisScale
    });

    // Only add forecast data in daily aggregation mode
    if (aggregationPeriod !== 'daily' || !forecastData?.dailyForecasts) {
      console.log('[getDailyIncomeExpenseData] Not showing forecast - returning historical only');
      const transformedData = yAxisScale === 'log' ? getLogScaleData(baseHistoricalData) : baseHistoricalData;
      return transformedData.map((item: any) => ({
        ...item,
        income: item.income || 0,
        expenses: item.expenses || 0,
        isForecast: false,
      }));
    }
    
    // Use the actual end date from forecast API, not the chart's last date
    // The chart might have aggregated data that extends beyond actual transactions
    const actualEndDate = forecastData.actual?.endDate || new Date().toISOString().split('T')[0];

    // Split historical data into actual vs future placeholder data
    const actualHistoricalData = baseHistoricalData.filter((item: any) => item.date <= actualEndDate);
    const lastActualItem = actualHistoricalData.length > 0 ? actualHistoricalData[actualHistoricalData.length - 1] : null;

    // Create combined data with both historical and forecast values
    // Historical entries get their actual values for income/expenses
    const historicalData = actualHistoricalData.map((item: any) => ({
      ...item,
      income: item.income || 0,
      expenses: item.expenses || 0,
      forecastIncome: undefined,
      forecastExpenses: undefined,
      isForecast: false,
      // Store original values for log scale
      originalIncome: item.income || 0,
      originalExpenses: item.expenses || 0,
    }));

    // Bridge point - last actual date, but with FORECAST values starting
    // This creates a connection between the solid and dashed lines
    const lastIncome = lastActualItem?.income || 0;
    const lastExpenses = lastActualItem?.expenses || 0;

    // Update the last historical item to also have forecast values (to start the dashed line)
    if (historicalData.length > 0) {
      historicalData[historicalData.length - 1] = {
        ...historicalData[historicalData.length - 1],
        forecastIncome: lastIncome,
        forecastExpenses: lastExpenses,
      };
    }

    // Forecast entries - have BOTH null historical values AND forecast values
    const forecastEntries = forecastData.dailyForecasts
      .filter((d: any) => d.date > actualEndDate)
      .map((d: any) => ({
        date: d.date,
        income: undefined,
        expenses: undefined,
        forecastIncome: d.income || 0,
        forecastExpenses: d.expenses || 0,
        isForecast: true,
        // Store original values for tooltips
        originalForecastIncome: d.income || 0,
        originalForecastExpenses: d.expenses || 0,
      }));

    console.log('[getDailyIncomeExpenseData] Combining data:', {
      actualEndDate,
      historicalCount: historicalData.length,
      forecastCount: forecastEntries.length,
      totalCount: historicalData.length + forecastEntries.length,
      lastActualDate: actualEndDate,
      firstForecastDate: forecastEntries[0]?.date,
      sampleForecast: forecastEntries[0]
    });

    const combinedData = [...historicalData, ...forecastEntries];

    // For log scale, transform all data to log10, treating zeros and very small values as 0
    if (yAxisScale === 'log') {
      return combinedData.map(item => {
        // Helper to safely transform to log scale
        // Treat values < 0.01 as zero to avoid floating point precision issues
        const toLog = (val: number) => (val && val >= 0.01) ? Math.log10(val) : 0;

        if (item.isForecast) {
          // Forecast items - transform forecast values
          return {
            ...item,
            forecastIncome: toLog(item.forecastIncome),
            forecastExpenses: toLog(item.forecastExpenses),
            originalForecastIncome: item.originalForecastIncome,
            originalForecastExpenses: item.originalForecastExpenses,
          };
        } else {
          // Historical items - transform via parent function for consistency
          const logItem = getLogScaleData([item])[0];
          return {
            ...logItem,
            // Also transform forecast bridge values if present
            forecastIncome: item.forecastIncome ? toLog(item.forecastIncome) : undefined,
            forecastExpenses: item.forecastExpenses ? toLog(item.forecastExpenses) : undefined,
            originalIncome: item.originalIncome,
            originalExpenses: item.originalExpenses,
          };
        }
      });
    }

    return combinedData;
  }, [data.history, forecastData, yAxisScale, getLogScaleData, aggregationPeriod]);

  // Get combined net position data (historical + forecast with P10/P50/P90 scenarios)
  // Only shows forecast when aggregation is 'daily'
  const getCombinedNetPositionData = useCallback(() => {
    const baseHistoricalData = getNetPositionData();

    // Only add forecast data in daily aggregation mode
    if (aggregationPeriod !== 'daily' || !forecastData?.dailyForecasts || baseHistoricalData.length === 0) {
      return baseHistoricalData.map((item: any) => ({
        ...item,
        forecastCumulative: undefined,
        p10Cumulative: undefined,
        p50Cumulative: undefined,
        p90Cumulative: undefined,
      }));
    }

    // Use actual end date from API, not the chart's last date
    const actualEndDate = forecastData.actual?.endDate || new Date().toISOString().split('T')[0];
    const actualHistoricalData = baseHistoricalData.filter((item: any) => item.date <= actualEndDate);

    if (actualHistoricalData.length === 0) {
      return baseHistoricalData.map((item: any) => ({
        ...item,
        forecastCumulative: undefined,
        p10Cumulative: undefined,
        p50Cumulative: undefined,
        p90Cumulative: undefined,
      }));
    }

    const lastHistorical = actualHistoricalData[actualHistoricalData.length - 1];
    const lastHistoricalDate = lastHistorical.date;
    const startingCumulative = lastHistorical.cumulative;
    
    // Get scenario daily data
    const p10Daily = forecastData.scenarios?.p10?.daily || [];
    const p50Daily = forecastData.scenarios?.p50?.daily || [];
    const p90Daily = forecastData.scenarios?.p90?.daily || [];
    
    // Historical data - only historical values, no forecast
    const historicalData = actualHistoricalData.map((item: any, idx: number) => ({
      ...item,
      forecastCumulative: undefined,
      p10Cumulative: undefined,
      p50Cumulative: undefined,
      p90Cumulative: undefined,
    }));
    
    // Add bridge point values to last historical item
    if (historicalData.length > 0) {
      historicalData[historicalData.length - 1] = {
        ...historicalData[historicalData.length - 1],
        forecastCumulative: startingCumulative,
        p10Cumulative: startingCumulative,
        p50Cumulative: startingCumulative,
        p90Cumulative: startingCumulative,
      };
    }
    
    // Build forecast entries with scenario cumulative values
    let expectedCumulative = startingCumulative;
    let p10Cumulative = startingCumulative;
    let p50Cumulative = startingCumulative;
    let p90Cumulative = startingCumulative;
    
    const forecastEntries = forecastData.dailyForecasts
      .filter((d: any) => d.date > lastHistoricalDate)
      .map((d: any, idx: number) => {
        expectedCumulative += d.cashFlow;

        // Find matching scenario data for this date
        const p10Day = p10Daily.find((s: any) => s.date === d.date);
        const p50Day = p50Daily.find((s: any) => s.date === d.date);
        const p90Day = p90Daily.find((s: any) => s.date === d.date);

        p10Cumulative += p10Day?.cashFlow || d.cashFlow;
        p50Cumulative += p50Day?.cashFlow || d.cashFlow;
        p90Cumulative += p90Day?.cashFlow || d.cashFlow;

        return {
          date: d.date,
          historicalCumulative: undefined,
          cumulative: expectedCumulative,
          forecastCumulative: expectedCumulative,
          p10Cumulative,
          p50Cumulative,
          p90Cumulative,
          isForecast: true,
        };
      });

    console.log('[getCombinedNetPositionData] Combined data:', {
      historicalCount: historicalData.length,
      forecastCount: forecastEntries.length,
      lastHistoricalCumulative: startingCumulative,
      finalExpected: expectedCumulative,
      finalP10: p10Cumulative,
      finalP50: p50Cumulative,
      finalP90: p90Cumulative,
      sampleForecast: forecastEntries[forecastEntries.length - 1]
    });

    return [...historicalData, ...forecastEntries];
  }, [getNetPositionData, forecastData, aggregationPeriod]);

  // Calculate days remaining in current month
  const getDaysRemaining = () => {
    const now = new Date();
    const monthEnd = endOfMonth(now);
    return differenceInDays(monthEnd, now);
  };

  return (
    <Paper
      sx={(theme) => ({
        p: 3,
        mb: 3,
        background: theme.palette.mode === 'dark'
          ? 'linear-gradient(135deg, rgba(30, 30, 30, 0.6) 0%, rgba(20, 20, 20, 0.4) 100%)'
          : 'linear-gradient(135deg, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0.6) 100%)',
        backdropFilter: 'blur(20px)',
        borderRadius: '24px',
        border: `1px solid ${theme.palette.divider}`,
        boxShadow: theme.palette.mode === 'dark'
          ? '0 8px 32px 0 rgba(0, 0, 0, 0.3)'
          : '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
        transition: 'transform 0.3s ease-in-out, box-shadow 0.3s ease-in-out',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: theme.palette.mode === 'dark'
            ? '0 12px 40px 0 rgba(0, 0, 0, 0.4)'
            : '0 12px 40px 0 rgba(31, 38, 135, 0.2)',
        },
      })}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* <Typography variant="h6">{t('title')}</Typography> */}

          {/* View switcher icons */}
          <Box sx={{ 
            display: 'flex', 
            gap: 1, 
            ml: 1,
            p: 0.5,
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            borderRadius: '12px',
          }}>
            <MuiTooltip title={t('tabs.history')}>
              <IconButton
                size="small"
                onClick={() => setActiveTab(0)}
                sx={{
                  bgcolor: activeTab === 0 ? 'primary.main' : 'transparent',
                  color: activeTab === 0 ? 'primary.contrastText' : 'text.secondary',
                  borderRadius: '8px',
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: activeTab === 0 ? 'primary.dark' : 'action.hover',
                  },
                }}
              >
                <TimelineIcon fontSize="small" />
              </IconButton>
            </MuiTooltip>
            <MuiTooltip title={t('tabs.netPosition')}>
              <IconButton
                size="small"
                onClick={() => setActiveTab(1)}
                sx={{
                  bgcolor: activeTab === 1 ? 'primary.main' : 'transparent',
                  color: activeTab === 1 ? 'primary.contrastText' : 'text.secondary',
                  borderRadius: '8px',
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: activeTab === 1 ? 'primary.dark' : 'action.hover',
                  },
                }}
              >
                <AccountBalanceIcon fontSize="small" />
              </IconButton>
            </MuiTooltip>
          </Box>

          {forecastData && (
            <Chip
              label={`${forecastData.dailyForecasts?.length || 0}d forecast`}
              size="small"
              color="success"
              variant="outlined"
              sx={{ 
                fontWeight: 600,
                borderRadius: '8px',
                borderWidth: 2,
              }}
            />
          )}
        </Box>
        {activeTab === 0 && (
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <ToggleButtonGroup 
              value={yAxisScale} 
              exclusive 
              onChange={(_, newScale) => newScale && setYAxisScale(newScale)} 
              size="small"
              sx={{
                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                borderRadius: '12px',
                p: 0.5,
                '& .MuiToggleButton-root': {
                  border: 'none',
                  borderRadius: '8px !important',
                  px: 2,
                  py: 0.5,
                  color: 'text.secondary',
                  '&.Mui-selected': {
                    bgcolor: 'background.paper',
                    color: 'primary.main',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    fontWeight: 600,
                  },
                  '&:hover': {
                    bgcolor: 'rgba(0,0,0,0.05)',
                  }
                }
              }}
            >
              <MuiTooltip title={shouldUseLogScale(data.history) && yAxisScale === 'linear' ? t('scales.logRecommendedHint') : t('scales.linear')}>
                <ToggleButton 
                  value="linear"
                  sx={{
                    position: 'relative',
                    ...(shouldUseLogScale(data.history) && yAxisScale === 'linear' && {
                      '&::after': {
                        content: '"!"',
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: 'info.main',
                      },
                    }),
                  }}
                >
                  {t('scales.linear')}
                </ToggleButton>
              </MuiTooltip>
              <MuiTooltip title={t('scales.log')}>
                <ToggleButton value="log">{t('scales.log')}</ToggleButton>
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
              sx={{
                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                borderRadius: '12px',
                p: 0.5,
                '& .MuiToggleButton-root': {
                  border: 'none',
                  borderRadius: '8px !important',
                  px: 2,
                  py: 0.5,
                  color: 'text.secondary',
                  '&.Mui-selected': {
                    bgcolor: 'background.paper',
                    color: 'primary.main',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    fontWeight: 600,
                  },
                  '&:hover': {
                    bgcolor: 'rgba(0,0,0,0.05)',
                  }
                }
              }}
            >
              <ToggleButton value="daily">{t('periods.daily')}</ToggleButton>
              <ToggleButton value="weekly">{t('periods.weekly')}</ToggleButton>
              <ToggleButton value="monthly">{t('periods.monthly')}</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}
      </Box>

      {/* Tab 0: Daily Income vs Expenses with Forecast */}
      {activeTab === 0 && (
        <>
          {aggregationPeriod === 'daily' && forecastData && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1, textAlign: 'center' }}>
              {t('forecast.daysRemaining', { count: getDaysRemaining() })} — {t('forecast.forecastData')} shown as dashed lines
            </Typography>
          )}
          {aggregationPeriod !== 'daily' && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1, textAlign: 'center' }}>
              Switch to Daily view to see forecast predictions
            </Typography>
          )}
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart
              data={getDailyIncomeExpenseData()}
              onClick={handleChartAreaClick}
              style={{ cursor: 'pointer' }}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
          <defs>
            <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={theme.palette.success.main} stopOpacity={0.3} />
              <stop offset="95%" stopColor={theme.palette.success.main} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={theme.palette.error.main} stopOpacity={0.3} />
              <stop offset="95%" stopColor={theme.palette.error.main} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} vertical={false} opacity={0.5} />
          <XAxis 
            dataKey="date" 
            tickFormatter={formatXAxis} 
            tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} 
            axisLine={false}
            tickLine={false}
            dy={10}
          />
          <YAxis
            tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
            tickFormatter={yAxisScale === 'log' ? formatYAxisLog : formatCurrencyValue}
            domain={yAxisScale === 'log' ? [0, 'dataMax'] : ['auto', 'auto']}
            allowDataOverflow={false}
            scale="linear"
            allowDecimals={yAxisScale === 'log'}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const data = payload[0].payload;
              const isForecast = data.isForecast;

              // Use original values if available (for log scale), otherwise use displayed values
              const income = data.originalForecastIncome || data.originalIncome || data.forecastIncome || data.income || 0;
              const expenses = data.originalForecastExpenses || data.originalExpenses || data.forecastExpenses || data.expenses || 0;

              return (
                <Paper sx={(theme) => ({ 
                  p: 2, 
                  background: theme.palette.mode === 'dark' ? 'rgba(30, 30, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)',
                  backdropFilter: 'blur(8px)',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '12px',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
                })}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">
                      {format(parseLocalDate(data.date), 'MMM dd, yyyy')}
                    </Typography>
                    {isForecast && <Chip label="Forecast" size="small" color="warning" />}
                  </Box>
                  <Typography variant="body2" color="success.main">
                    Income: {formatCurrencyValue(income)}
                  </Typography>
                  <Typography variant="body2" color="error.main">
                    Expenses: {formatCurrencyValue(expenses)}
                  </Typography>
                </Paper>
              );
            }}
          />
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
                  value: t('avgLabel', { amount: formatCurrencyValue(avgExpenses) }),
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
                  value: t('avgLabel', { amount: formatCurrencyValue(avgIncome) }),
                  position: 'right',
                  fill: theme.palette.success.main,
                  fontSize: 11,
                }}
              />
            );
          })()}

          <Area
            type="monotone"
            dataKey="income"
            stroke={theme.palette.success.main}
            strokeWidth={3}
            fill="url(#incomeGradient)"
            dot={<CustomDot />}
            activeDot={{ r: 6, strokeWidth: 0 }}
            name={t('legend.income')}
          />
          <Area 
            type="monotone" 
            dataKey="expenses" 
            stroke={theme.palette.error.main} 
            strokeWidth={3} 
            fill="url(#expenseGradient)"
            dot={<CustomDot />} 
            activeDot={{ r: 6, strokeWidth: 0 }}
            name={t('legend.expenses')} 
          />
          {/* Forecast lines (dashed) - connect through nulls to draw continuous line from bridge point */}
          <Line 
            type="monotone" 
            dataKey="forecastIncome" 
            stroke={theme.palette.success.light} 
            strokeWidth={2} 
            strokeDasharray="5 5"
            dot={{ r: 3, fill: theme.palette.success.light }}
            name={`${t('forecast.income')} (${t('forecast.expected')})`}
            connectNulls={true}
          />
          <Line 
            type="monotone" 
            dataKey="forecastExpenses" 
            stroke={theme.palette.error.light} 
            strokeWidth={2} 
            strokeDasharray="5 5"
            dot={{ r: 3, fill: theme.palette.error.light }}
            name={`${t('forecast.expenses')} (${t('forecast.expected')})`}
            connectNulls={true}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {anomalies.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            {t('patterns.title')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {t('patterns.avgByPeriod', {
                  period:
                    aggregationPeriod === 'daily'
                      ? t('periods.daily')
                      : aggregationPeriod === 'weekly'
                        ? t('periods.weekly')
                        : t('periods.monthly'),
                })}
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
                  {t('patterns.savingsRate')}
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
                  {t('patterns.anomalies')}
                </Typography>
                <Typography variant="body2" fontWeight="medium" color="warning.main">
                  ⚠ {t('patterns.spikes', { count: anomalies.length })}
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
        </>
      )}

      {/* Tab 1: Net Position (Cumulative Cash Flow with Forecast) */}
      {activeTab === 1 && (
        <Box>
          {forecastLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 350 }}>
              <CircularProgress />
              <Typography sx={{ ml: 2 }}>{t('forecast.loading')}</Typography>
            </Box>
          )}
          {forecastError && (
            <Alert 
              severity="error" 
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" onClick={() => fetchForecast()}>
                  Retry
                </Button>
              }
            >
              {t('forecast.error')}: {forecastError}
            </Alert>
          )}
          {!forecastLoading && !forecastError && (
            <>
              {aggregationPeriod === 'daily' && forecastData && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
                  {t('forecast.daysRemaining', { count: getDaysRemaining() })} • {t('forecast.forecastData')} shown in orange
                </Typography>
              )}
              {aggregationPeriod !== 'daily' && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
                  Switch to Daily view to see forecast predictions
                </Typography>
              )}
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart 
                  data={getCombinedNetPositionData()}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="netFlowGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={theme.palette.primary.main} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={theme.palette.primary.main} stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="confidenceBandGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={theme.palette.success.main} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={theme.palette.success.main} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} vertical={false} opacity={0.5} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={formatXAxis} 
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} 
                    axisLine={false}
                    tickLine={false}
                    dy={10}
                  />
                  <YAxis 
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} 
                    tickFormatter={formatCurrencyValue} 
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip 
                    formatter={(value: number, name: string) => [formatCurrencyValue(value), name]}
                    labelFormatter={(label: string) => format(parseLocalDate(label), 'MMM dd, yyyy')}
                  />
                  <Legend />
                  <ReferenceLine y={0} stroke={theme.palette.divider} strokeWidth={2} />
                  {/* Confidence band between P10 and P90 */}
                  <Area 
                    type="monotone" 
                    dataKey="p90Cumulative" 
                    fill="url(#confidenceBandGradient)" 
                    stroke="transparent"
                    name={t('forecast.confidenceBand')}
                    connectNulls={true}
                  />
                  {/* Historical cumulative - solid blue line */}
                  <Area 
                    type="monotone" 
                    dataKey="historicalCumulative" 
                    fill="url(#netFlowGradient)" 
                    stroke={theme.palette.primary.main}
                    strokeWidth={3}
                    name={`${t('forecast.actualNet')}`}
                    connectNulls={true}
                  />
                  {/* Expected forecast - dashed orange line */}
                  <Line 
                    type="monotone" 
                    dataKey="forecastCumulative" 
                    stroke={theme.palette.warning.main}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ r: 2, fill: theme.palette.warning.main }}
                    name={t('forecast.expected')}
                    connectNulls={true}
                  />
                  {/* P90 Best Case - green dashed */}
                  <Line 
                    type="monotone" 
                    dataKey="p90Cumulative" 
                    stroke={theme.palette.success.main}
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                    dot={false}
                    name={`${t('forecast.bestCase')} (P90)`}
                    connectNulls={true}
                  />
                  {/* P50 Base Case - blue dashed */}
                  <Line 
                    type="monotone" 
                    dataKey="p50Cumulative" 
                    stroke={theme.palette.info.main}
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                    dot={false}
                    name={`${t('forecast.baseCase')} (P50)`}
                    connectNulls={true}
                  />
                  {/* P10 Worst Case - red dashed */}
                  <Line 
                    type="monotone" 
                    dataKey="p10Cumulative" 
                    stroke={theme.palette.error.main}
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                    dot={false}
                    name={`${t('forecast.worstCase')} (P10)`}
                    connectNulls={true}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </>
          )}
        </Box>
      )}

      {hoveredDate && (() => {
        // Check if this is a forecast date
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const hoveredDateObj = parseLocalDate(hoveredDate);
        hoveredDateObj.setHours(0, 0, 0, 0);
        const isForecastDate = hoveredDateObj > today;

        // Find forecast data for this date if it's a future date
        let forecastDayData = null;
        if (isForecastDate && forecastData?.dailyForecasts) {
          forecastDayData = forecastData.dailyForecasts.find((d: any) => d.date === hoveredDate);
        }

        // Determine what to show
        const showingForecast = isForecastDate && forecastDayData;
        const predictions = forecastDayData?.topPredictions || [];

        return (
          <Box sx={(theme) => ({ 
            mt: 3, 
            p: 3, 
            background: theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.4)',
            borderRadius: '16px',
            border: `1px solid ${theme.palette.divider}`,
          })}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle2">
                  {showingForecast
                    ? t('predictedTransactionsOn', {
                        date: format(parseLocalDate(hoveredDate), 'MMM dd, yyyy'),
                        count: predictions.length,
                      }) || `Predicted transactions on ${format(parseLocalDate(hoveredDate), 'MMM dd, yyyy')} (${predictions.length})`
                    : t('transactionsOn', {
                        date: format(parseLocalDate(hoveredDate), 'MMM dd, yyyy'),
                        count: dateTransactions.length,
                      })
                  }
                </Typography>
                {showingForecast && (
                  <Chip label="Forecast" size="small" color="warning" variant="outlined" />
                )}
              </Box>
              <Button size="small" variant="outlined" onClick={() => setHoveredDate(null)} sx={{ minWidth: 'auto', px: 1 }}>
                ✕
              </Button>
            </Box>

            {showingForecast ? (
              // Show forecast predictions
              predictions.length > 0 ? (
                <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
                  {predictions.map((prediction: any, idx: number) => (
                    <Box
                      key={`${prediction.category}-${idx}`}
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        py: 1.5,
                        px: 1,
                        borderBottom: idx < predictions.length - 1 ? `1px solid ${theme.palette.divider}` : 'none',
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        mb: 0.5,
                        opacity: 0.9,
                      }}
                    >
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight="medium" sx={{ mb: 0.5 }}>
                          {prediction.category}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 500 }}>
                            {(prediction.probability * 100).toFixed(0)}% probability
                          </Typography>
                        </Box>
                      </Box>
                      <Typography variant="body2" fontWeight="bold" color="text.secondary" sx={{ ml: 2 }}>
                        ~{formatCurrency(Math.abs(prediction.amount), { maximumFractionDigits: 0 })}
                      </Typography>
                    </Box>
                  ))}
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'center', fontStyle: 'italic' }}>
                    {t('forecast.basedOnPatterns') || 'Based on historical spending patterns'}
                  </Typography>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t('forecast.noPredictions') || 'No predictions for this date'}
                </Typography>
              )
            ) : (
              // Show actual transactions (existing logic)
              loadingTransactions ? (
                <CircularProgress size={20} />
              ) : dateTransactions.length > 0 ? (
                <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
                  {dateTransactions.map((txn, idx) => (
                    <Box
                      key={`${txn.identifier}-${txn.vendor}-${idx}`}
                      sx={(theme) => ({
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        py: 1.5,
                        px: 2,
                        borderBottom: idx < dateTransactions.length - 1 ? `1px solid ${theme.palette.divider}` : 'none',
                        transition: 'all 0.2s',
                        '&:hover': {
                          bgcolor: 'action.hover',
                          borderRadius: '12px',
                          transform: 'translateX(4px)',
                        },
                      })}
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
                  {t('noTransactionsForDate')}
                </Typography>
              )
            )}
          </Box>
        );
      })()}
    </Paper>
  );
};

export default TransactionHistorySection;
