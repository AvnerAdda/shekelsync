import React from 'react';
import {
  Alert,
  Box,
  Chip,
  Paper,
  Skeleton,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import {
  InvestmentPerformanceResponse,
  InvestmentPerformanceTimelinePoint,
} from '@renderer/types/investments';
import CustomTooltip, { TooltipDataItem } from './CustomTooltip';

interface PerformanceBreakdownPanelProps {
  data: InvestmentPerformanceResponse | null;
  loading: boolean;
  multiCurrencyWarning?: boolean;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return `${(value * 100).toFixed(2)}%`;
}

const PerformanceBreakdownPanel: React.FC<PerformanceBreakdownPanelProps> = ({
  data,
  loading,
  multiCurrencyWarning = false,
}) => {
  const theme = useTheme();
  const { formatCurrency, maskAmounts } = useFinancePrivacy();

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  const chartData = React.useMemo(() => {
    if (!data?.timeline?.length) return [];
    return data.timeline.map((point: InvestmentPerformanceTimelinePoint) => ({
      ...point,
      displayDate: new Date(point.date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      chartWithdrawals: point.withdrawals * -1,
      chartCapitalReturns: point.capitalReturns * -1,
      chartIncome: point.income * -1,
      chartFees: point.fees * -1,
    }));
  }, [data]);

  if (loading) {
    return (
      <Paper sx={{ p: 2.5, height: '100%' }}>
        <Skeleton variant="text" width={180} height={28} />
        <Skeleton variant="text" width={260} height={20} sx={{ mb: 2 }} />
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5, mb: 2 }}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} variant="rounded" height={64} />
          ))}
        </Box>
        <Skeleton variant="rounded" height={280} />
      </Paper>
    );
  }

  if (!data) {
    return (
      <Paper sx={{ p: 2.5, height: '100%' }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Why Portfolio Changed
        </Typography>
        <Typography color="text.secondary">No performance breakdown available yet.</Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            Why Portfolio Changed
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Separates cash movements from market movement for the selected range.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip label={`TWR ${formatPercent(data.twr)}`} size="small" />
          <Chip
            label={`MWR ${data.mwr === null ? 'N/A' : `${(data.mwr * 100).toFixed(2)}%`}`}
            size="small"
          />
        </Box>
      </Box>

      {multiCurrencyWarning && (
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          Mixed currencies detected. Breakdown is useful, but totals are not FX-normalized yet.
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 1.5 }}>
        {[
          { label: 'Value Change', value: data.valueChange, color: 'primary.main' },
          { label: 'Contributions', value: data.netFlows.contributions, color: 'success.main' },
          { label: 'Withdrawals', value: data.netFlows.withdrawals * -1, color: 'error.main' },
          { label: 'Capital Returns', value: data.capitalReturns * -1, color: 'warning.main' },
          { label: 'Distributed Income', value: data.income * -1, color: 'info.main' },
          { label: 'Market Move', value: data.marketMove, color: data.marketMove >= 0 ? 'success.main' : 'error.main' },
        ].map((item) => (
          <Box
            key={item.label}
            sx={{
              p: 1.5,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.background.default, 0.7),
              border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {item.label}
            </Typography>
            <Typography variant="h6" fontWeight={700} sx={{ color: item.color }}>
              {maskAmounts ? '***' : formatCurrencyValue(item.value)}
            </Typography>
          </Box>
        ))}
      </Box>

      <Box sx={{ flexGrow: 1, minHeight: 260 }}>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.6)} />
              <XAxis dataKey="displayDate" tick={{ fontSize: 11, fill: theme.palette.text.secondary }} />
              <YAxis
                tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                tickFormatter={(value) => (maskAmounts ? '***' : formatCurrencyValue(value as number))}
              />
              <RechartsTooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const row = chartData.find((point) => point.displayDate === label);
                  const items: TooltipDataItem[] = [
                    { label: 'Contributions', value: row?.contributions || 0, type: 'currency', color: '#22c55e' },
                    { label: 'Withdrawals', value: (row?.withdrawals || 0) * -1, type: 'currency', color: '#ef4444' },
                    { label: 'Capital Returns', value: (row?.capitalReturns || 0) * -1, type: 'currency', color: '#f59e0b' },
                    { label: 'Income', value: (row?.income || 0) * -1, type: 'currency', color: '#0ea5e9' },
                    { label: 'Market Move', value: row?.marketMove || 0, type: 'currency', color: '#8b5cf6' },
                  ];

                  return (
                    <CustomTooltip
                      active={active}
                      items={items}
                      title={row?.date || String(label)}
                    />
                  );
                }}
              />
              <Legend />
              <Bar dataKey="contributions" stackId="flows" fill="#22c55e" name="Contributions" />
              <Bar dataKey="chartWithdrawals" stackId="flows" fill="#ef4444" name="Withdrawals" />
              <Bar dataKey="chartCapitalReturns" stackId="flows" fill="#f59e0b" name="Capital Returns" />
              <Bar dataKey="chartIncome" stackId="flows" fill="#0ea5e9" name="Income" />
              <Bar dataKey="chartFees" stackId="flows" fill="#64748b" name="Fees" />
              <Line type="monotone" dataKey="marketMove" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Market Move" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <Typography color="text.secondary">No timeline data available for this range.</Typography>
        )}
      </Box>
    </Paper>
  );
};

export default PerformanceBreakdownPanel;
