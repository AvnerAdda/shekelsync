import React, { useState } from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { PortfolioSummary } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';
import CustomTooltip, { TooltipDataItem } from './CustomTooltip';
import AccountAllocationModal from './AccountAllocationModal';

interface AllocationDonutChartProps {
  portfolioData: PortfolioSummary;
}

const CHART_COLORS = [
  '#3ea54d', // Brand green
  '#00897B', // Teal
  '#e88b78', // Brand peach
  '#F97316', // Orange
  '#06B6D4', // Cyan
  '#F4A261', // Warm amber
  '#26A69A', // Teal light
  '#78e88b', // Brand green light
  '#EF4444', // Red
  '#14B8A6', // Teal dark
];

const AllocationDonutChart: React.FC<AllocationDonutChartProps> = ({ portfolioData }) => {
  const { formatCurrency, maskAmounts } = useFinancePrivacy();
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.allocation' });
  const [modalOpen, setModalOpen] = useState(false);

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  // Combine all accounts for the chart, tracking their type
  const restrictedAccounts = portfolioData.restrictedAccounts || [];
  const liquidAccounts = portfolioData.liquidAccounts || [];

  // Create a map to track which accounts are liquid vs restricted
  const accountTypeMap = new Map<string, 'liquid' | 'restricted'>();
  restrictedAccounts.forEach(acc => accountTypeMap.set(acc.account_name, 'restricted'));
  liquidAccounts.forEach(acc => accountTypeMap.set(acc.account_name, 'liquid'));

  const allAccounts = [...restrictedAccounts, ...liquidAccounts];

  // Create data for the pie chart
  const chartData = allAccounts
    .filter(account => account.current_value > 0)
    .map((account, index) => ({
      name: account.account_name,
      value: account.current_value,
      color: CHART_COLORS[index % CHART_COLORS.length],
      type: accountTypeMap.get(account.account_name) || 'liquid',
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
          onClick={() => setModalOpen(true)}
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
      <Box sx={{ position: 'relative', flexGrow: 1, minHeight: 200, height: '100%' }}>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="85%"
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color}
                  stroke={entry.type === 'liquid' ? '#10B981' : '#EF4444'}
                  strokeWidth={1.5}
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;

                const data = payload[0].payload;
                const percentage = (data.value / totalValue) * 100;

                const items: TooltipDataItem[] = [
                  {
                    label: t('tooltipType', 'Type'),
                    value: data.type === 'liquid' ? t('tooltipLiquid', 'Liquid') : t('tooltipRestricted', 'Restricted'),
                    type: 'text',
                    color: data.type === 'liquid' ? '#10B981' : '#EF4444',
                  },
                  {
                    label: t('tooltipValue', 'Value'),
                    value: data.value,
                    type: 'currency',
                    color: data.color,
                  },
                  {
                    label: t('tooltipPercentage', 'Percentage'),
                    value: percentage.toFixed(1),
                    type: 'percentage',
                  },
                ];

                return (
                  <CustomTooltip
                    active={active}
                    items={items}
                    title={data.name}
                  />
                );
              }}
            />
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

        {/* Border color legend */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            gap: 2,
            mt: 1.5,
            pt: 1.5,
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box
              sx={{
                width: 12,
                height: 3,
                bgcolor: '#10B981',
                borderRadius: 0.5,
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
              {t('liquidBorder', 'Liquid')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box
              sx={{
                width: 12,
                height: 3,
                bgcolor: '#EF4444',
                borderRadius: 0.5,
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
              {t('restrictedBorder', 'Restricted')}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Account Allocation Modal */}
      <AccountAllocationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        portfolioData={portfolioData}
        colors={CHART_COLORS}
      />
    </Paper>
  );
};

export default AllocationDonutChart;
