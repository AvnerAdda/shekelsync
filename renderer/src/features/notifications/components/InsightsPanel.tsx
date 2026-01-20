import React, { useState } from 'react';
import {
  Box,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Card,
  CardContent,
  LinearProgress,
  Chip,
  Stack,
  Fade,
  Grow,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  TrendingFlat as TrendingFlatIcon,
  CalendarToday as CalendarIcon,
  MonetizationOn as MoneyIcon,
  Category as CategoryIcon,
  Insights as InsightsIcon,
} from '@mui/icons-material';

interface InsightsPanelProps {
  insights: any;
  onClose?: () => void;
}

type Period = 'daily' | 'weekly' | 'monthly' | 'lifetime';

const InsightsPanel: React.FC<InsightsPanelProps> = ({ insights, onClose }) => {
  const [period, setPeriod] = useState<Period>('daily');

  // Compact card styling
  const compactCardSx = { bgcolor: 'background.paper' };
  const compactCardContentSx = { p: 1.5, '&:last-child': { pb: 1.5 } };
  const compactIconSx = { mr: 0.5, fontSize: 16 };
  const compactSpacing = 1.5;

  const handleNavigate = (path: string) => {
    // Close the popover
    if (onClose) {
      onClose();
    }
    // Dispatch navigation event
    window.dispatchEvent(new CustomEvent('navigateTo', { detail: { path } }));
  };

  const handlePeriodChange = (_event: React.MouseEvent<HTMLElement>, newPeriod: Period | null) => {
    if (newPeriod !== null) {
      setPeriod(newPeriod);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const renderDailyInsights = () => {
    const daily = insights?.daily;
    if (!daily) return null;

    const { spentToday, avgDailySpend, percentOfAverage, transactionCount, topCategory, velocityStatus } = daily;

    return (
      <Stack spacing={1.5}>
        {/* Spending Velocity Card */}
        <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
              <MoneyIcon sx={{ mr: 0.5, color: 'primary.main', fontSize: 16 }} />
              <Typography variant="caption" fontWeight="bold">
                Today's Spending
              </Typography>
            </Box>
            <Typography variant="h6" gutterBottom sx={{ mb: 0.5 }}>
              {formatCurrency(spentToday)}
            </Typography>
            <Box sx={{ mb: 0.5 }}>
              <LinearProgress
                variant="determinate"
                value={Math.min(percentOfAverage, 100)}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  bgcolor: 'grey.200',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: velocityStatus === 'high' ? 'error.main' :
                             velocityStatus === 'low' ? 'success.main' : 'primary.main',
                  }
                }}
              />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                {percentOfAverage}% of avg ({formatCurrency(avgDailySpend)})
              </Typography>
              <Chip
                size="small"
                label={velocityStatus === 'high' ? 'High' : velocityStatus === 'low' ? 'Low' : 'Normal'}
                color={velocityStatus === 'high' ? 'error' : velocityStatus === 'low' ? 'success' : 'default'}
                variant="outlined"
                sx={{ height: 20, fontSize: '0.65rem' }}
              />
            </Box>
          </CardContent>
        </Card>

        {/* Transaction Count */}
        <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
              <CalendarIcon sx={{ mr: 0.5, color: 'info.main', fontSize: 16 }} />
              <Typography variant="caption" fontWeight="bold">
                Activity
              </Typography>
            </Box>
            <Typography variant="h6" sx={{ mb: 0 }}>
              {transactionCount} {transactionCount === 1 ? 'transaction' : 'transactions'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
              today
            </Typography>
          </CardContent>
        </Card>

        {/* Top Category */}
        {topCategory && (
          <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                <CategoryIcon sx={{ mr: 0.5, color: 'secondary.main', fontSize: 16 }} />
                <Typography variant="caption" fontWeight="bold">
                  Top Category
                </Typography>
              </Box>
              <Typography variant="body2" gutterBottom sx={{ mb: 0.5 }}>
                {topCategory.name}
              </Typography>
              <Typography variant="h6" color="primary">
                {formatCurrency(topCategory.amount)}
              </Typography>
            </CardContent>
          </Card>
        )}
      </Stack>
    );
  };

  const renderWeeklyInsights = () => {
    const weekly = insights?.weekly;
    if (!weekly) return null;

    const { spentThisWeek, spentLastWeek, weekOverWeekChange, topCategories, weekendSpend, weekdaySpend } = weekly;
    const isIncrease = weekOverWeekChange > 0;

    return (
      <Stack spacing={compactSpacing}>
        {/* Week Comparison */}
        <Card variant="outlined" sx={compactCardSx}>
          <CardContent sx={compactCardContentSx}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
              <MoneyIcon sx={{ ...compactIconSx, color: 'primary.main' }} />
              <Typography variant="caption" fontWeight="bold">
                This Week
              </Typography>
            </Box>
            <Typography variant="h6" gutterBottom sx={{ mb: 0.5 }}>
              {formatCurrency(spentThisWeek)}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {isIncrease ? (
                <TrendingUpIcon color="error" fontSize="small" />
              ) : weekOverWeekChange < 0 ? (
                <TrendingDownIcon color="success" fontSize="small" />
              ) : (
                <TrendingFlatIcon color="disabled" fontSize="small" />
              )}
              <Typography
                variant="body2"
                color={isIncrease ? 'error.main' : weekOverWeekChange < 0 ? 'success.main' : 'text.secondary'}
              >
                {isIncrease ? '+' : ''}{weekOverWeekChange}% vs last week ({formatCurrency(spentLastWeek)})
              </Typography>
            </Box>
          </CardContent>
        </Card>

        {/* Top Categories */}
        {topCategories && topCategories.length > 0 && (
          <Card variant="outlined" sx={compactCardSx}>
            <CardContent sx={compactCardContentSx}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                <CategoryIcon sx={{ ...compactIconSx, color: 'secondary.main' }} />
                <Typography variant="caption" fontWeight="bold">
                  Top Categories
                </Typography>
              </Box>
              <Stack spacing={0.5}>
                {topCategories.slice(0, 3).map((cat: any, idx: number) => (
                  <Box key={idx} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2">{cat.name}</Typography>
                      {cat.change !== undefined && cat.change !== 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {cat.change > 0 ? (
                            <TrendingUpIcon sx={{ fontSize: 12, color: 'error.main' }} />
                          ) : (
                            <TrendingDownIcon sx={{ fontSize: 12, color: 'success.main' }} />
                          )}
                          <Typography
                            variant="caption"
                            color={cat.change > 0 ? 'error.main' : 'success.main'}
                          >
                            {cat.change > 0 ? '+' : ''}{cat.change}%
                          </Typography>
                        </Box>
                      )}
                    </Box>
                    <Typography variant="body2" fontWeight="medium">
                      {formatCurrency(cat.amount)}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Weekend vs Weekday */}
        <Card variant="outlined" sx={compactCardSx}>
          <CardContent sx={compactCardContentSx}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
              <CalendarIcon sx={{ ...compactIconSx, color: 'info.main' }} />
              <Typography variant="caption" fontWeight="bold">
                Spending Pattern
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Weekdays
                </Typography>
                <Typography variant="body1" fontWeight="medium">
                  {formatCurrency(weekdaySpend)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Weekend
                </Typography>
                <Typography variant="body1" fontWeight="medium">
                  {formatCurrency(weekendSpend)}
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Stack>
    );
  };

  const renderMonthlyInsights = () => {
    const monthly = insights?.monthly;
    if (!monthly) return null;

    const {
      daysElapsed,
      daysRemaining,
      spentThisMonth,
      projectedMonthEnd,
      lastMonthTotal,
      savingsRate,
      budgetsOnTrack,
      budgetsAtRisk
    } = monthly;

    const monthProgress = (daysElapsed / (daysElapsed + daysRemaining)) * 100;

    return (
      <Stack spacing={compactSpacing}>
        {/* Month Progress */}
        <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <CalendarIcon sx={{ mr: 1, color: 'primary.main' }} fontSize="small" />
              <Typography variant="subtitle2" fontWeight="bold">
                Month Progress
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Day {daysElapsed} of {daysElapsed + daysRemaining}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {daysRemaining} days remaining
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={monthProgress}
              sx={{
                height: 8,
                borderRadius: 4,
                bgcolor: 'grey.200',
              }}
            />
          </CardContent>
        </Card>

        {/* Spending This Month */}
        <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <MoneyIcon sx={{ mr: 1, color: 'primary.main' }} fontSize="small" />
              <Typography variant="subtitle2" fontWeight="bold">
                Spending This Month
              </Typography>
            </Box>
            <Typography variant="h5" gutterBottom>
              {formatCurrency(spentThisMonth)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Projected: {formatCurrency(projectedMonthEnd)}
              {lastMonthTotal > 0 && ` (Last month: ${formatCurrency(lastMonthTotal)})`}
            </Typography>
          </CardContent>
        </Card>

        {/* Savings Rate */}
        {savingsRate !== 0 && (
          <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <TrendingUpIcon sx={{ mr: 1, color: 'success.main' }} fontSize="small" />
                <Typography variant="subtitle2" fontWeight="bold">
                  Savings Rate
                </Typography>
              </Box>
              <Typography variant="h5" color={savingsRate > 0 ? 'success.main' : 'error.main'}>
                {savingsRate}%
              </Typography>
              <Typography variant="caption" color="text.secondary">
                of income this month
              </Typography>
            </CardContent>
          </Card>
        )}

        {/* Budget Health */}
        {(budgetsOnTrack > 0 || budgetsAtRisk > 0) && (
          <Card
            variant="outlined"
            sx={{
              bgcolor: 'background.paper',
              cursor: 'pointer',
              '&:hover': {
                bgcolor: 'action.hover',
                boxShadow: 1
              }
            }}
            onClick={() => handleNavigate('/budgets')}
          >
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <InsightsIcon sx={{ mr: 1, color: 'info.main' }} fontSize="small" />
                <Typography variant="subtitle2" fontWeight="bold">
                  Budget Health
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {budgetsOnTrack > 0 && (
                  <Chip
                    size="small"
                    label={`${budgetsOnTrack} on track`}
                    color="success"
                    variant="outlined"
                  />
                )}
                {budgetsAtRisk > 0 && (
                  <Chip
                    size="small"
                    label={`${budgetsAtRisk} at risk`}
                    color="error"
                    variant="outlined"
                  />
                )}
              </Box>
            </CardContent>
          </Card>
        )}
      </Stack>
    );
  };

  const renderLifetimeInsights = () => {
    const lifetime = insights?.lifetime;
    if (!lifetime) return null;

    const { firstTransactionDate, totalTransactions, totalSpending, avgMonthlySpend, healthScoreTrend } = lifetime;

    return (
      <Stack spacing={compactSpacing}>
        {/* Tracking Duration */}
        {firstTransactionDate && (
          <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <CalendarIcon sx={{ mr: 1, color: 'primary.main' }} fontSize="small" />
                <Typography variant="subtitle2" fontWeight="bold">
                  Tracking Since
                </Typography>
              </Box>
              <Typography variant="h6">
                {new Date(firstTransactionDate).toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric'
                })}
              </Typography>
            </CardContent>
          </Card>
        )}

        {/* Total Transactions */}
        <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <InsightsIcon sx={{ mr: 1, color: 'info.main' }} fontSize="small" />
              <Typography variant="subtitle2" fontWeight="bold">
                Total Activity
              </Typography>
            </Box>
            <Typography variant="h5">
              {totalTransactions.toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              transactions analyzed
            </Typography>
          </CardContent>
        </Card>

        {/* Average Monthly Spend */}
        <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <MoneyIcon sx={{ mr: 1, color: 'primary.main' }} fontSize="small" />
              <Typography variant="subtitle2" fontWeight="bold">
                Average Monthly Spending
              </Typography>
            </Box>
            <Typography variant="h5">
              {formatCurrency(avgMonthlySpend)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              across all months
            </Typography>
          </CardContent>
        </Card>

        {/* Total Spending */}
        <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <TrendingUpIcon sx={{ mr: 1, color: 'secondary.main' }} fontSize="small" />
              <Typography variant="subtitle2" fontWeight="bold">
                Total Spending
              </Typography>
            </Box>
            <Typography variant="h5">
              {formatCurrency(totalSpending)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              since you started tracking
            </Typography>
          </CardContent>
        </Card>

        {/* Health Score Trend */}
        <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <InsightsIcon sx={{ mr: 1, color: 'success.main' }} fontSize="small" />
              <Typography variant="subtitle2" fontWeight="bold">
                Financial Health Trend
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {healthScoreTrend === 'improving' ? (
                <TrendingUpIcon color="success" />
              ) : healthScoreTrend === 'declining' ? (
                <TrendingDownIcon color="error" />
              ) : (
                <TrendingFlatIcon color="disabled" />
              )}
              <Typography variant="body1" sx={{ textTransform: 'capitalize' }}>
                {healthScoreTrend}
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Stack>
    );
  };

  return (
    <Box>
      <ToggleButtonGroup
        value={period}
        exclusive
        onChange={handlePeriodChange}
        fullWidth
        size="small"
        sx={{ mb: 1.5 }}
      >
        <ToggleButton value="daily" sx={{ py: 0.5, fontSize: '0.75rem' }}>Today</ToggleButton>
        <ToggleButton value="weekly" sx={{ py: 0.5, fontSize: '0.75rem' }}>Week</ToggleButton>
        <ToggleButton value="monthly" sx={{ py: 0.5, fontSize: '0.75rem' }}>Month</ToggleButton>
        <ToggleButton value="lifetime" sx={{ py: 0.5, fontSize: '0.75rem' }}>All Time</ToggleButton>
      </ToggleButtonGroup>

      <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
        <Fade in={period === 'daily'} timeout={300} unmountOnExit>
          <Box>{renderDailyInsights()}</Box>
        </Fade>
        <Fade in={period === 'weekly'} timeout={300} unmountOnExit>
          <Box>{renderWeeklyInsights()}</Box>
        </Fade>
        <Fade in={period === 'monthly'} timeout={300} unmountOnExit>
          <Box>{renderMonthlyInsights()}</Box>
        </Fade>
        <Fade in={period === 'lifetime'} timeout={300} unmountOnExit>
          <Box>{renderLifetimeInsights()}</Box>
        </Fade>
      </Box>
    </Box>
  );
};

export default InsightsPanel;
