import React, { useState } from 'react';
import { Box, Chip, Typography, Paper } from '@mui/material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { PortfolioSummary } from '@renderer/types/investments';
import { useTranslation } from 'react-i18next';
import CustomTooltip, { TooltipDataItem } from './CustomTooltip';
import AccountAllocationModal from './AccountAllocationModal';
import {
  getOrderedPortfolioAccounts,
  getPortfolioCategoryBuckets,
  normalizeInvestmentCategory,
} from '../utils/portfolio-categories';

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
  const { t } = useTranslation('translation');
  const [modalOpen, setModalOpen] = useState(false);

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  const allAccounts = getOrderedPortfolioAccounts(portfolioData);

  const chartData = allAccounts
    .filter((account) => account.current_value > 0)
    .map((account, index) => ({
      name: account.account_name,
      value: account.current_value,
      color: CHART_COLORS[index % CHART_COLORS.length],
      category: normalizeInvestmentCategory(account.investment_category),
    }));

  const totalValue = portfolioData.summary.totalPortfolioValue;
  const categoryChips = getPortfolioCategoryBuckets(portfolioData)
    .filter(({ bucket }) => bucket.totalValue > 0);

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
          {t('investmentsPage.allocation.title')}
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
          {t('investmentsPage.allocation.viewMore')}
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
                  stroke="transparent"
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
                    label: t('investmentsPage.allocation.tooltipCategory'),
                    value: t(`investmentsPage.balanceSheet.buckets.${data.category}`),
                    type: 'text',
                    color: data.color,
                  },
                  {
                    label: t('investmentsPage.allocation.tooltipValue'),
                    value: data.value,
                    type: 'currency',
                    color: data.color,
                  },
                  {
                    label: t('investmentsPage.allocation.tooltipPercentage'),
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
            {t('investmentsPage.allocation.total')}
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

        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            gap: 2,
            mt: 1.5,
            pt: 1.5,
            borderTop: 1,
            borderColor: 'divider',
            flexWrap: 'wrap',
          }}
        >
          {categoryChips.map(({ key, bucket }) => (
            <Chip
              key={key}
              size="small"
              label={`${t(`investmentsPage.balanceSheet.buckets.${key}`)} • ${maskAmounts ? '***' : formatCurrencyValue(bucket.totalValue)}`}
              variant="outlined"
            />
          ))}
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
