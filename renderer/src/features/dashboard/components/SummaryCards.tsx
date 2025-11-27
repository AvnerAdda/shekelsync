import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  useTheme,
  Divider,
  LinearProgress,
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
  budgetUsage: _budgetUsage, // Keep for potential future use
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
      mainValue: `${Math.round(savingsScore)}`,
      subtitle: 'Savings Score',
      color: savingsScore >= 70 ? theme.palette.success.main
        : savingsScore >= 40 ? theme.palette.warning.main
        : theme.palette.error.main,
      details: (
        <>
          <Divider sx={{ my: 2 }} />

          {/* Diversity Score */}
          {diversityScore !== undefined && (
            <Box sx={{ mb: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <DiversityIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">Diversity</Typography>
                </Box>
                <Typography variant="body2">{diversityScore}</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={diversityScore}
                color={diversityScore >= 60 ? 'success' : diversityScore >= 30 ? 'warning' : 'error'}
                sx={{ height: 4, borderRadius: 2 }}
              />
            </Box>
          )}

          {/* Impulse Control */}
          {impulseControl !== undefined && (
            <Box sx={{ mb: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <ImpulseIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">Impulse</Typography>
                </Box>
                <Typography variant="body2">{impulseControl}</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={impulseControl}
                color={impulseControl >= 70 ? 'success' : impulseControl >= 40 ? 'warning' : 'error'}
                sx={{ height: 4, borderRadius: 2 }}
              />
            </Box>
          )}

          {/* Runway Score */}
          <Box sx={{ mb: 0.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <RunwayIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Typography variant="body2" color="text.secondary">Runway</Typography>
              </Box>
              <Typography variant="body2">{Math.round(runwayScore)}</Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={runwayScore}
              color={runwayScore >= 70 ? 'success' : runwayScore >= 40 ? 'warning' : 'error'}
              sx={{ height: 4, borderRadius: 2 }}
            />
          </Box>
        </>
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
