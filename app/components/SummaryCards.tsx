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
} from '@mui/icons-material';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';

interface SummaryCardsProps {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  budgetUsage?: number; // percentage
}

const SummaryCards: React.FC<SummaryCardsProps> = ({
  totalIncome,
  totalExpenses,
  netBalance,
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
      {cards.map((card, index) => (
        <Grid item xs={12} sm={6} md={budgetUsage !== undefined ? 3 : 4} key={index}>
          <Card
            sx={{
              height: '100%',
              backgroundColor: card.bgColor,
              border: `1px solid ${card.color}20`,
            }}
          >
            <CardContent>
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
                    color="text.secondary"
                    gutterBottom
                  >
                    {card.title}
                  </Typography>
                  <Typography
                    variant="h4"
                    sx={{
                      fontWeight: 'bold',
                      color: card.color,
                    }}
                  >
                    {card.value}
                  </Typography>
                </Box>
                <Box sx={{ color: card.color, opacity: 0.7 }}>
                  {card.icon}
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
};

export default SummaryCards;
