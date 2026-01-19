import React from 'react';
import { Box, Typography, useTheme, alpha, Avatar } from '@mui/material';
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { InvestmentAccountSummary, PortfolioHistoryPoint } from '@renderer/types/investments';
import CustomTooltip, { TooltipDataItem } from './CustomTooltip';
import { getInstitutionLabel, type InstitutionMetadata } from '@renderer/shared/components/InstitutionBadge';
import {
  AccountBalance as BankIcon,
  TrendingUp as StockIcon,
  Savings as SavingsIcon,
  Home as RealEstateIcon,
  CurrencyBitcoin as CryptoIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  TrendingFlat as TrendingFlatIcon,
} from '@mui/icons-material';

interface InvestmentPerformanceCardProps {
  account: InvestmentAccountSummary;
  history: PortfolioHistoryPoint[];
  color: string;
}

const getAccountIcon = (accountType: string, category?: string | null) => {
  const type = (accountType || '').toLowerCase();
  const cat = (category || '').toLowerCase();

  if (cat.includes('crypto') || cat.includes('bitcoin')) return CryptoIcon;
  if (cat.includes('real') || cat.includes('property')) return RealEstateIcon;
  if (type.includes('pension') || type.includes('gemel') || type.includes('hishtalmut')) return SavingsIcon;
  if (type.includes('broker') || type.includes('stock')) return StockIcon;
  return BankIcon;
};

const InvestmentPerformanceCard: React.FC<InvestmentPerformanceCardProps> = ({
  account,
  history,
  color,
}) => {
  const theme = useTheme();
  const { formatCurrency, maskAmounts } = useFinancePrivacy();

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  // Calculate ROI
  const roi = account.cost_basis > 0
    ? ((account.current_value - account.cost_basis) / account.cost_basis) * 100
    : 0;
  const isPositive = roi >= 0;

  // Prepare sparkline data - use last 30 points or all if less
  const sparklineData = (history || [])
    .slice(-30)
    .map(point => ({
      value: point.currentValue,
      date: point.date,
      displayDate: new Date(point.date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
    }));

  // Calculate min and max values for tooltip
  const values = sparklineData.map(d => d.value);
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const maxValue = values.length > 0 ? Math.max(...values) : 0;

  // Determine sparkline color and trend based on change
  const firstValue = sparklineData[0]?.value || 0;
  const lastValue = sparklineData[sparklineData.length - 1]?.value || 0;
  const trendPercentage = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;
  const trendPositive = lastValue >= firstValue;
  const sparklineColor = trendPositive
    ? theme.palette.success.main
    : theme.palette.error.main;

  // Determine trend icon
  const getTrendIcon = () => {
    if (Math.abs(trendPercentage) < 0.5) return TrendingFlatIcon;
    return trendPositive ? TrendingUpIcon : TrendingDownIcon;
  };

  const TrendIcon = getTrendIcon();

  const Icon = getAccountIcon(account.account_type, account.investment_category);

  return (
    <Box
      sx={{
        minWidth: 180,
        maxWidth: 200,
        bgcolor: alpha(theme.palette.background.default, 0.5),
        borderRadius: 2,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        transition: 'transform 0.2s, box-shadow 0.2s',
        cursor: 'pointer',
        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: theme.shadows[4],
          borderColor: alpha(theme.palette.divider, 0.2),
        },
      }}
    >
      {/* Header with Icon and Name */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Avatar
          sx={{
            width: 32,
            height: 32,
            bgcolor: alpha(color, 0.2),
            color: color,
          }}
        >
          <Icon sx={{ fontSize: 18 }} />
        </Avatar>
        <Box sx={{ overflow: 'hidden', flex: 1 }}>
          <Typography
            variant="body2"
            fontWeight={600}
            noWrap
            sx={{ lineHeight: 1.2 }}
          >
            {account.account_name}
          </Typography>
          {account.institution && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {typeof account.institution === 'string'
                ? account.institution
                : (getInstitutionLabel(account.institution as InstitutionMetadata) || '')}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Value with Trend Icon */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
        <Typography variant="h6" fontWeight={700}>
          {maskAmounts ? '***' : formatCurrencyValue(account.current_value)}
        </Typography>
        {sparklineData.length > 1 && (
          <TrendIcon
            sx={{
              fontSize: 20,
              color: Math.abs(trendPercentage) < 0.5
                ? 'text.secondary'
                : trendPositive
                ? 'success.main'
                : 'error.main',
            }}
          />
        )}
      </Box>

      {/* ROI */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography
          variant="caption"
          fontWeight={600}
          sx={{
            color: isPositive ? 'success.main' : 'error.main',
            bgcolor: alpha(isPositive ? theme.palette.success.main : theme.palette.error.main, 0.1),
            px: 0.75,
            py: 0.25,
            borderRadius: 1,
          }}
        >
          {isPositive ? '+' : ''}{roi.toFixed(1)}%
        </Typography>
      </Box>

      {/* Period High/Low */}
      {sparklineData.length > 1 && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            mt: 0.5,
            pt: 0.5,
            borderTop: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
              High
            </Typography>
            <Typography variant="caption" fontWeight={600} display="block" sx={{ fontSize: '0.7rem' }}>
              {maskAmounts ? '***' : `₪${(maxValue / 1000).toFixed(0)}k`}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
              Low
            </Typography>
            <Typography variant="caption" fontWeight={600} display="block" sx={{ fontSize: '0.7rem' }}>
              {maskAmounts ? '***' : `₪${(minValue / 1000).toFixed(0)}k`}
            </Typography>
          </Box>
        </Box>
      )}

      {/* Sparkline */}
      {sparklineData.length > 1 && (
        <Box sx={{ height: 40, mt: 1 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparklineData}>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;

                  const dataPoint = payload[0].payload;
                  const items: TooltipDataItem[] = [
                    {
                      label: 'Value',
                      value: dataPoint.value,
                      type: 'currency',
                      color: sparklineColor,
                    },
                    {
                      label: 'Min',
                      value: minValue,
                      type: 'currency',
                    },
                    {
                      label: 'Max',
                      value: maxValue,
                      type: 'currency',
                    },
                  ];

                  return (
                    <CustomTooltip
                      active={active}
                      items={items}
                      title={dataPoint.displayDate}
                    />
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={sparklineColor}
                strokeWidth={2}
                dot={false}
                activeDot={{
                  r: 4,
                  fill: sparklineColor,
                  stroke: theme.palette.background.paper,
                  strokeWidth: 2,
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Box>
  );
};

export default InvestmentPerformanceCard;
