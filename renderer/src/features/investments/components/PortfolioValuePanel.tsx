import React from 'react';
import {
  Box,
  Typography,
  useTheme,
  alpha,
  ToggleButtonGroup,
  ToggleButton,
  Skeleton,
  Paper,
} from '@mui/material';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import {
  InvestmentPerformanceResponse,
  PortfolioSummary,
  PortfolioHistoryPoint,
} from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';
import CustomTooltip, { TooltipDataItem } from './CustomTooltip';
import { getCurrencyDisplaySymbol } from '../utils/currency-format';

// Helper to calculate portfolio change values
function calculatePortfolioChange(
  firstPoint: PortfolioHistoryPoint | undefined,
  lastPoint: PortfolioHistoryPoint | undefined
) {
  const valueChange = lastPoint && firstPoint
    ? lastPoint.currentValue - firstPoint.currentValue
    : 0;
  const percentChange = firstPoint && firstPoint.currentValue > 0
    ? ((lastPoint?.currentValue || 0) - firstPoint.currentValue) / firstPoint.currentValue * 100
    : 0;
  return { valueChange, percentChange, isPositive: valueChange >= 0 };
}

// Helper to calculate chart value based on view mode
function calculateChartValue(
  point: PortfolioHistoryPoint,
  viewMode: 'value' | 'performance',
  firstPointValue: number | undefined
): number {
  if (viewMode === 'value') {
    return point.currentValue;
  }
  return firstPointValue && firstPointValue > 0
    ? ((point.currentValue - firstPointValue) / firstPointValue) * 100
    : 0;
}

function getSignedExternalFlow(point: InvestmentPerformanceResponse['timeline'][number]): number {
  return Number(point.contributions || 0)
    - Number(point.withdrawals || 0)
    - Number(point.capitalReturns || 0)
    - Number(point.income || 0)
    - Number(point.fees || 0)
    - Number(point.taxes || 0);
}

export function calculateModifiedDietzSeries(
  timeline: InvestmentPerformanceResponse['timeline'],
): Array<number | null> {
  if (timeline.length === 0) return [];
  const startValue = Number(timeline[0]?.currentValue);
  const startTime = new Date(`${timeline[0]?.date.slice(0, 10)}T00:00:00.000Z`).getTime();

  return timeline.map((point, endIndex) => {
    if (endIndex === 0) return 0;
    const endValue = Number(point.currentValue);
    const endTime = new Date(`${point.date.slice(0, 10)}T00:00:00.000Z`).getTime();
    const duration = endTime - startTime;
    if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || duration <= 0) return null;

    let totalFlow = 0;
    let weightedFlow = 0;
    timeline.slice(0, endIndex + 1).forEach((flowPoint) => {
      const flow = getSignedExternalFlow(flowPoint);
      if (flow === 0) return;
      const flowTime = new Date(`${flowPoint.date.slice(0, 10)}T00:00:00.000Z`).getTime();
      const weight = Math.max(0, Math.min(1, (endTime - flowTime) / duration));
      totalFlow += flow;
      weightedFlow += weight * flow;
    });

    const denominator = startValue + weightedFlow;
    if (!Number.isFinite(denominator) || denominator <= 0) return null;
    const result = (endValue - startValue - totalFlow) / denominator;
    return Number.isFinite(result) ? result * 100 : null;
  });
}

interface PortfolioValuePanelProps {
  portfolioData: PortfolioSummary | null;
  overallHistory: PortfolioHistoryPoint[];
  performanceData?: InvestmentPerformanceResponse | null;
  displayValue?: number | null;
  viewMode: 'value' | 'performance';
  onViewModeChange: (mode: 'value' | 'performance') => void;
  loading: boolean;
}

const PortfolioValuePanel: React.FC<PortfolioValuePanelProps> = ({
  portfolioData,
  overallHistory,
  performanceData,
  displayValue,
  viewMode,
  onViewModeChange,
  loading,
}) => {
  const theme = useTheme();
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.portfolio' });

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, {
      absolute: true,
      maximumFractionDigits: 0,
      currencySymbol: getCurrencyDisplaySymbol(portfolioData?.fx?.baseCurrency),
    });

  // Calculate change from history
  const firstPoint = overallHistory[0];
  const lastPoint = overallHistory.at(-1);
  const { valueChange, percentChange } = calculatePortfolioChange(firstPoint, lastPoint);

  const valueChartData = overallHistory.map(point => {
    const date = new Date(point.date);
    return {
      date: date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      fullDate: point.date,
      value: calculateChartValue(point, 'value', firstPoint?.currentValue),
    };
  });

  const performanceAvailable = performanceData?.twr !== null && performanceData?.twr !== undefined;
  let linkedReturn = 1;
  const modifiedDietzSeries = performanceData?.method === 'modified_dietz'
    ? calculateModifiedDietzSeries(performanceData.timeline || [])
    : [];
  const performanceChartData = (performanceAvailable ? performanceData?.timeline || [] : [])
    .map((point, index, timeline) => {
    if (performanceData?.method !== 'modified_dietz' && index > 0) {
      const previousValue = Number(timeline[index - 1]?.currentValue) || 0;
      if (previousValue > 0) {
        const externalFlow = getSignedExternalFlow(point);
        const periodReturn = (Number(point.valueChange || 0) - externalFlow) / previousValue;
        linkedReturn *= 1 + periodReturn;
      }
    }
    return {
      date: new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      fullDate: point.date,
      value: performanceData?.method === 'modified_dietz'
        ? modifiedDietzSeries[index]
        : (linkedReturn - 1) * 100,
    };
    });
  const chartData = viewMode === 'value' ? valueChartData : performanceChartData;

  const displayedChange = viewMode === 'performance'
    ? (performanceAvailable ? performanceData?.marketMove : null)
    : valueChange;
  const displayedPercent = viewMode === 'performance' && performanceAvailable
    ? Number(performanceData?.twr) * 100
    : percentChange;
  const displayedPositive = Number(displayedChange || 0) >= 0 && displayedPercent >= 0;

  const chartColor = displayedPositive ? theme.palette.success.main : theme.palette.error.main;
  const headlineValue = displayValue !== undefined
    ? displayValue
    : portfolioData?.summary.totalPortfolioValue ?? null;

  if (loading) {
    return (
      <Paper
        elevation={0}
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          p: 2.5,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
          <Skeleton variant="text" width={150} height={28} />
          <Skeleton variant="rectangular" width={200} height={32} sx={{ borderRadius: 1 }} />
        </Box>
        <Skeleton variant="text" width={100} height={20} />
        <Skeleton variant="text" width={200} height={56} />
        <Skeleton variant="text" width={120} height={24} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" sx={{ flexGrow: 1, borderRadius: 2 }} />
      </Paper>
    );
  }

  return (
    <Paper
      elevation={0}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        p: 2.5,
      }}
    >
      {/* Header with filters */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
          mb: 2,
        }}
      >
        <Typography variant="subtitle1" sx={{
          fontWeight: 600
        }}>
          {t('title', 'Portfolio Value')}
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {/* View Mode Toggle */}
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, value) => value && onViewModeChange(value)}
            size="small"
            sx={{
              bgcolor: alpha(theme.palette.background.default, 0.8),
              borderRadius: 2,
              p: 0.5,
              '& .MuiToggleButton-root': {
                px: 2,
                py: 0.75,
                textTransform: 'none',
                fontWeight: 500,
                fontSize: '0.8125rem',
                borderRadius: 1.5,
                border: 'none',
                color: 'text.secondary',
                '&.Mui-selected': {
                  bgcolor: 'background.paper',
                  color: 'text.primary',
                  boxShadow: `0 1px 3px ${alpha(theme.palette.common.black, 0.1)}`,
                  '&:hover': {
                    bgcolor: 'background.paper',
                  },
                },
                '&:hover': {
                  bgcolor: alpha(theme.palette.action.hover, 0.4),
                },
              },
            }}
          >
            <ToggleButton value="value">{t('modes.value', 'Value')}</ToggleButton>
            <ToggleButton value="performance">{t('modes.performance', 'Investment return')}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>
      {/* Date label */}
      <Typography variant="caption" sx={{
        color: "text.secondary"
      }}>
        {firstPoint && lastPoint ? (
          `${new Date(firstPoint.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} - ${new Date(lastPoint.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
        ) : (
          t('noData', 'No data')
        )}
      </Typography>
      {/* Main Value */}
      <Typography
        variant="h3"
        sx={{
          fontWeight: 700,
          mt: 0.5,
          mb: 0.5,
          lineHeight: 1.2
        }}>
        {headlineValue === null
          ? t('noData', 'No data')
          : maskAmounts ? '***' : formatCurrencyValue(headlineValue)}
      </Typography>
      {/* Change indicators */}
      <Typography variant="caption" color="text.secondary">
        {viewMode === 'performance'
          ? performanceData?.method === 'modified_dietz'
            ? t('estimatedReturnAfterFlows', 'Estimated investment return after separating tracked cash flows')
            : t('returnAfterFlows', 'Investment return after separating tracked cash flows')
          : t('balanceChange', 'Balance change, including deposits and withdrawals')}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: displayedPositive ? 'success.main' : 'error.main'
          }}>
          {displayedChange === null || displayedChange === undefined
            ? t('noData', 'No data')
            : `${displayedPositive ? '+' : ''}${maskAmounts ? '***' : formatCurrencyValue(displayedChange)}`}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            color: displayedPositive ? 'success.main' : 'error.main',
            bgcolor: alpha(displayedPositive ? theme.palette.success.main : theme.palette.error.main, 0.1),
            px: 1,
            py: 0.25,
            borderRadius: 1
          }}>
          {viewMode === 'performance' && !performanceAvailable
            ? t('noData', 'No data')
            : `${displayedPositive ? '+' : ''}${displayedPercent.toFixed(1)}%`}
        </Typography>
      </Box>
      {/* Chart */}
      <Box sx={{ flexGrow: 1, minHeight: 200, height: '100%' }}>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: theme.palette.text.secondary }}
                interval="preserveStartEnd"
              />
              <YAxis
                hide
                domain={['dataMin', 'dataMax']}
              />
              <RechartsTooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;

                  const dataPoint = payload[0];
                  const value = dataPoint.value as number;

                  // Find the original data point to get full date
                  const originalPoint = chartData.find(d => d.date === label);
                  const fullDate = originalPoint?.fullDate;

                  const items: TooltipDataItem[] = [];

                  if (viewMode === 'value') {
                    items.push({
                      label: t('tooltipValue', 'Portfolio Value'),
                      value: value,
                      type: 'currency',
                      color: chartColor,
                    });

                    // Calculate change from start
                    if (firstPoint && firstPoint.currentValue > 0) {
                      const change = value - firstPoint.currentValue;
                      const changePercent = (change / firstPoint.currentValue) * 100;

                      items.push({
                        label: t('tooltipChange', 'Change from Start'),
                        value: change,
                        type: 'currency',
                      });

                      items.push({
                        label: t('tooltipChangePercent', 'Change %'),
                        value: changePercent,
                        type: 'percentage',
                      });
                    }
                  } else {
                    items.push({
                      label: t('tooltipPerformance', 'Value Change'),
                      value: value,
                      type: 'percentage',
                      color: chartColor,
                    });
                  }

                  return (
                    <CustomTooltip
                      active={active}
                      items={items}
                      currencySymbol={getCurrencyDisplaySymbol(portfolioData?.fx?.baseCurrency)}
                      title={fullDate ? new Date(fullDate).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      }) : String(label)}
                    />
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={chartColor}
                strokeWidth={2}
                fill="url(#colorValue)"
                activeDot={{
                  r: 5,
                  fill: chartColor,
                  stroke: theme.palette.background.paper,
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography sx={{
              color: "text.secondary"
            }}>
              {t('noChartData', 'No history data available')}
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default PortfolioValuePanel;
