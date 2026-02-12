import React from 'react';
import { Grid, Card, CardContent, Typography, Chip, Box, useTheme, alpha } from '@mui/material';
import { CategoryType, FormatCurrencyFn, VendorBreakdownItem } from '../types';
import { getBreakdownStrings } from '../strings';
import TrendSparkline from './TrendSparkline';

interface VendorViewProps {
  vendors: VendorBreakdownItem[];
  categoryType: CategoryType;
  formatCurrencyValue: FormatCurrencyFn;
  vendorTrendLabel: (vendor: string) => string;
}

export const calculateVendorDelta = (current: number, previous?: number): number | null => {
  if (!previous || previous === 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
};

export const getVendorDeltaChipColor = (
  categoryType: CategoryType,
  delta: number,
): 'error' | 'success' => {
  const isPositive = delta >= 0;
  if (categoryType === 'expense') {
    return isPositive ? 'error' : 'success';
  }
  return isPositive ? 'success' : 'error';
};

const VendorView: React.FC<VendorViewProps> = ({ vendors, categoryType, formatCurrencyValue, vendorTrendLabel }) => {
  const theme = useTheme();
  const strings = getBreakdownStrings();
  const generalStrings = strings.general;

  return (
    <Grid container spacing={2}>
      {vendors.map((vendor, index) => (
        <Grid size={{ xs: 12, sm: 6, md: 4 }} key={`${vendor.vendor}-${index}`}>
          <Card
            sx={{
              height: '100%',
              background: alpha(theme.palette.background.paper, 0.6),
              backdropFilter: 'blur(10px)',
              border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
              borderRadius: 2,
              transition: 'transform 0.2s, box-shadow 0.2s',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: theme.shadows[4],
                background: alpha(theme.palette.background.paper, 0.8),
              },
            }}
          >
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6" color="primary" noWrap sx={{ maxWidth: '70%' }}>
                  {vendor.vendor}
                </Typography>
                {(() => {
                  const delta = calculateVendorDelta(vendor.total, vendor.previousTotal);
                  if (delta === null) {
                    return null;
                  }
                  const isPositive = delta >= 0;
                  const color = getVendorDeltaChipColor(categoryType, delta);
                  const formattedDelta = `${isPositive ? '+' : ''}${delta.toFixed(1)}%`;
                  return (
                    <Chip
                      label={formattedDelta}
                      size="small"
                      color={color}
                      variant="outlined"
                      sx={{
                        borderRadius: 1,
                        height: 20,
                        fontSize: '0.7rem',
                        fontWeight: 600,
                      }}
                    />
                  );
                })()}
              </Box>
              <Typography
                variant="h4"
                fontWeight="bold"
                color={categoryType === 'income' ? 'success.main' : undefined}
              >
                {formatCurrencyValue(Math.abs(vendor.total))}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {`${vendor.count} ${generalStrings.transactions}`}
              </Typography>
              {vendor.history && vendor.history.length > 1 && (
                <Box sx={{ mt: 2 }}>
                  <TrendSparkline
                    points={vendor.history.map(point => point.total)}
                    color={categoryType === 'income' ? '#2e7d32' : '#c62828'}
                    aria-label={vendorTrendLabel(vendor.vendor)}
                  />
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
};

export default VendorView;
