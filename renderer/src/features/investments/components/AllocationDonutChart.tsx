import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { PortfolioSummary } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';

interface AllocationDonutChartProps {
  portfolioData: PortfolioSummary;
}

const CHART_COLORS = [
  '#8B5CF6', // Purple
  '#F97316', // Orange
  '#06B6D4', // Cyan
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#EC4899', // Pink
  '#6366F1', // Indigo
  '#84CC16', // Lime
  '#14B8A6', // Teal
];

const AllocationDonutChart: React.FC<AllocationDonutChartProps> = ({ portfolioData }) => {
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.allocation' });

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  // Combine all accounts for the chart
  const allAccounts = [
    ...(portfolioData.restrictedAccounts || []),
    ...(portfolioData.liquidAccounts || []),
  ];

  // Create data for the pie chart
  const chartData = allAccounts
    .filter(account => account.current_value > 0)
    .map((account, index) => ({
      name: account.account_name,
      value: account.current_value,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));

  const totalValue = portfolioData.summary.totalPortfolioValue;

  return (
    <Paper
      elevation={0}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        p: 2,
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('title', 'Allocation')}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: 'primary.main',
            cursor: 'pointer',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          {t('viewMore', 'View more')}
        </Typography>
      </Box>

      {/* Donut Chart with Center Value */}
      <Box sx={{ position: 'relative', flexGrow: 1, minHeight: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="85%"
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* Center Value */}
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
          }}
        >
          <Typography
            variant="h5"
            fontWeight={700}
            sx={{ color: 'text.primary', lineHeight: 1.2 }}
          >
            {maskAmounts ? '***' : formatCurrencyValue(totalValue)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('total', 'Total')}
          </Typography>
        </Box>
      </Box>

      {/* Legend */}
      <Box sx={{ mt: 2 }}>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            justifyContent: 'center',
          }}
        >
          {chartData.slice(0, 6).map((item, index) => (
            <Box
              key={index}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
              }}
            >
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: item.color,
                }}
              />
              <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 80 }}>
                {item.name}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Paper>
  );
};

export default AllocationDonutChart;
