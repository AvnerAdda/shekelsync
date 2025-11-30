import React, { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  useTheme,
  Divider,
  LinearProgress,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import Grid2 from '@mui/material/Grid2';
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
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useSpendingCategories } from '@renderer/features/budgets/hooks/useSpendingCategories';
import { useBudgetIntelligence } from '@renderer/features/budgets/hooks/useBudgetIntelligence';
import type { SpendingCategory } from '@renderer/types/spending-categories';
import { apiClient } from '@renderer/lib/api-client';

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
  const { formatCurrency } = useFinancePrivacy();

  // Capital Returns offset investment outflows (it's money coming back from previous investments)
  const effectiveNetInvestments = Math.max(0, netInvestments - totalCapitalReturns);
  const netSavings = totalIncome - (totalExpenses + effectiveNetInvestments);

  // Calculate if pending expenses will cause financial difficulty
  const netSavingsAfterPending = netSavings - pendingExpenses;
  const willCauseDeficit = netSavingsAfterPending < 0;
  const hasPendingExpenses = pendingExpenses > 0;

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
  });

  const SPENDING_CATEGORY_COLORS: Record<SpendingCategory, string> = {
    essential: '#2196F3',
    growth: '#4CAF50',
    stability: '#FF9800',
    reward: '#E91E63',
  };

  const SPENDING_CATEGORY_LABELS: Record<SpendingCategory, string> = {
    essential: 'Essential',
    growth: 'Growth',
    stability: 'Stability',
    reward: 'Reward',
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

  const { health: budgetHealth, fetchHealth: fetchBudgetHealth } = useBudgetIntelligence({ autoLoad: false });

  const [healthSnapshot, setHealthSnapshot] = useState<FinancialHealthSnapshot | null>(null);

  useEffect(() => {
    void fetchSpendingBreakdown();
    void fetchBudgetHealth();
  }, [fetchSpendingBreakdown, fetchBudgetHealth]);

  useEffect(() => {
    let isMounted = true;
    const fetchHealthSnapshot = async () => {
      try {
        const response = await apiClient.get<FinancialHealthSnapshot>('/api/analytics/personal-intelligence?months=3');
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

  const budgetSummary = budgetHealth?.summary;
  const budgetSegments = [
    {
      id: 'on_track',
      label: 'On track',
      value: budgetSummary?.on_track ?? 0,
      color: theme.palette.success.main,
    },
    {
      id: 'warning',
      label: 'Warning',
      value: budgetSummary?.warning ?? 0,
      color: theme.palette.warning.main,
    },
    {
      id: 'exceeded',
      label: 'Exceeded',
      value: budgetSummary?.exceeded ?? 0,
      color: theme.palette.error.main,
    },
  ];

  const budgetsTotal = budgetSegments.reduce((sum, s) => sum + s.value, 0);
  const normalizedBudgets = budgetsTotal > 0
    ? budgetSegments.map((s) => ({
        ...s,
        width: (s.value / budgetsTotal) * 100,
      }))
    : [{
        id: 'none',
        label: 'No budgets yet',
        value: 0,
        width: 100,
        color: theme.palette.divider,
      }];

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
      label: 'Savings',
      value: normalizedHealth.savings,
      icon: <SavingsIcon sx={{ fontSize: 16, color: 'text.secondary' }} />,
    },
    {
      id: 'diversity',
      label: 'Diversity',
      value: normalizedHealth.diversity,
      icon: <DiversityIcon sx={{ fontSize: 16, color: 'text.secondary' }} />,
    },
    {
      id: 'impulse',
      label: 'Impulse',
      value: normalizedHealth.impulse,
      icon: <ImpulseIcon sx={{ fontSize: 16, color: 'text.secondary' }} />,
    },
    {
      id: 'runway',
      label: 'Runway',
      value: normalizedHealth.runway,
      icon: <RunwayIcon sx={{ fontSize: 16, color: 'text.secondary' }} />,
    },
  ];

  const formatCurrencyValue = (amount: number) =>
    formatCurrency(amount, { absolute: true, maximumFractionDigits: 0 });

  const cards = [
    {
      id: 'finance',
      title: 'Current Month',
      icon: <AccountBalanceIcon />,
      mainValue: formatCurrencyValue(netSavings),
      subtitle: currentBankBalance !== undefined ? `Bank: ${formatCurrencyValue(currentBankBalance)}` : undefined,
      color: netSavings >= 0 ? theme.palette.success.main : theme.palette.error.main,
      details: (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, mt: 2 }}>
            <Typography variant="body2" color="text.secondary">Income</Typography>
            <Typography variant="body2" color="success.main">+{formatCurrencyValue(totalIncome)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="body2" color="text.secondary">Expenses</Typography>
            <Typography variant="body2" color="error.main">-{formatCurrencyValue(totalExpenses)}</Typography>
          </Box>
          {netInvestments > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">Investments</Typography>
              <Typography variant="body2" color="info.main">-{formatCurrencyValue(netInvestments)}</Typography>
            </Box>
          )}
          {totalCapitalReturns > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2" color="text.secondary">Capital Returns</Typography>
                <Tooltip
                  title="Principal returned from investments (pikadon, deposits). Not counted as income but offsets investment outflows."
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
                    Pending ({pendingCount})
                  </Typography>
                </Box>
                <Typography variant="body2" color="warning.main">
                  -{formatCurrencyValue(pendingExpenses)}
                </Typography>
              </Box>
              {willCauseDeficit && (
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
                    Pending expenses will cause deficit of {formatCurrencyValue(Math.abs(netSavingsAfterPending))}
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
      title: 'Investment Portfolio',
      icon: <TrendingUpIcon />,
      mainValue: portfolioValue !== undefined && portfolioValue !== null ? formatCurrencyValue(portfolioValue) : '—',
      subtitle: portfolioGains !== undefined ? `${portfolioGains >= 0 ? '+' : ''}${formatCurrencyValue(portfolioGains)}` : undefined,
      color: portfolioGains !== undefined && portfolioGains >= 0 ? theme.palette.success.main : theme.palette.error.main,
      details: assetBreakdown.length > 0 ? (
        <>
          <Divider sx={{ my: 2 }} />
          {assetBreakdown.slice(0, 3).map((asset, index) => (
            <Box key={index} sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">{asset.name}</Typography>
                <Typography variant="body2">{formatCurrencyValue(asset.value)}</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={asset.percentage}
                sx={{ height: 4, borderRadius: 2 }}
              />
            </Box>
          ))}
        </>
      ) : null,
    },
    {
      id: 'analysis',
      title: 'Financial Health',
      icon: <SavingsIcon />,
      mainValue: `${overallHealthScore}`,
      subtitle: 'Financial Health Score',
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
              px: 1,
              py: 0.75,
              borderRadius: 1,
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
            }}
          >
            <Typography variant="caption" color="text.secondary">
              Budgets ({budgetsTotal} total)
            </Typography>
            <Box sx={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: theme.palette.divider }}>
              {normalizedBudgets.map((segment) => (
                <Tooltip
                  key={segment.id}
                  title={`${segment.label}${segment.value ? `: ${segment.value}` : ''}`}
                  placement="top"
                >
                  <Box
                    sx={{
                      width: `${segment.width}%`,
                      bgcolor: segment.color,
                      transition: 'width 0.2s ease',
                    }}
                  />
                </Tooltip>
              ))}
            </Box>
          </Box>

          <Box
            sx={{
              px: 1,
              py: 0.75,
              borderRadius: 1,
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.6 }}>
              <Typography variant="body2" color="text.secondary">
                Actual Allocation
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Target: {(['essential', 'growth', 'stability', 'reward'] as SpendingCategory[])
                  .map((key) => Math.round(allocationTargets[key]))
                  .join(' / ')}%
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: theme.palette.divider }}>
              {normalizedAllocation.map((item) => (
                <Tooltip
                  key={item.key}
                  title={`${item.label}: ${Math.round(item.actual)}% (target ${Math.round(item.target)}%)`}
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
    <Grid2 container spacing={2}>
      {cards.map((card) => (
        <Grid2 size={{ xs: 12, md: 4 }} key={card.id}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Box sx={{ color: card.color, mr: 1 }}>{card.icon}</Box>
                <Typography variant="overline" color="text.secondary">
                  {card.title}
                </Typography>
              </Box>

              <Typography variant="h4" sx={{ fontWeight: 600, color: card.color, mb: 0.5 }}>
                {card.mainValue}
              </Typography>

              {card.subtitle && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {card.subtitle}
                </Typography>
              )}

              {card.details}
            </CardContent>
          </Card>
        </Grid2>
      ))}
    </Grid2>
  );
};

export default SummaryCards;
