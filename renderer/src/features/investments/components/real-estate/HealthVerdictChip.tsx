import React from 'react';
import { Box, Chip } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import { useTranslation } from 'react-i18next';
import type { HealthVerdict } from '@renderer/types/investments';

/** Reserved status colors (never reused for series); always paired with an icon + label. */
export const VERDICT_COLORS: Record<HealthVerdict, string> = {
  good: '#0ca30c',
  watch: '#fab219',
  risk: '#d03b3b',
  unknown: '#8a8984',
};

const ICONS: Record<HealthVerdict, React.ElementType> = {
  good: CheckCircleOutlineIcon,
  watch: ErrorOutlineIcon,
  risk: WarningAmberIcon,
  unknown: HelpOutlineIcon,
};

const FALLBACK_LABELS: Record<HealthVerdict, string> = {
  good: 'Good',
  watch: 'Watch',
  risk: 'At risk',
  unknown: 'Not enough data',
};

const HealthVerdictChip: React.FC<{ verdict: HealthVerdict; size?: 'small' | 'medium' }> = ({ verdict, size = 'small' }) => {
  const { t } = useTranslation('translation', { keyPrefix: 'investmentsPage.realEstateTab.health.verdicts' });
  const Icon = ICONS[verdict];
  const color = VERDICT_COLORS[verdict];
  return (
    <Chip
      size={size}
      variant="outlined"
      icon={<Box component={Icon} sx={{ color: `${color} !important` }} fontSize="small" />}
      label={t(verdict, FALLBACK_LABELS[verdict])}
      sx={{ borderColor: color, fontWeight: 700 }}
    />
  );
};

export default HealthVerdictChip;
