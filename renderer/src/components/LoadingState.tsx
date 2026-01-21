import React from 'react';
import { Box, CircularProgress, Typography, Skeleton } from '@mui/material';

interface LoadingStateProps {
  variant?: 'spinner' | 'skeleton' | 'minimal';
  message?: string;
  size?: 'small' | 'medium' | 'large';
  fullHeight?: boolean;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  variant = 'spinner',
  message,
  size = 'medium',
  fullHeight = false,
}) => {
  const spinnerSize = {
    small: 24,
    medium: 40,
    large: 56,
  }[size];

  if (variant === 'skeleton') {
    return (
      <Box sx={{ width: '100%', p: 2 }}>
        <Skeleton variant="rectangular" height={60} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={40} sx={{ mb: 1 }} />
        <Skeleton variant="rectangular" height={40} sx={{ mb: 1 }} />
        <Skeleton variant="rectangular" height={40} />
      </Box>
    );
  }

  if (variant === 'minimal') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <CircularProgress size={16} />
        {message && (
          <Typography variant="caption" color="text.secondary">
            {message}
          </Typography>
        )}
      </Box>
    );
  }

  // Default spinner variant
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        py: 4,
        ...(fullHeight && { minHeight: '400px' }),
      }}
    >
      <CircularProgress size={spinnerSize} />
      {message && (
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
      )}
    </Box>
  );
};

export default LoadingState;
