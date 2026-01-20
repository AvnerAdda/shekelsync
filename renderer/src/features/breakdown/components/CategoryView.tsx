import React from 'react';
import { Box, Typography, useTheme, alpha } from '@mui/material';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip } from 'recharts';
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
  
  const getValueLabel = () => {
    if (categoryType === 'income') return generalStrings.income;
    if (categoryType === 'investment') return generalStrings.invested;
    return generalStrings.spent;
  };
  
  const valueLabel = getValueLabel();
  const totalValue = data.reduce((sum, item) => sum + item.value, 0);

  const PIE_COLORS = ['#2196F3', '#4CAF50', '#FF9800', '#E91E63', '#9C27B0', '#00BCD4'];

  return (
    <Box sx={{ height: 400, width: '100%', position: 'relative' }}>
      <ResponsiveContainer width="100%" height={400}>
        <PieChart>
          <Pie
            data={data as any}
            cx="50%"
            cy="50%"
            innerRadius={120}
            outerRadius={160}
            paddingAngle={2}
            dataKey="value"
            stroke="none"
          >
            {data.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={entry.color || PIE_COLORS[index % PIE_COLORS.length]} 
              />
            ))}
          </Pie>
          <RechartsTooltip
            formatter={(value: number) => formatCurrencyValue(value)}
            contentStyle={{
              backgroundColor: alpha(theme.palette.background.paper, 0.8),
              backdropFilter: 'blur(10px)',
              borderRadius: 12,
              border: `1px solid ${alpha(theme.palette.common.white, 0.1)}`,
              color: theme.palette.text.primary,
              boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
              padding: '8px 12px',
            }}
            itemStyle={{ color: theme.palette.text.primary, fontSize: '0.875rem', fontWeight: 600 }}
            labelStyle={{ color: theme.palette.text.secondary, fontSize: '0.75rem', marginBottom: '4px' }}
          />
        </PieChart>
      </ResponsiveContainer>
      
      {/* Center Text Overlay */}
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1, mb: 0.5 }}>
          {valueLabel}
        </Typography>
        <Typography variant="h5" fontWeight={700} sx={{ color: theme.palette.text.primary }}>
          {formatCurrencyValue(totalValue)}
        </Typography>
      </Box>
    </Box>
  );
};

export default CategoryView;
