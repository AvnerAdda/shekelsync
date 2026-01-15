import React from 'react';
import { Box, Typography, Paper, useTheme, alpha } from '@mui/material';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';

export interface TooltipDataItem {
  label: string;
  value: number | string;
  color?: string;
  type?: 'currency' | 'percentage' | 'text';
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  items?: TooltipDataItem[];
  title?: string;
  valueFormatter?: (value: number) => string;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  label,
  items,
  title,
  valueFormatter,
}) => {
  const theme = useTheme();
  const { formatCurrency, maskAmounts } = useFinancePrivacy();

  if (!active) {
    return null;
  }

  const formatValue = (value: number | string, type?: 'currency' | 'percentage' | 'text'): string => {
    if (maskAmounts && (type === 'currency' || !type)) {
      return '***';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (valueFormatter) {
      return valueFormatter(value);
    }

    switch (type) {
      case 'percentage':
        return `${value.toFixed(2)}%`;
      case 'currency':
        return formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });
      case 'text':
        return String(value);
      default:
        return formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });
    }
  };

  // If custom items are provided, use them
  const displayItems: TooltipDataItem[] = items || [];

  // Otherwise, extract from recharts payload
  if (!items && payload && payload.length > 0) {
    payload.forEach(entry => {
      if (entry.value !== undefined && entry.value !== null) {
        displayItems.push({
          label: entry.name || entry.dataKey || '',
          value: entry.value,
          color: entry.color || entry.fill || entry.stroke,
          type: 'currency',
        });
      }
    });
  }

  if (displayItems.length === 0) {
    return null;
  }

  return (
    <Paper
      elevation={3}
      sx={{
        px: 1.5,
        py: 1,
        minWidth: 180,
        maxWidth: 300,
        backgroundColor: alpha(theme.palette.background.paper, 0.98),
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1,
      }}
    >
      {/* Title/Label */}
      {(title || label) && (
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            fontWeight: 600,
            display: 'block',
            mb: displayItems.length > 0 ? 0.5 : 0,
          }}
        >
          {title || label}
        </Typography>
      )}

      {/* Data Items */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {displayItems.map((item, index) => (
          <Box
            key={index}
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 2,
            }}
          >
            {/* Label with color indicator */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {item.color && (
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: item.color,
                    flexShrink: 0,
                  }}
                />
              )}
              <Typography
                variant="caption"
                sx={{
                  color: 'text.primary',
                  fontSize: '0.75rem',
                }}
              >
                {item.label}
              </Typography>
            </Box>

            {/* Value */}
            <Typography
              variant="caption"
              sx={{
                color: 'text.primary',
                fontWeight: 600,
                fontSize: '0.75rem',
                whiteSpace: 'nowrap',
              }}
            >
              {formatValue(item.value, item.type)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
};

export default CustomTooltip;
