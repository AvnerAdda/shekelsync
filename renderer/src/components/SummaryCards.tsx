import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Grid,
  useTheme,
} from '@mui/material';
import {
  TrendingUp as IncomeIcon,
  TrendingDown as ExpenseIcon,
  AccountBalance as BalanceIcon,
  PieChart as BudgetIcon,
  Savings as PortfolioIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';

interface SummaryCardsProps {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  netInvestments?: number;
  portfolioValue?: number | null;
  budgetUsage?: number; // percentage
}

const SummaryCards: React.FC<SummaryCardsProps> = ({
  totalIncome,
  totalExpenses,
  netBalance,
  netInvestments,
  portfolioValue,
  budgetUsage,
}) => {
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();

  const formatCurrencyValue = (amount: number) =>
    formatCurrency(amount, { absolute: true, maximumFractionDigits: 0 });

  const cards = [
    {
      title: 'Total Income',
  value: formatCurrencyValue(totalIncome),
      icon: <IncomeIcon sx={{ fontSize: 40 }} />,
      color: theme.palette.success.main,
      bgColor: theme.palette.mode === 'dark'
        ? 'rgba(46, 125, 50, 0.1)'
        : 'rgba(46, 125, 50, 0.05)',
    },
    {
      title: 'Total Expenses',
  value: formatCurrencyValue(totalExpenses),
      icon: <ExpenseIcon sx={{ fontSize: 40 }} />,
      color: theme.palette.error.main,
      bgColor: theme.palette.mode === 'dark'
        ? 'rgba(211, 47, 47, 0.1)'
        : 'rgba(211, 47, 47, 0.05)',
    },
    {
      title: 'Net Balance',
  value: formatCurrencyValue(netBalance),
      icon: <BalanceIcon sx={{ fontSize: 40 }} />,
      color: netBalance >= 0 ? theme.palette.success.main : theme.palette.error.main,
      bgColor: netBalance >= 0
        ? (theme.palette.mode === 'dark'
          ? 'rgba(46, 125, 50, 0.1)'
          : 'rgba(46, 125, 50, 0.05)')
        : (theme.palette.mode === 'dark'
          ? 'rgba(211, 47, 47, 0.1)'
          : 'rgba(211, 47, 47, 0.05)'),
    },
  ];

  // Add Net Investments card if investment data is available
  if (netInvestments !== undefined) {
    cards.push({
      title: 'Net Investments',
      value: formatCurrencyValue(netInvestments),
      icon: <BalanceIcon sx={{ fontSize: 40 }} />,
      color: netInvestments >= 0 ? theme.palette.info.main : theme.palette.warning.main,
      bgColor: netInvestments >= 0
        ? (theme.palette.mode === 'dark'
          ? 'rgba(2, 136, 209, 0.1)'
          : 'rgba(2, 136, 209, 0.05)')
        : (theme.palette.mode === 'dark'
          ? 'rgba(237, 108, 2, 0.1)'
          : 'rgba(237, 108, 2, 0.05)'),
    });
  }

  // Add Portfolio Value card if available
  if (portfolioValue !== undefined && portfolioValue !== null && portfolioValue > 0) {
    cards.push({
      title: 'Portfolio Value',
      value: formatCurrencyValue(portfolioValue),
      icon: <PortfolioIcon sx={{ fontSize: 40 }} />,
      color: theme.palette.success.main,
      bgColor: theme.palette.mode === 'dark'
        ? 'rgba(46, 125, 50, 0.1)'
        : 'rgba(46, 125, 50, 0.05)',
    });
  }

  if (budgetUsage !== undefined) {
    cards.push({
      title: 'Budget Usage',
      value: `${budgetUsage.toFixed(0)}%`,
      icon: <BudgetIcon sx={{ fontSize: 40 }} />,
      color: budgetUsage >= 100
        ? theme.palette.error.main
        : budgetUsage >= 80
        ? theme.palette.warning.main
        : theme.palette.info.main,
      bgColor: budgetUsage >= 100
        ? (theme.palette.mode === 'dark'
          ? 'rgba(211, 47, 47, 0.1)'
          : 'rgba(211, 47, 47, 0.05)')
        : budgetUsage >= 80
        ? (theme.palette.mode === 'dark'
          ? 'rgba(237, 108, 2, 0.1)'
          : 'rgba(237, 108, 2, 0.05)')
        : (theme.palette.mode === 'dark'
          ? 'rgba(2, 136, 209, 0.1)'
          : 'rgba(2, 136, 209, 0.05)'),
    });
  }

  return (
    <Grid container spacing={3}>
      {cards.map((card, index) => {
        const isNetBalance = card.title === 'Net Balance';
        return (
          <Grid
            item
            xs={12}
            sm={6}
            md={cards.length <= 3 ? 4 : cards.length === 4 ? 3 : cards.length === 5 ? 2.4 : 2}
            key={index}
          >
            <Card
              sx={{
                height: '100%',
                background: theme.palette.mode === 'dark'
                  ? 'rgba(30, 30, 30, 0.6)'
                  : 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(16px) saturate(120%)',
                WebkitBackdropFilter: 'blur(16px) saturate(120%)',
                border: `1px solid ${
                  theme.palette.mode === 'dark'
                    ? 'rgba(200, 250, 207, 0.15)'
                    : 'rgba(200, 250, 207, 0.3)'
                }`,
                borderRadius: '20px',
                boxShadow: `
                  0 8px 32px rgba(0, 0, 0, 0.06),
                  inset 0 1px 1px rgba(255, 255, 255, ${theme.palette.mode === 'dark' ? '0.1' : '0.6'})
                `,
                transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
                transform: isNetBalance ? 'scale(1.03)' : 'scale(1)',
                position: 'relative',
                overflow: 'hidden',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: '-100%',
                  width: '50%',
                  height: '100%',
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                  transition: 'left 0.6s',
                }
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  width: '120px',
                  height: '120px',
                  background: `radial-gradient(circle at top right, ${card.color}15, transparent 65%)`,
                  opacity: 0.6,
                  pointerEvents: 'none'
                }}
              />
              <CardContent sx={{ position: 'relative', zIndex: 1 }}>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <Box>
                    <Typography
                      variant="body2"
                      sx={{
                        color: '#64748B',
                        fontWeight: 500,
                        letterSpacing: '0.01em',
                        mb: isNetBalance ? 2 : 1,
                        fontSize: isNetBalance ? '15px' : '14px'
                      }}
                    >
                      {card.title}
                    </Typography>
                    <Typography
                      variant={isNetBalance ? 'h3' : 'h4'}
                      sx={{
                        fontWeight: 700,
                        color: card.color,
                        fontFamily: '"SF Mono", "IBM Plex Mono", ui-monospace, monospace',
                        fontFeatureSettings: '"tnum"',
                        letterSpacing: '-0.03em',
                      }}
                    >
                      {card.value}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      color: card.color,
                      opacity: 0.8,
                      backgroundColor: `${card.color}15`,
                      borderRadius: '12px',
                      padding: '12px',
                      border: `1.5px solid ${card.color}30`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    {card.icon}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
};

export default SummaryCards;
