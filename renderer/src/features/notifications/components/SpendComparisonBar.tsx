import React from 'react';
import { Box, useTheme, alpha } from '@mui/material';
import { useTranslation } from 'react-i18next';
import SpendDetailRow from './SpendDetailRow';

export interface SpendComparisonBarProps {
  previous: number;
  current: number;
  previousRange: string | null;
  currentRange: string | null;
  formatCurrency: (value: number) => string;
}

const SpendComparisonBar: React.FC<SpendComparisonBarProps> = ({
  previous,
  current,
  previousRange,
  currentRange,
  formatCurrency,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const maxVal = Math.max(previous, current, 1);
  const previousPct = (previous / maxVal) * 100;
  const currentPct = (current / maxVal) * 100;
  const isIncrease = current > previous;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
      <SpendDetailRow
        label={t('insights.snapshot.modal.previousSpend')}
        value={previous}
        percentage={previousPct}
        color="grey.400"
        bgColor={alpha(theme.palette.grey[500], 0.2)}
        formatCurrency={formatCurrency}
        range={previousRange}
      />
      <SpendDetailRow
        label={t('insights.snapshot.metrics.totalSpend')}
        value={current}
        percentage={currentPct}
        color={isIncrease ? 'error.main' : 'success.main'}
        bgColor={alpha(isIncrease ? theme.palette.error.main : theme.palette.success.main, 0.1)}
        formatCurrency={formatCurrency}
        range={currentRange}
      />
    </Box>
  );
};

export default SpendComparisonBar;
