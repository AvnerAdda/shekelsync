import React from 'react';
import { Typography, TypographyProps } from '@mui/material';

export const CurrencyTypography: React.FC<TypographyProps> = ({ sx, ...props }) => {
  return (
    <Typography
      {...props}
      sx={{
        fontFamily: "'Space Mono', 'SF Mono', 'IBM Plex Mono', 'Roboto Mono', monospace",
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.02em',
        ...sx,
      }}
    />
  );
};

export default CurrencyTypography;
