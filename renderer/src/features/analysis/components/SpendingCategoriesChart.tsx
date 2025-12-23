import React, { useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Alert,
  Chip,
  LinearProgress,
  Grid,
  Tooltip,
} from '@mui/material';
import {
  TrendingUp as GrowthIcon,
  Security as StabilityIcon,
  Home as EssentialIcon,
  CardGiftcard as RewardIcon,
  MoreHoriz as OtherIcon,
} from '@mui/icons-material';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip as RechartsTooltip } from 'recharts';
import { useSpendingCategories } from '@renderer/features/budgets/hooks/useSpendingCategories';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { SpendingAllocation } from '@renderer/types/spending-categories';
import { useTranslation } from 'react-i18next';

interface SpendingCategoriesChartProps {
  months?: number;
}

const SPENDING_CATEGORY_COLORS: Record<SpendingAllocation | 'other', string> = {
  essential: '#2196F3', // Blue
  growth: '#4CAF50',    // Green
  stability: '#FF9800', // Orange
  reward: '#E91E63',    // Pink
  unallocated: '#9E9E9E', // Grey
  other: '#9E9E9E',     // Legacy grey
};

const SPENDING_CATEGORY_ICONS: Record<SpendingAllocation | 'other', React.ReactNode> = {
  essential: <EssentialIcon />,
  growth: <GrowthIcon />,
  stability: <StabilityIcon />,
  reward: <RewardIcon />,
  unallocated: <OtherIcon />,
  other: <OtherIcon />,
};

const SpendingCategoriesChart: React.FC<SpendingCategoriesChartProps> = ({ months = 3 }) => {
  const { breakdown, loading, error, fetchBreakdown } = useSpendingCategories({ autoLoad: false });
  const { formatCurrency } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.spendingChart' });

  useEffect(() => {
    fetchBreakdown(months);
  }, [months, fetchBreakdown]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  if (!breakdown || breakdown.breakdown.length === 0) {
    return (
      <Alert severity="info">
        <Typography variant="body1" fontWeight="bold">
          {t('empty.title')}
        </Typography>
        <Typography variant="body2">
          {t('empty.description')}
        </Typography>
      </Alert>
    );
  }

  interface ChartDataPoint {
    name: string;
    value: number;
    category: SpendingAllocation;
    percentage: number;
  }

  const chartData: ChartDataPoint[] = breakdown.breakdown
    .filter(item => item.spending_category !== 'unallocated')
    .map(item => ({
      name: t(`categories.${item.spending_category}`, { defaultValue: item.spending_category }),
      value: item.total_amount,
      category: item.spending_category,
      percentage: item.actual_percentage,
    }));

  return (
    <Box>
      <Typography variant="h6" fontWeight="bold" gutterBottom>
        {t('title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        {t('subtitle')}
      </Typography>

      <Grid container spacing={3} sx={{ mt: 1 }}>
        {/* Breakdown Details Full Width */}
        <Grid item xs={12}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                {t('targetVsActual')}
              </Typography>
              <Grid container spacing={2}>
                {breakdown.breakdown
                  .filter(item => item.spending_category !== 'unallocated')
                  .map((item) => {
                    const color = SPENDING_CATEGORY_COLORS[item.spending_category] || '#9E9E9E';
                    const label = t(`categories.${item.spending_category}`, { defaultValue: item.spending_category });
                    const isOver = item.status === 'over';
                    const isUnder = item.status === 'under';

                    return (
                      <Grid key={item.spending_category} item xs={12} md={6}>
                        <Box sx={{ mb: 1 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ color }}>{SPENDING_CATEGORY_ICONS[item.spending_category] || SPENDING_CATEGORY_ICONS.unallocated}</Box>
                              <Typography variant="body2" fontWeight="bold">
                                {label}
                              </Typography>
                            <Chip
                              label={`${item.actual_percentage.toFixed(0)}%`}
                              size="small"
                              sx={{ bgcolor: color + '20', color, fontWeight: 'bold' }}
                            />
                            </Box>
                            <Box sx={{ textAlign: 'right' }}>
                              <Typography variant="body2" fontWeight="bold">
                                {formatCurrency(item.total_amount, { absolute: true, maximumFractionDigits: 0 })}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {t('labels.target', { value: item.target_percentage.toFixed(0) })}
                              </Typography>
                            </Box>
                          </Box>

                          {/* Progress Bar */}
                          <Box sx={{ position: 'relative' }}>
                            <LinearProgress
                              variant="determinate"
                              value={Math.min(item.actual_percentage, 100)}
                              sx={{
                                height: 8,
                                borderRadius: 1,
                                bgcolor: color + '20',
                                '& .MuiLinearProgress-bar': {
                                  bgcolor: color,
                                },
                              }}
                            />
                            {/* Target marker */}
                            <Box
                              sx={{
                                position: 'absolute',
                                left: `${item.target_percentage}%`,
                                top: -2,
                                width: 2,
                                height: 12,
                                bgcolor: 'text.secondary',
                                borderRadius: 1,
                              }}
                            />
                          </Box>

                          {/* Status */}
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              {t('labels.transactions', { count: item.transaction_count })}
                            </Typography>
                            {(isOver || isUnder) && (
                              <Tooltip title={isOver ? t('tooltips.overTarget') : t('tooltips.underTarget')}>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: isOver ? 'error.main' : 'info.main',
                                    fontWeight: 'bold',
                                  }}
                                >
                                  {isOver ? '+' : ''}{item.variance.toFixed(0)}%
                                </Typography>
                              </Tooltip>
                            )}
                          </Box>
                        </Box>
                      </Grid>
                    );
                  })}
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Total Spending */}
      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" color="text.secondary">
              {t('labels.totalSpending', { count: months })}
            </Typography>
            <Typography variant="h5" fontWeight="bold">
              {formatCurrency(breakdown.total_spending, { absolute: true, maximumFractionDigits: 0 })}
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default SpendingCategoriesChart;
