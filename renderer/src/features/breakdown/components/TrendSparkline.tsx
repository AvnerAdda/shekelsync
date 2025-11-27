import React from 'react';
import { Box } from '@mui/material';

interface TrendSparklineProps {
  points: number[];
  color: string;
  width?: number;
  height?: number;
  'aria-label'?: string;
}

const TrendSparkline: React.FC<TrendSparklineProps> = ({
  points,
  color,
  width = 120,
  height = 40,
  'aria-label': ariaLabel = 'trend sparkline',
}) => {
  if (!points || points.length < 2) {
    return null;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const coordinates = points
    .map((value, index) => {
      const x = (index / (points.length - 1 || 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <Box component="svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={coordinates}
      />
    </Box>
  );
};

export default TrendSparkline;

