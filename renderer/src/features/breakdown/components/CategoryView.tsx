import React, { useState, useMemo } from 'react';
import { Box, Typography, useTheme, alpha, ToggleButtonGroup, ToggleButton } from '@mui/material';
import PieChartIcon from '@mui/icons-material/PieChart';
import DonutLargeIcon from '@mui/icons-material/DonutLarge';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip, SunburstChart } from 'recharts';
import { CategoryType, ChartDisplayMode, FormatCurrencyFn, OverviewDataItem, SunburstDataNode, Subcategory } from '../types';
import { getBreakdownStrings } from '../strings';
import { PIE_COLORS } from '@renderer/shared/chart-colors';
import CategoryIcon from './CategoryIcon';

interface CategoryViewProps {
  data: OverviewDataItem[];
  categoryType: CategoryType;
  formatCurrencyValue: FormatCurrencyFn;
}

function convertSubcategory(sub: Subcategory, parentColor: string): SunburstDataNode {
  const subColor = sub.color || parentColor;
  const hasChildren = sub.subcategories && sub.subcategories.length > 0;

  if (hasChildren) {
    return {
      name: sub.name,
      fill: subColor,
      value: Math.abs(sub.total),
      children: sub.subcategories!.map(child => convertSubcategory(child, subColor)),
    };
  } else {
    return {
      name: sub.name,
      fill: subColor,
      value: Math.abs(sub.total),
    };
  }
}

function toSunburstData(data: OverviewDataItem[]): SunburstDataNode {
  const totalValue = data.reduce((sum, item) => sum + item.value, 0);

  return {
    name: 'Total',
    value: totalValue,
    children: data.map((item, index) => {
      const defaultColor = PIE_COLORS[index % PIE_COLORS.length];
      const itemColor = item.color || defaultColor;
      const hasSubcategories = item.subcategories && item.subcategories.length > 0;

      if (hasSubcategories) {
        return {
          name: item.name,
          fill: itemColor,
          value: item.value,
          children: item.subcategories!.map(sub => convertSubcategory(sub, itemColor)),
        };
      } else {
        return {
          name: item.name,
          fill: itemColor,
          value: item.value,
        };
      }
    }),
  };
}

const CategoryView: React.FC<CategoryViewProps> = ({ data, categoryType, formatCurrencyValue }) => {
  const theme = useTheme();
  const strings = getBreakdownStrings();
  const generalStrings = strings.general;
  const [chartType, setChartType] = useState<ChartDisplayMode>('pie');

  const getValueLabel = () => {
    if (categoryType === 'income') return generalStrings.income;
    if (categoryType === 'investment') return generalStrings.invested;
    return generalStrings.spent;
  };

  const valueLabel = getValueLabel();
  const totalValue = data.reduce((sum, item) => sum + item.value, 0);

  const sunburstData = useMemo(() => toSunburstData(data), [data]);

  const sunburstIcons = useMemo(() => {
    if (totalValue === 0) return [];

    const INNER_RADIUS = 50;
    const OUTER_RADIUS = 180;
    const treeDepth = data.some(d => d.subcategories && d.subcategories.length > 0) ? 2 : 1;
    const thickness = (OUTER_RADIUS - INNER_RADIUS) / treeDepth;
    const midRadius = INNER_RADIUS + thickness / 2;
    const MIN_ANGLE_DEG = 20;
    const ICON_SIZE = 22;

    let currentAngle = 0; // in radians
    return data.map((item, index) => {
      const fraction = item.value / totalValue;
      const angleSpan = fraction * 360;
      const startAngle = currentAngle;
      currentAngle += angleSpan;

      if (angleSpan < MIN_ANGLE_DEG) return null;

      const midAngleDeg = startAngle + angleSpan / 2 - 90; // -90 to start from top
      const midAngleRad = (midAngleDeg * Math.PI) / 180;
      const x = Math.cos(midAngleRad) * midRadius;
      const y = Math.sin(midAngleRad) * midRadius;

      return {
        key: item.name,
        x,
        y,
        icon: item.icon,
        color: item.color || PIE_COLORS[index % PIE_COLORS.length],
        size: ICON_SIZE,
      };
    }).filter(Boolean) as { key: string; x: number; y: number; icon: string | null | undefined; color: string; size: number }[];
  }, [data, totalValue]);

  const handleChartTypeChange = (_event: React.MouseEvent<HTMLElement>, newType: ChartDisplayMode | null) => {
    if (newType !== null) {
      setChartType(newType);
    }
  };

  return (
    <Box sx={{ width: '100%', position: 'relative' }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={chartType}
          onChange={handleChartTypeChange}
          aria-label="chart type"
        >
          <ToggleButton value="pie" aria-label="pie chart">
            <PieChartIcon sx={{ mr: 0.5, fontSize: '1rem' }} />
            {generalStrings.pieChart}
          </ToggleButton>
          <ToggleButton value="sunburst" aria-label="sunburst chart">
            <DonutLargeIcon sx={{ mr: 0.5, fontSize: '1rem' }} />
            {generalStrings.sunburstChart}
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={{ height: 400, width: '100%', position: 'relative' }}>
        {chartType === 'pie' ? (
          <>
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
                  formatter={(value: number | undefined) => value != null ? formatCurrencyValue(value) : ''}
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
          </>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={400}>
              <SunburstChart
                data={sunburstData}
                dataKey="value"
                innerRadius={50}
                fill={theme.palette.primary.main}
                stroke={theme.palette.background.paper}
                textOptions={{ fill: 'transparent' }}
              >
                <RechartsTooltip
                  formatter={(value: number | undefined) => value != null ? formatCurrencyValue(value) : ''}
                  contentStyle={{
                    backgroundColor: alpha(theme.palette.background.paper, 0.9),
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
              </SunburstChart>
            </ResponsiveContainer>
            {/* Category icon overlay for sunburst parent sectors */}
            {sunburstIcons.map(({ key, x, y, icon, color, size }) => (
              <Box
                key={key}
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                  pointerEvents: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CategoryIcon iconName={icon} color={color} size={size} />
              </Box>
            ))}
          </>
        )}
      </Box>
    </Box>
  );
};

export default CategoryView;
