import React from 'react';
import { Box, useTheme } from '@mui/material';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Cell } from 'recharts';
import { CategoryType, FormatCurrencyFn, OverviewDataItem } from '../types';
import { getBreakdownStrings } from '../strings';

interface CategoryViewProps {
  data: OverviewDataItem[];
  categoryType: CategoryType;
  formatCurrencyValue: FormatCurrencyFn;
}

const CategoryView: React.FC<CategoryViewProps> = ({ data, categoryType, formatCurrencyValue }) => {
  const theme = useTheme();
  const strings = getBreakdownStrings();
  const generalStrings = strings.general;
  const valueLabel =
    categoryType === 'income'
      ? generalStrings.income
      : categoryType === 'investment'
      ? generalStrings.invested
      : generalStrings.spent;

  const formatValueWithDelta = (value: number, payload?: any) => {
    const item = payload?.payload as OverviewDataItem | undefined;
    const previous = item?.previousValue;
    if (!previous || previous === 0) {
      return formatCurrencyValue(value);
    }
    const delta = ((value - previous) / previous) * 100;
    return `${formatCurrencyValue(value)} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%)`;
  };

  return (
    <Box>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tickFormatter={(value: number) => formatCurrencyValue(value)} />
          <YAxis type="category" dataKey="name" width={150} />
          <Tooltip
            formatter={(value: number, _name, props) => [formatValueWithDelta(value, props), valueLabel]}
            contentStyle={{
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
            }}
          />
          <Bar dataKey="value" fill={theme.palette.primary.main} name={valueLabel}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color || theme.palette.primary.main} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
};

export default CategoryView;
