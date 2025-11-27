import React from 'react';
import { Grid, Card, CardContent, Typography, Chip, Box } from '@mui/material';
import { CategoryType, FormatCurrencyFn, VendorBreakdownItem } from '../types';
import { getBreakdownStrings } from '../strings';
import TrendSparkline from './TrendSparkline';

interface VendorViewProps {
  vendors: VendorBreakdownItem[];
  categoryType: CategoryType;
  formatCurrencyValue: FormatCurrencyFn;
}

const VendorView: React.FC<VendorViewProps> = ({ vendors, categoryType, formatCurrencyValue }) => {
  const strings = getBreakdownStrings();
  const generalStrings = strings.general;

  const calculateDelta = (current: number, previous?: number) => {
    if (!previous || previous === 0) {
      return null;
    }
    return ((current - previous) / previous) * 100;
  };

  return (
    <Grid container spacing={2}>
      {vendors.map((vendor, index) => (
        <Grid item xs={12} sm={6} md={4} key={`${vendor.vendor}-${index}`}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6" color="primary">
                  {vendor.vendor}
                </Typography>
                {(() => {
                  const delta = calculateDelta(vendor.total, vendor.previousTotal);
                  if (delta === null) {
                    return null;
                  }
                  const isPositive = delta >= 0;
                  const color = categoryType === 'expense'
                    ? isPositive ? 'error' : 'success'
                    : isPositive ? 'success' : 'error';
                  const formattedDelta = `${isPositive ? '+' : ''}${delta.toFixed(1)}%`;
                  return (
                    <Chip
                      label={formattedDelta}
                      size="small"
                      color={color}
                      variant="outlined"
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
                    aria-label={`Trend for ${vendor.vendor}`}
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
