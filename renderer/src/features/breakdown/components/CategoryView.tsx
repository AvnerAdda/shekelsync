import React from 'react';
import { Box, useTheme } from '@mui/material';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Cell } from 'recharts';
import { FormatCurrencyFn, OverviewDataItem } from '../types';

interface CategoryViewProps {
  data: OverviewDataItem[];
  formatCurrencyValue: FormatCurrencyFn;
}

const CategoryView: React.FC<CategoryViewProps> = ({ data, formatCurrencyValue }) => {
  const theme = useTheme();

  return (
    <Box>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tickFormatter={(value: number) => formatCurrencyValue(value)} />
          <YAxis type="category" dataKey="name" width={150} />
          <Tooltip
            formatter={(value: number) => formatCurrencyValue(value)}
            contentStyle={{
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
            }}
          />
          <Bar dataKey="value" fill={theme.palette.primary.main}>
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
