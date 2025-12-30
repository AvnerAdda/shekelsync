import React from 'react';
import { ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Line } from 'recharts';
import { useTheme, alpha } from '@mui/material';
import { CategoryType, FormatCurrencyFn, MonthlyBreakdownItem } from '../types';
import { getBreakdownStrings } from '../strings';

interface TimelineViewProps {
  data: MonthlyBreakdownItem[];
  categoryType: CategoryType;
  title: string;
  formatCurrencyValue: FormatCurrencyFn;
}

const TimelineView: React.FC<TimelineViewProps> = ({ data, categoryType, title, formatCurrencyValue }) => {
  const theme = useTheme();
  const strings = getBreakdownStrings();
  const timelineStrings = strings.timeline;

  const chartData = React.useMemo(
    () =>
      data.map(item => ({
        month: item.month,
        total: item.total,
        inflow: item.inflow ?? (categoryType === 'income' ? item.total : 0),
        outflow: item.outflow ?? (categoryType === 'expense' ? item.total : 0),
      })),
    [data, categoryType]
  );

  const hasInflow = chartData.some(entry => (entry.inflow ?? 0) > 0);
  const hasOutflow = chartData.some(entry => (entry.outflow ?? 0) > 0);
  const shouldFallbackToTotal = !hasInflow && !hasOutflow;

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" />
        <YAxis tickFormatter={(value: number) => formatCurrencyValue(value)} />
        <Tooltip
          formatter={(value: number) => formatCurrencyValue(value)}
          contentStyle={{
            backgroundColor: alpha(theme.palette.background.paper, 0.8),
            backdropFilter: 'blur(8px)',
            borderRadius: 8,
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            boxShadow: theme.shadows[4],
          }}
        />
        <Legend />
        {shouldFallbackToTotal ? (
          <Line
            type="monotone"
            dataKey="total"
            stroke={theme.palette.primary.main}
            strokeWidth={2}
            name={timelineStrings.fallbackLegend}
          />
        ) : (
          <>
            {hasOutflow && (
              <Line
                type="monotone"
                dataKey="outflow"
                stroke={theme.palette.error.main}
                strokeWidth={2}
                name={categoryType === 'income' ? timelineStrings.outflow : title}
              />
            )}
            {hasInflow && (
              <Line
                type="monotone"
                dataKey="inflow"
                stroke={theme.palette.success.main}
                strokeWidth={2}
                name={categoryType === 'expense' ? timelineStrings.income : timelineStrings.inflow}
              />
            )}
          </>
        )}
      </LineChart>
    </ResponsiveContainer>
  );
};

export default TimelineView;
