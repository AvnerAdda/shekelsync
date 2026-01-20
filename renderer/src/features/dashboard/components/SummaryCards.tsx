import React, { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Divider,
  LinearProgress,
  CircularProgress,
  Tooltip,
  Grid,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  AccountBalance as AccountBalanceIcon,
  TrendingUp as TrendingUpIcon,
  Savings as SavingsIcon,
  Diversity3 as DiversityIcon,
  ShoppingCart as ImpulseIcon,
  Schedule as RunwayIcon,
  Warning as WarningIcon,
  HourglassEmpty as PendingIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useSpendingCategories } from '@renderer/features/budgets/hooks/useSpendingCategories';
import type { SpendingCategory } from '@renderer/types/spending-categories';
import { apiClient } from '@renderer/lib/api-client';
import { useTranslation } from 'react-i18next';

interface FinancialHealthSnapshot {
  overallHealthScore: number;
  healthBreakdown: {
    savingsScore?: number;
    diversityScore?: number;
    impulseScore?: number;
    runwayScore?: number;
  };
}

interface SummaryCardsProps {
  // Card 1: Current Month Finance
  totalIncome: number;
  totalCapitalReturns?: number;
  totalExpenses: number;
  netInvestments?: number;
  currentBankBalance?: number;
  monthStartBankBalance?: number;
  pendingExpenses?: number;
  pendingCount?: number;

  // Card 2: Investment Portfolio
  portfolioValue?: number | null;
  portfolioGains?: number;
  monthlyPortfolioChange?: number;
  assetBreakdown?: Array<{ name: string; value: number; percentage: number }>;

  // Card 3: Overall Analysis
  budgetUsage?: number;
  monthlyAverage?: number;
  topCategories?: Array<{ name: string; amount: number }>;

  // Financial Intelligence Metrics
  categoryCount?: number; // For diversity calculation
}

const SummaryCards: React.FC<SummaryCardsProps> = ({
  totalIncome,
  totalCapitalReturns = 0,
  totalExpenses,
  netInvestments = 0,
  currentBankBalance,
  pendingExpenses = 0,
  pendingCount = 0,
  portfolioValue,
  portfolioGains,
  assetBreakdown = [],
  topCategories = [],
  categoryCount = 0,
}) => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'dashboard' });
  const { formatCurrency } = useFinancePrivacy();

  // Capital Returns offset investment outflows (it's money coming back from previous investments)
  const effectiveNetInvestments = Math.max(0, netInvestments - totalCapitalReturns);
  const netSavings = totalIncome - (totalExpenses + effectiveNetInvestments);

  // Calculate if pending expenses will cause financial difficulty
  const netSavingsAfterPending = netSavings - pendingExpenses;
  const hasPendingExpenses = pendingExpenses > 0;
  const projectedBankBalanceAfterPending =
    currentBankBalance !== undefined ? currentBankBalance - pendingExpenses : null;
  const pendingCreatesCashFlowDeficit = netSavingsAfterPending < 0;
  const pendingOverdrawsBank =
    projectedBankBalanceAfterPending !== null ? projectedBankBalanceAfterPending < 0 : null;
  const showPendingDeficitWarning = pendingCreatesCashFlowDeficit && (pendingOverdrawsBank === null || pendingOverdrawsBank);
  const showPendingDeficitCovered = pendingCreatesCashFlowDeficit && pendingOverdrawsBank === false;
  const pendingDeficitAmount = Math.abs(netSavingsAfterPending);
  const pendingOverdraftAmount =
    projectedBankBalanceAfterPending !== null && projectedBankBalanceAfterPending < 0
      ? Math.abs(projectedBankBalanceAfterPending)
      : 0;

  // Use absolute values for calculations since expenses might be negative
  const absExpenses = Math.abs(totalExpenses);
  const absTopCategoryAmount = topCategories.length > 0 ? Math.abs(topCategories[0]?.amount || 0) : 0;
  const absCurrentBalance = currentBankBalance !== undefined ? Math.abs(currentBankBalance) : 0;

  // Check if we have real breakdown data (not just the fallback "Total Expenses")
  const hasRealBreakdownData = categoryCount > 0 && topCategories.length > 0 && topCategories[0]?.name !== 'Total Expenses';

  // Financial Intelligence Metrics (matching backend logic)

  // Savings Rate: (Income - Expenses) / Income
  const rawSavingsRate = totalIncome > 0
    ? ((totalIncome - absExpenses) / totalIncome)
    : 0;
  // Savings Score: savingsRate * 200, capped at 100
  const savingsScore = Math.max(0, Math.min(100, rawSavingsRate * 200));

  // Diversity Score: (1 - maxCategorySpend / totalExpenses) * 100
  const diversityScore = hasRealBreakdownData && absExpenses > 0
    ? Math.round((1 - (absTopCategoryAmount / absExpenses)) * 100)
    : undefined;

  // Impulse Control: Not directly calculated from categories in backend
  // Backend uses small transaction count, so we'll use diversity as proxy
  const impulseControl = diversityScore;

  // Runway Score: (currentBalance / dailyBurnRate) / 60 * 100
  // Simplified: (balance / (monthlyExpenses / 30)) / 60 * 100
  const dailyBurnRate = absExpenses / 30; // Approximate daily from monthly
  const runwayDays = dailyBurnRate > 0 ? absCurrentBalance / dailyBurnRate : 0;
  const runwayScore = Math.max(0, Math.min(100, runwayDays / 60 * 100));

  // Debug logging
  console.log('SummaryCards Financial Health Metrics:', {
    totalIncome,
    totalExpenses,
    absExpenses,
    currentBankBalance,
    absCurrentBalance,
    categoryCount,
    topCategories,
    absTopCategoryAmount,
    hasRealBreakdownData,
    rawSavingsRate: rawSavingsRate.toFixed(3),
    savingsScore,
    diversityScore,
    impulseControl,
    runwayDays: runwayDays.toFixed(1),
    runwayScore,
    pendingExpenses,
    pendingCreatesCashFlowDeficit,
    pendingOverdrawsBank,
    projectedBankBalanceAfterPending,
  });

  const SPENDING_CATEGORY_COLORS: Record<SpendingCategory, string> = {
    essential: '#2196F3',
    growth: '#4CAF50',
    stability: '#FF9800',
    reward: '#E91E63',
  };

  const SPENDING_CATEGORY_LABELS: Record<SpendingCategory, string> = {
    essential: t('summary.categories.essential'),
    growth: t('summary.categories.growth'),
    stability: t('summary.categories.stability'),
    reward: t('summary.categories.reward'),
  };

  const DEFAULT_TARGETS: Record<SpendingCategory, number> = {
    essential: 50,
    growth: 20,
    stability: 15,
    reward: 15,
  };

  const {
    breakdown: spendingBreakdown,
    fetchBreakdown: fetchSpendingBreakdown,
  } = useSpendingCategories({ autoLoad: false, currentMonthOnly: true });

  const [healthSnapshot, setHealthSnapshot] = useState<FinancialHealthSnapshot | null>(null);
  const [forecastSummary, setForecastSummary] = useState<{ totalSpent: number; totalForecasted: number; onTrack: number; atRisk: number; exceeded: number } | null>(null);

  useEffect(() => {
    void fetchSpendingBreakdown();
  }, [fetchSpendingBreakdown]);

  // Fetch forecast data for budget outlook
  useEffect(() => {
    let isMounted = true;
    const fetchForecastData = async () => {
      try {
        const response = await apiClient.get<{ budgetOutlook?: Array<{ actualSpent: number; forecasted: number; status: string }> }>('/api/forecast/daily');
        if (response.ok && isMounted) {
          const outlook = response.data?.budgetOutlook || [];
          // Filter to only categories with activity
          const activeCategories = outlook.filter(item => item.forecasted > 0 || item.actualSpent > 0);
          const totalSpent = activeCategories.reduce((sum, item) => sum + item.actualSpent, 0);
          const totalForecasted = activeCategories.reduce((sum, item) => sum + item.forecasted, 0);
          const onTrack = activeCategories.filter(item => item.status === 'on_track').length;
          const atRisk = activeCategories.filter(item => item.status === 'at_risk').length;
          const exceeded = activeCategories.filter(item => item.status === 'exceeded').length;
          setForecastSummary({ totalSpent, totalForecasted, onTrack, atRisk, exceeded });
        }
      } catch (error) {
        console.error('Failed to fetch forecast data for dashboard:', error);
      }
    };
    fetchForecastData();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const fetchHealthSnapshot = async () => {
      try {
        const response = await apiClient.get<FinancialHealthSnapshot>('/api/analytics/personal-intelligence?days=60');
        if (response.ok && isMounted) {
          setHealthSnapshot(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch financial health snapshot for dashboard card:', error);
      }
    };

    fetchHealthSnapshot();
    return () => {
      isMounted = false;
    };
  }, []);

  const allocationTargets = spendingBreakdown?.targets ?? DEFAULT_TARGETS;

  const allocationItems = (['essential', 'growth', 'stability', 'reward'] as SpendingCategory[]).map((key) => {
    const item = spendingBreakdown?.breakdown.find((b) => b.spending_category === key);
    return {
      key,
      actual: item?.actual_percentage ?? 0,
      target: allocationTargets[key],
      label: SPENDING_CATEGORY_LABELS[key],
      color: SPENDING_CATEGORY_COLORS[key],
    };
  });

  const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

  const getMetricColor = (value: number): 'success' | 'warning' | 'error' =>
    value >= 70 ? 'success' : value >= 40 ? 'warning' : 'error';

  const allocationTotal = allocationItems.reduce((sum, item) => sum + item.actual, 0);

  const normalizedAllocation = allocationItems.map((item) => ({
    ...item,
    width: allocationTotal > 0 ? (item.actual / allocationTotal) * 100 : 0,
  }));

  // Forecast-based budget status counts
  const budgetCategoriesCount = (forecastSummary?.onTrack ?? 0) + (forecastSummary?.atRisk ?? 0) + (forecastSummary?.exceeded ?? 0);

  const overallHealthScore = clampPercent(healthSnapshot?.overallHealthScore ?? savingsScore);

  const normalizedHealth = {
    savings: clampPercent(healthSnapshot?.healthBreakdown?.savingsScore ?? savingsScore),
    diversity: clampPercent(
      healthSnapshot?.healthBreakdown?.diversityScore ?? (diversityScore !== undefined ? diversityScore : savingsScore)
    ),
    impulse: clampPercent(
      healthSnapshot?.healthBreakdown?.impulseScore ?? (impulseControl !== undefined ? impulseControl : savingsScore)
    ),
    runway: clampPercent(healthSnapshot?.healthBreakdown?.runwayScore ?? runwayScore),
  };

  const healthMetrics: Array<{ id: string; label: string; value: number; icon: React.ReactNode }> = [
    {
      id: 'savings',
      label: t('summary.health.savings'),
      value: normalizedHealth.savings,
      icon: <SavingsIcon sx={{ fontSize: 16, color: 'text.secondary' }} />,
    },
    {
      id: 'diversity',
      label: t('summary.health.diversity'),
      value: normalizedHealth.diversity,
      icon: <DiversityIcon sx={{ fontSize: 16, color: 'text.secondary' }} />,
    },
    {
      id: 'impulse',
      label: t('summary.health.impulse'),
      value: normalizedHealth.impulse,
      icon: <ImpulseIcon sx={{ fontSize: 16, color: 'text.secondary' }} />,
    },
    {
      id: 'runway',
      label: t('summary.health.runway'),
      value: normalizedHealth.runway,
      icon: <RunwayIcon sx={{ fontSize: 16, color: 'text.secondary' }} />,
    },
  ];

  const formatCurrencyValue = (amount: number) =>
    formatCurrency(amount, { absolute: true, maximumFractionDigits: 0 });

  const PIE_COLORS = ['#2196F3', '#4CAF50', '#FF9800', '#E91E63', '#9C27B0', '#00BCD4'];

  const cards = [
    {
      id: 'finance',
      title: t('summary.cards.finance.title'),
      icon: <AccountBalanceIcon />,
      mainValue: formatCurrencyValue(netSavings),
      subtitle: currentBankBalance !== undefined
        ? t('summary.cards.finance.subtitle', { amount: formatCurrencyValue(currentBankBalance) })
        : undefined,
      color: netSavings >= 0 ? theme.palette.success.main : theme.palette.error.main,
      details: (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {t('summary.cards.finance.income')}
            </Typography>
            <Typography variant="body2" color="success.main">+{formatCurrencyValue(totalIncome)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('summary.cards.finance.expenses')}
            </Typography>
            <Typography variant="body2" color="error.main">-{formatCurrencyValue(totalExpenses)}</Typography>
          </Box>
          {netInvestments > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {t('summary.cards.finance.investments')}
              </Typography>
              <Typography variant="body2" color="info.main">-{formatCurrencyValue(netInvestments)}</Typography>
            </Box>
          )}
          {totalCapitalReturns > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2" color="text.secondary">
                  {t('summary.cards.finance.capitalReturns')}
                </Typography>
                <Tooltip
                  title={t('summary.cards.finance.capitalReturnsNote')}
                  arrow
                  placement="top"
                >
                  <InfoIcon sx={{ fontSize: 14, color: 'text.disabled', cursor: 'help' }} />
                </Tooltip>
              </Box>
              <Typography variant="body2" sx={{ color: '#B2DFDB' }}>+{formatCurrencyValue(totalCapitalReturns)}</Typography>
            </Box>
          )}
          {hasPendingExpenses && (
            <>
              <Divider sx={{ my: 1.5 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <PendingIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                  <Typography variant="body2" color="text.secondary">
                    {t('summary.cards.finance.pendingLabel', { count: pendingCount })}
                  </Typography>
                </Box>
                <Typography variant="body2" color="warning.main">
                  -{formatCurrencyValue(pendingExpenses)}
                </Typography>
              </Box>
              {showPendingDeficitWarning && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    mt: 1,
                    p: 1,
                    bgcolor: 'error.lighter',
                    borderRadius: 1,
                    border: `1px solid ${theme.palette.error.main}`,
                  }}
                >
                  <WarningIcon sx={{ fontSize: 16, color: 'error.main' }} />
                  <Typography variant="caption" color="error.main" fontWeight="medium">
                    {t('summary.cards.finance.pendingDeficit', {
                      amount: formatCurrencyValue(pendingOverdraftAmount || pendingDeficitAmount),
                    })}
                  </Typography>
                </Box>
              )}
              {showPendingDeficitCovered && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    mt: 1,
                    p: 1,
                    bgcolor: alpha(theme.palette.info.main, 0.08),
                    borderRadius: 1,
                    border: `1px solid ${alpha(theme.palette.info.main, 0.35)}`,
                  }}
                >
                  <InfoIcon sx={{ fontSize: 16, color: 'info.main' }} />
                  <Typography variant="caption" color="info.main" fontWeight="medium">
                    {t('summary.cards.finance.pendingDeficitCovered', {
                      amount: formatCurrencyValue(pendingDeficitAmount),
                      balance: currentBankBalance !== undefined ? formatCurrencyValue(currentBankBalance) : undefined,
                    })}
                  </Typography>
                </Box>
              )}
            </>
          )}
        </>
      ),
    },
    {
      id: 'portfolio',
      title: t('summary.cards.portfolio.title'),
      icon: <TrendingUpIcon />,
      mainValue: portfolioValue !== undefined && portfolioValue !== null ? formatCurrencyValue(portfolioValue) : '—',
      subtitle: portfolioGains !== undefined ? `${portfolioGains >= 0 ? '+' : ''}${formatCurrencyValue(portfolioGains)}` : undefined,
      color: portfolioGains !== undefined && portfolioGains >= 0 ? theme.palette.success.main : theme.palette.error.main,
      details: assetBreakdown.length > 0 ? (
        <Box sx={{ height: 200, width: '100%', mt: 1, position: 'relative' }}>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={assetBreakdown}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                stroke="none"
              >
                {assetBreakdown.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip
                formatter={(value: number) => formatCurrencyValue(value)}
                contentStyle={{
                  backgroundColor: alpha(theme.palette.background.paper, 0.8),
                  backdropFilter: 'blur(10px)',
                  borderRadius: 12,
                  border: `1px solid ${alpha(theme.palette.common.white, 0.1)}`,
                  color: theme.palette.text.primary,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                  padding: '8px 12px',
                }}
                itemStyle={{ color: theme.palette.text.primary, fontSize: '0.875rem', fontWeight: 600 }}
                labelStyle={{ color: theme.palette.text.secondary, fontSize: '0.75rem', marginBottom: '4px' }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Center Text Overlay */}
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1 }}>
              {t('summary.cards.portfolio.total', { defaultValue: 'Total' })}
            </Typography>
            <Typography variant="body2" fontWeight={700} sx={{ color: theme.palette.text.primary }}>
              {assetBreakdown.length} {t('summary.cards.portfolio.assets', { defaultValue: 'Assets' })}
            </Typography>
          </Box>
        </Box>
      ) : null,
    },
    {
      id: 'analysis',
      title: t('summary.cards.analysis.title'),
      icon: <SavingsIcon />,
      mainValue: `${overallHealthScore}`,
      subtitle: t('summary.health.subtitle'),
      color: overallHealthScore >= 70 ? theme.palette.success.main
        : overallHealthScore >= 40 ? theme.palette.warning.main
        : theme.palette.error.main,
      details: (
        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
              px: 1.5,
              py: 1,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.text.primary, 0.04),
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary">
                {t('summary.budgets.utilization', { count: budgetCategoriesCount })}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {forecastSummary ? `${forecastSummary.onTrack} / ${forecastSummary.atRisk} / ${forecastSummary.exceeded}` : '—'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: theme.palette.divider }}>
              {budgetCategoriesCount > 0 ? (
                <>
                  {forecastSummary && forecastSummary.onTrack > 0 && (
                    <Tooltip title={`${t('summary.budgets.onTrack')}: ${forecastSummary.onTrack}`} placement="top">
                      <Box
                        sx={{
                          width: `${(forecastSummary.onTrack / budgetCategoriesCount) * 100}%`,
                          bgcolor: theme.palette.success.main,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </Tooltip>
                  )}
                  {forecastSummary && forecastSummary.atRisk > 0 && (
                    <Tooltip title={`${t('summary.budgets.warning')}: ${forecastSummary.atRisk}`} placement="top">
                      <Box
                        sx={{
                          width: `${(forecastSummary.atRisk / budgetCategoriesCount) * 100}%`,
                          bgcolor: theme.palette.warning.main,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </Tooltip>
                  )}
                  {forecastSummary && forecastSummary.exceeded > 0 && (
                    <Tooltip title={`${t('summary.budgets.exceeded')}: ${forecastSummary.exceeded}`} placement="top">
                      <Box
                        sx={{
                          width: `${(forecastSummary.exceeded / budgetCategoriesCount) * 100}%`,
                          bgcolor: theme.palette.error.main,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </Tooltip>
                  )}
                </>
              ) : (
                <Box sx={{ width: '100%', bgcolor: theme.palette.divider }} />
              )}
            </Box>
          </Box>

          <Box
            sx={{
              px: 1.5,
              py: 1,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.text.primary, 0.02),
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.6 }}>
              <Typography variant="body2" color="text.secondary">
                {t('summary.allocation.actual')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('summary.allocation.target', {
                  targets: (['essential', 'growth', 'stability', 'reward'] as SpendingCategory[])
                  .map((key) => Math.round(allocationTargets[key]))
                  .join(' / '),
                })}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: theme.palette.divider }}>
              {normalizedAllocation.map((item) => (
                <Tooltip
                  key={item.key}
                  title={t('summary.allocation.tooltip', {
                    label: item.label,
                    actual: Math.round(item.actual),
                    target: Math.round(item.target),
                  })}
                  placement="top"
                >
                  <Box
                    sx={{
                      width: `${item.width}%`,
                      bgcolor: `${item.color}E6`,
                      transition: 'width 0.2s ease',
                    }}
                  />
                </Tooltip>
              ))}
            </Box>
          </Box>

          <Divider />

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              flexWrap: 'nowrap',
            }}
          >
            {healthMetrics.map((metric) => (
              <Tooltip key={metric.id} title={`${metric.label}: ${metric.value}`} placement="top">
                <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                  <CircularProgress
                    variant="determinate"
                    value={metric.value}
                    size={54}
                    thickness={5}
                    color={getMetricColor(metric.value)}
                  />
                  <Box
                    sx={{
                      top: 0,
                      left: 0,
                      bottom: 0,
                      right: 0,
                      position: 'absolute',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Typography variant="caption" fontWeight={700}>
                      {metric.value}
                    </Typography>
                  </Box>
                </Box>
              </Tooltip>
            ))}
          </Box>
        </Box>
      ),
    },
  ];

  return (
    <Grid container spacing={3}>
      {cards.map((card) => (
        <Grid size={{ xs: 12, md: 4 }} key={card.id}>
          <Card sx={{ 
            height: '100%',
            borderRadius: 4,
            backgroundColor: theme.palette.mode === 'dark' ? 'rgba(30, 30, 30, 0.6)' : 'rgba(255, 255, 255, 0.6)',
            backdropFilter: 'blur(20px)',
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.05)}`,
            transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
            '&:hover': {
              transform: 'translateY(-4px)',
              boxShadow: `0 12px 40px ${alpha(theme.palette.common.black, 0.1)}`,
            }
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2.5 }}>
                <Box sx={{ 
                  color: card.color, 
                  mr: 1.5,
                  p: 1,
                  borderRadius: 2,
                  backgroundColor: alpha(card.color, 0.1),
                  display: 'flex'
                }}>
                  {card.icon}
                </Box>
                <Typography variant="overline" color="text.secondary" fontWeight={600} letterSpacing={1}>
                  {card.title}
                </Typography>
              </Box>

              <Typography variant="h4" sx={{ 
                fontWeight: 700, 
                color: card.color, 
                mb: 0.5,
                textShadow: `0 0 20px ${alpha(card.color, 0.3)}`
              }}>
                {card.mainValue}
              </Typography>

              {card.subtitle && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontWeight: 500 }}>
                  {card.subtitle}
                </Typography>
              )}

              {card.details}
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
};

export default SummaryCards;
