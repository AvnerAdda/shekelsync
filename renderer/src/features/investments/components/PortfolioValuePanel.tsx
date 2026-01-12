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

interface PortfolioValuePanelProps {
  portfolioData: PortfolioSummary | null;
  overallHistory: PortfolioHistoryPoint[];
  historyTimeRange: HistoryTimeRangeOption;
  onTimeRangeChange: (range: HistoryTimeRangeOption) => void;
  viewMode: 'value' | 'performance';
  onViewModeChange: (mode: 'value' | 'performance') => void;
  loading: boolean;
}

const TIME_RANGES: { value: HistoryTimeRangeOption; label: string }[] = [
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'ALL' },
];

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
  const lastPoint = overallHistory[overallHistory.length - 1];
  const valueChange = lastPoint && firstPoint
    ? lastPoint.currentValue - firstPoint.currentValue
    : 0;
  const percentChange = firstPoint && firstPoint.currentValue > 0
    ? ((lastPoint?.currentValue || 0) - firstPoint.currentValue) / firstPoint.currentValue * 100
    : 0;
  const isPositive = valueChange >= 0;

  // Format chart data based on view mode
  const chartData = overallHistory.map(point => {
    const date = new Date(point.date);
    return {
      date: date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      fullDate: point.date,
      value: viewMode === 'value'
        ? point.currentValue
        : firstPoint && firstPoint.currentValue > 0
          ? ((point.currentValue - firstPoint.currentValue) / firstPoint.currentValue) * 100
          : 0,
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
      <Box sx={{ flexGrow: 1, minHeight: 200 }}>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
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
                formatter={(value: number) => [
                  viewMode === 'value'
                    ? formatCurrencyValue(value)
                    : `${value.toFixed(2)}%`,
                  viewMode === 'value' ? t('tooltipValue', 'Value') : t('tooltipPerformance', 'Change'),
                ]}
                labelStyle={{ color: theme.palette.text.primary }}
                contentStyle={{
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: theme.shape.borderRadius,
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={chartColor}
                strokeWidth={2}
                fill="url(#colorValue)"
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

      {/* Time Range Selector */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 2, gap: 0.5 }}>
        {TIME_RANGES.map(range => (
          <Box
            key={range.value}
            onClick={() => onTimeRangeChange(range.value)}
            sx={{
              px: 1.5,
              py: 0.5,
              borderRadius: 1,
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: historyTimeRange === range.value ? 600 : 400,
              color: historyTimeRange === range.value ? 'primary.main' : 'text.secondary',
              bgcolor: historyTimeRange === range.value
                ? alpha(theme.palette.primary.main, 0.1)
                : 'transparent',
              '&:hover': {
                bgcolor: alpha(theme.palette.primary.main, 0.05),
              },
            }}
          >
            {range.label}
          </Box>
        ))}
      </Box>
    </Paper>
  );
};

export default PortfolioValuePanel;
