import React, { useEffect, useState } from 'react';
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
  ToggleButton,
  ToggleButtonGroup,
  alpha,
  useTheme,
} from '@mui/material';
import {
  TrendingUp as GrowthIcon,
  Security as StabilityIcon,
  Home as EssentialIcon,
  CardGiftcard as RewardIcon,
  MoreHoriz as OtherIcon,
} from '@mui/icons-material';
import { useSpendingCategories } from '@renderer/features/budgets/hooks/useSpendingCategories';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { SpendingAllocation, SpendingCategoryBreakdownItem } from '@renderer/types/spending-categories';
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
  const theme = useTheme();
  const { breakdown, loading, error, fetchBreakdown } = useSpendingCategories({ autoLoad: false });
  const { formatCurrency } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.spendingChart' });

  useEffect(() => {
    fetchBreakdown(months);
  }, [months, fetchBreakdown]);

  const [viewMode, setViewMode] = useState<'current' | 'incomeIndexed'>('current');

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

  const totalIncome = breakdown.total_income;
  const hasIncome = totalIncome > 0;

  const processedItems = breakdown.breakdown
    .filter(item => item.spending_category !== 'unallocated')
    .map((item) => {
      const label = t(`categories.${item.spending_category}`, { defaultValue: item.spending_category });
      const incomePercentage = hasIncome ? (item.total_amount / totalIncome) * 100 : 0;
      const recommendedAmount = hasIncome ? (totalIncome * item.target_percentage) / 100 : 0;
      const percentage = viewMode === 'incomeIndexed' ? incomePercentage : item.actual_percentage;
      const displayAmount = viewMode === 'incomeIndexed' ? recommendedAmount : item.total_amount;
      const variance = percentage - item.target_percentage;
      const status: SpendingCategoryBreakdownItem['status'] = variance > 5 ? 'over' : variance < -5 ? 'under' : 'on_track';

      return {
        ...item,
        label,
        incomePercentage,
        recommendedAmount,
        displayAmount,
        percentage,
        variance,
        status,
      };
    });

  const handleViewModeChange = (_: React.MouseEvent<HTMLElement>, newValue: 'current' | 'incomeIndexed' | null) => {
    if (newValue) {
      setViewMode(newValue);
    }
  };

  return (
    <Box>
      <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ 
        background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}>
        {t('title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        {t('subtitle')}
      </Typography>

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          mb: 2,
          mt: 2,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {viewMode === 'incomeIndexed'
            ? (hasIncome
              ? t('viewToggle.incomeHint', {
                amount: formatCurrency(totalIncome, { absolute: true, maximumFractionDigits: 0 }),
              })
              : t('viewToggle.noIncome'))
            : t('viewToggle.currentHint')}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={viewMode}
          onChange={handleViewModeChange}
          sx={{
            bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
            backdropFilter: 'blur(10px)',
            borderRadius: 2,
            p: 0.5,
            border: '1px solid',
            borderColor: (theme) => alpha(theme.palette.divider, 0.1),
            '& .MuiToggleButton-root': {
              border: 'none',
              borderRadius: 1.5,
              px: 2,
              py: 0.5,
              color: 'text.secondary',
              '&.Mui-selected': {
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                color: 'primary.main',
                fontWeight: 600,
              },
              '&:hover': {
                bgcolor: (theme) => alpha(theme.palette.action.hover, 0.1),
              }
            }
          }}
        >
          <ToggleButton value="current">{t('viewToggle.current')}</ToggleButton>
          <ToggleButton value="incomeIndexed">{t('viewToggle.incomeIndexed')}</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Grid container spacing={3} sx={{ mt: 1 }}>
        {/* Breakdown Details Full Width */}
        <Grid item xs={12}>
          <Card elevation={0} sx={{
            borderRadius: 4,
            bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
            backdropFilter: 'blur(20px)',
            border: '1px solid',
            borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
            boxShadow: (theme) => `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.05)}`,
          }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 700, opacity: 0.8 }}>
                {t('targetVsActual')}
              </Typography>
              <Grid container spacing={2}>
                {processedItems.map((item) => {
                  const color = SPENDING_CATEGORY_COLORS[item.spending_category] || '#9E9E9E';
                  const isOver = item.status === 'over';
                  const isUnder = item.status === 'under';

                  return (
                    <Grid key={item.spending_category} item xs={12} md={6}>
                      <Box sx={{ 
                        p: 2, 
                        borderRadius: 3,
                        bgcolor: (theme) => alpha(theme.palette.background.paper, 0.3),
                        border: '1px solid',
                        borderColor: (theme) => alpha(theme.palette.divider, 0.1),
                        transition: 'all 0.2s',
                        '&:hover': {
                          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.6),
                          transform: 'translateY(-2px)',
                          boxShadow: (theme) => `0 4px 12px 0 ${alpha(color, 0.1)}`
                        }
                      }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Box sx={{ 
                              color: color,
                              p: 1,
                              borderRadius: 2,
                              bgcolor: alpha(color, 0.1),
                              display: 'flex'
                            }}>
                              {SPENDING_CATEGORY_ICONS[item.spending_category] || SPENDING_CATEGORY_ICONS.unallocated}
                            </Box>
                            <Box>
                              <Typography variant="body2" fontWeight="bold">
                                {item.label}
                              </Typography>
                              <Chip
                                label={`${item.percentage.toFixed(0)}%${viewMode === 'incomeIndexed' ? ` ${t('labels.ofIncome')}` : ''}`}
                                size="small"
                                sx={{ 
                                  height: 20, 
                                  fontSize: '0.7rem',
                                  bgcolor: alpha(color, 0.1), 
                                  color: color, 
                                  fontWeight: 'bold',
                                  mt: 0.5
                                }}
                              />
                            </Box>
                          </Box>
                          <Box sx={{ textAlign: 'right' }}>
                            <Typography variant="body1" fontWeight="800" sx={{ color: theme.palette.text.primary }}>
                              {formatCurrency(item.displayAmount, { absolute: true, maximumFractionDigits: 0 })}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {viewMode === 'incomeIndexed'
                                ? t('labels.incomeTarget', { value: item.target_percentage.toFixed(0) })
                                : t('labels.target', { value: item.target_percentage.toFixed(0) })}
                            </Typography>
                            {viewMode === 'incomeIndexed' && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {t('labels.currentSpend', {
                                  amount: formatCurrency(item.total_amount, { absolute: true, maximumFractionDigits: 0 }),
                                })}
                              </Typography>
                            )}
                          </Box>
                        </Box>

                        {/* Progress Bar */}
                        <Box sx={{ position: 'relative', mt: 1 }}>
                          <LinearProgress
                            variant="determinate"
                            value={Math.min(item.percentage, 100)}
                            sx={{
                              height: 8,
                              borderRadius: 4,
                              bgcolor: alpha(color, 0.1),
                              '& .MuiLinearProgress-bar': {
                                bgcolor: color,
                                borderRadius: 4,
                              },
                            }}
                          />
                          {/* Target marker */}
                          <Box
                            sx={{
                              position: 'absolute',
                              left: `${Math.min(item.target_percentage, 100)}%`,
                              top: -3,
                              width: 2,
                              height: 14,
                              bgcolor: 'text.primary',
                              borderRadius: 1,
                              boxShadow: '0 0 4px rgba(0,0,0,0.5)',
                              zIndex: 1
                            }}
                          />
                        </Box>

                        {/* Status */}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
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
                                  bgcolor: isOver ? alpha(theme.palette.error.main, 0.1) : alpha(theme.palette.info.main, 0.1),
                                  px: 0.8,
                                  py: 0.2,
                                  borderRadius: 1
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
      <Card elevation={0} sx={{ 
        mt: 2,
        borderRadius: 4,
        bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
        backdropFilter: 'blur(20px)',
        border: '1px solid',
        borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
      }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" color="text.secondary">
              {t('labels.totalSpending', { count: months })}
            </Typography>
            <Typography variant="h5" fontWeight="bold" sx={{
              background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              {formatCurrency(breakdown.total_spending, { absolute: true, maximumFractionDigits: 0 })}
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default SpendingCategoriesChart;
