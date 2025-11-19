import React from 'react';
import { Grid, Card, CardContent, Typography } from '@mui/material';
import { CategoryType, FormatCurrencyFn, VendorBreakdownItem } from '../types';

interface VendorViewProps {
  vendors: VendorBreakdownItem[];
  categoryType: CategoryType;
  formatCurrencyValue: FormatCurrencyFn;
}

const VendorView: React.FC<VendorViewProps> = ({ vendors, categoryType, formatCurrencyValue }) => {
  return (
    <Grid container spacing={2}>
      {vendors.map((vendor, index) => (
        <Grid item xs={12} sm={6} md={4} key={`${vendor.vendor}-${index}`}>
          <Card>
            <CardContent>
              <Typography variant="h6" color="primary" gutterBottom>
                {vendor.vendor}
              </Typography>
              <Typography
                variant="h4"
                fontWeight="bold"
                color={categoryType === 'income' ? 'success.main' : undefined}
              >
                {formatCurrencyValue(Math.abs(vendor.total))}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
};

export default VendorView;
