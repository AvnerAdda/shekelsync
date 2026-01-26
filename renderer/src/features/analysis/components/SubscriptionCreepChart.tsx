import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  Skeleton,
  Chip,
  alpha,
  useTheme,
} from '@mui/material';
import {
  TrendingUp as UpIcon,
  TrendingDown as DownIcon,
  TrendingFlat as FlatIcon,
} from '@mui/icons-material';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useTranslation } from 'react-i18next';
import type { SubscriptionCreep } from '@renderer/types/subscriptions';

interface SubscriptionCreepChartProps {
  creep: SubscriptionCreep | null;
  loading: boolean;
}

const SubscriptionCreepChart: React.FC<SubscriptionCreepChartProps> = ({
  creep,
  loading,
}) => {
  const theme = useTheme();
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.subscriptions' });

  const formatMonth = (month: string) => {
    const [year, monthNum] = month.split('-');
    const date = new Date(parseInt(year, 10), parseInt(monthNum, 10) - 1);
    return date.toLocaleDateString(i18n.language, { month: 'short', year: '2-digit' });
  };

  const getTrendIcon = () => {
    if (!creep) return <FlatIcon />;
    if (creep.total_creep_percentage > 5) return <UpIcon />;
    if (creep.total_creep_percentage < -5) return <DownIcon />;
    return <FlatIcon />;
  };

  const getTrendColor = () => {
    if (!creep) return theme.palette.grey[500];
    if (creep.total_creep_percentage > 5) return theme.palette.error.main;
    if (creep.total_creep_percentage < -5) return theme.palette.success.main;
    return theme.palette.info.main;
  };

  if (loading && !creep) {
    return (
      <Card
        elevation={0}
        sx={{
          borderRadius: 3,
          bgcolor: alpha(theme.palette.background.paper, 0.4),
        }}
      >
        <CardContent>
          <Skeleton variant="text" width={200} height={28} sx={{ mb: 2 }} />
          <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2 }} />
        </CardContent>
      </Card>
    );
  }

  if (!creep || creep.data.length === 0) {
    return null;
  }

  const chartData = creep.data.map((d) => ({
    ...d,
    monthLabel: formatMonth(d.month),
  }));

  const trendColor = getTrendColor();
  const averageTotal = chartData.reduce((sum, d) => sum + d.total, 0) / chartData.length;

  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 3,
        bgcolor: alpha(theme.palette.background.paper, 0.4),
        backdropFilter: 'blur(12px)',
        border: '1px solid',
        borderColor: alpha(theme.palette.divider, 0.1),
      }}
    >
      <CardContent>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
          <Box>
            <Typography variant="subtitle1" fontWeight="bold">
              {t('creep.title')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('creep.subtitle', { months: creep.months_analyzed })}
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} alignItems="center">
            <Box sx={{ color: trendColor }}>
              {getTrendIcon()}
            </Box>
            <Chip
              label={`${creep.total_creep_percentage > 0 ? '+' : ''}${creep.total_creep_percentage.toFixed(1)}%`}
              size="small"
              sx={{
                bgcolor: alpha(trendColor, 0.1),
                color: trendColor,
                fontWeight: 700,
              }}
            />
          </Stack>
        </Stack>

        {/* Stats */}
        <Stack direction="row" spacing={4} mb={3}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('creep.startingTotal')}
            </Typography>
            <Typography variant="h6" fontWeight="bold">
              {formatCurrency(creep.starting_total, { maximumFractionDigits: 0 })}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('creep.currentTotal')}
            </Typography>
            <Typography variant="h6" fontWeight="bold" color={trendColor}>
              {formatCurrency(creep.current_total, { maximumFractionDigits: 0 })}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('creep.change')}
            </Typography>
            <Typography variant="h6" fontWeight="bold" color={trendColor}>
              {creep.current_total - creep.starting_total >= 0 ? '+' : ''}
              {formatCurrency(creep.current_total - creep.starting_total, { maximumFractionDigits: 0 })}
            </Typography>
          </Box>
        </Stack>

        {/* Chart */}
        <Box sx={{ height: 200, minHeight: 200, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={trendColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={trendColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="monthLabel"
                stroke={theme.palette.text.secondary}
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke={theme.palette.text.secondary}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) =>
                  maskAmounts ? '***' : `₪${((value ?? 0) / 1000).toFixed(0)}k`
                }
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 8,
                  boxShadow: theme.shadows[4],
                }}
                formatter={(value: number | undefined) => [
                  formatCurrency(value ?? 0, { maximumFractionDigits: 0 }),
                  t('creep.tooltipTotal'),
                ]}
                labelFormatter={(label) => label}
              />
              <ReferenceLine
                y={averageTotal}
                stroke={theme.palette.grey[400]}
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke={trendColor}
                strokeWidth={2}
                fill="url(#colorTotal)"
                dot={false}
                activeDot={{
                  r: 4,
                  fill: trendColor,
                  stroke: theme.palette.background.paper,
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>

        {/* Legend */}
        <Stack direction="row" justifyContent="center" spacing={3} mt={2}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Box
              sx={{
                width: 12,
                height: 3,
                bgcolor: trendColor,
                borderRadius: 1,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {t('creep.legendMonthly')}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Box
              sx={{
                width: 12,
                height: 0,
                borderTop: `2px dashed ${theme.palette.grey[400]}`,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {t('creep.legendAverage')}
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default SubscriptionCreepChart;
