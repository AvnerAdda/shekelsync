import React from 'react';
import { Box, Typography } from '@mui/material';

interface SpendDetailRowProps {
  label: string;
  range: string | null;
  value: number;
  percentage: number;
  color: string;
  bgColor: string;
  formatCurrency: (value: number) => string;
}

const SpendDetailRow: React.FC<SpendDetailRowProps> = ({ label, range, value, percentage, color, bgColor, formatCurrency }) => (
  <Box>
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        mb: 0.25,
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
        {label}
      </Typography>
      <Typography variant="caption" fontWeight="bold">
        {formatCurrency(value)}
      </Typography>
    </Box>
    <Box
      sx={{
        height: 8,
        bgcolor: bgColor,
        borderRadius: 0.5,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          height: '100%',
          width: `${percentage}%`,
          bgcolor: color,
          borderRadius: '2px 0 0 2px',
        }}
      />
    </Box>
    {range && (
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block', fontSize: '0.65rem' }}>
        {range}
      </Typography>
    )}
  </Box>
);

export default SpendDetailRow;
