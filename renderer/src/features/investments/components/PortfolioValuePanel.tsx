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
import { PortfolioSummary, PortfolioHistoryPoint } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';
import { HistoryTimeRangeOption } from '../InvestmentsFiltersContext';
import CustomTooltip, { TooltipDataItem } from './CustomTooltip';

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

interface PortfolioValuePanelProps {
  portfolioData: PortfolioSummary | null;
  overallHistory: PortfolioHistoryPoint[];
  historyTimeRange: HistoryTimeRangeOption;
  onTimeRangeChange: (range: HistoryTimeRangeOption) => void;
  viewMode: 'value' | 'performance';
  onViewModeChange: (mode: 'value' | 'performance') => void;
  loading: boolean;
}

const PortfolioValuePanel: React.FC<PortfolioValuePanelProps> = ({
  portfolioData,
  overallHistory,
  historyTimeRange,
  onTimeRangeChange,
  viewMode,
  onViewModeChange,
  loading,
}) => {
  const theme = useTheme();
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.portfolio' });

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  // Calculate change from history
  const firstPoint = overallHistory[0];
  const lastPoint = overallHistory.at(-1);
  const { valueChange, percentChange, isPositive } = calculatePortfolioChange(firstPoint, lastPoint);

  // Format chart data based on view mode
  const chartData = overallHistory.map(point => {
    const date = new Date(point.date);
    return {
      date: date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      fullDate: point.date,
      value: calculateChartValue(point, viewMode, firstPoint?.currentValue),
    };
  });

  const chartColor = isPositive ? theme.palette.success.main : theme.palette.error.main;

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
        <Typography variant="subtitle1" fontWeight={600}>
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
              '& .MuiToggleButton-root': {
                px: 2,
                py: 0.5,
                textTransform: 'none',
                fontSize: '0.75rem',
                borderRadius: 2,
                border: 'none',
                bgcolor: alpha(theme.palette.action.selected, 0.1),
                '&.Mui-selected': {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  '&:hover': {
                    bgcolor: 'primary.dark',
                  },
                },
              },
            }}
          >
            <ToggleButton value="value">{t('modes.value', 'Value')}</ToggleButton>
            <ToggleButton value="performance">{t('modes.performance', 'Performance')}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* Date label */}
      <Typography variant="caption" color="text.secondary">
        {firstPoint && lastPoint ? (
          `${new Date(firstPoint.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} - ${new Date(lastPoint.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
        ) : (
          t('noData', 'No data')
        )}
      </Typography>

      {/* Main Value */}
      <Typography
        variant="h3"
        fontWeight={700}
        sx={{ mt: 0.5, mb: 0.5, lineHeight: 1.2 }}
      >
        {maskAmounts ? '***' : formatCurrencyValue(portfolioData?.summary.totalPortfolioValue || 0)}
      </Typography>

      {/* Change indicators */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography
          variant="body2"
          fontWeight={600}
          sx={{
            color: isPositive ? 'success.main' : 'error.main',
          }}
        >
          {isPositive ? '+' : ''}{maskAmounts ? '***' : formatCurrencyValue(valueChange)}
        </Typography>
        <Typography
          variant="caption"
          fontWeight={600}
          sx={{
            color: isPositive ? 'success.main' : 'error.main',
            bgcolor: alpha(isPositive ? theme.palette.success.main : theme.palette.error.main, 0.1),
            px: 1,
            py: 0.25,
            borderRadius: 1,
          }}
        >
          {isPositive ? '+' : ''}{percentChange.toFixed(1)}%
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
                      label: t('tooltipPerformance', 'Performance'),
                      value: value,
                      type: 'percentage',
                      color: chartColor,
                    });
                  }

                  return (
                    <CustomTooltip
                      active={active}
                      items={items}
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
            <Typography color="text.secondary">
              {t('noChartData', 'No history data available')}
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default PortfolioValuePanel;
