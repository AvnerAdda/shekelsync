import React from 'react';
import { Box, Chip, Paper, Typography, alpha, useTheme } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { RhythmComparison } from './types';
import { paceTone, weekdayNames, type PaceTone } from './rhythm-format';

export function useToneColor() {
  const theme = useTheme();
  return (tone: PaceTone) => (
    tone === 'good' ? theme.palette.success.main
      : tone === 'warning' ? theme.palette.warning.main
        : theme.palette.text.secondary
  );
}

export const SectionCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }> = ({
  title, subtitle, children, action,
}) => {
  const theme = useTheme();
  return (
    <Paper
      sx={{
        p: 2,
        height: '100%',
        bgcolor: alpha(theme.palette.background.paper, 0.4),
        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        borderRadius: 2,
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 1 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>{title}</Typography>
          {subtitle && <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{subtitle}</Typography>}
        </Box>
        {action}
      </Box>
      {children}
    </Paper>
  );
};

const STATUS_ICON = {
  above: TrendingUpIcon,
  below: TrendingDownIcon,
  within: CheckCircleOutlineIcon,
  insufficient: HourglassEmptyIcon,
};

/** The one-line answer: where you are now against your usual at this same point. */
export const PaceHeadline: React.FC<{ data: RhythmComparison }> = ({ data }) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.modals.rhythm.compare' });
  const { formatCurrency } = useFinancePrivacy();
  const toneColor = useToneColor();
  const money = (value: number | null | undefined) => formatCurrency(value ?? 0, { absolute: true, maximumFractionDigits: 0 });
  const { pace, granularity, metric } = data;
  const tone = paceTone(pace.status, metric);
  const color = toneColor(tone);
  const Icon = STATUS_ICON[pace.status];
  const position = granularity === 'week'
    ? t('position.week', { day: weekdayNames(i18n.language, 'long')[pace.x - 1] })
    : granularity === 'day'
      ? t('position.day')
      : t('position.month', { day: pace.x, length: pace.length });

  const statusLabel = pace.status === 'insufficient'
    ? t('status.insufficient')
    : pace.status === 'within'
      ? t('status.within')
      : t(`status.${pace.status}`, { percent: Math.abs(pace.deltaPercent ?? 0), amount: money(Math.abs(pace.deltaAmount ?? 0)) });

  return (
    <Paper
      sx={{
        p: 2,
        borderRadius: 2,
        bgcolor: alpha(tone === 'neutral' ? theme.palette.background.paper : color, tone === 'neutral' ? 0.4 : 0.06),
        border: `1px solid ${alpha(tone === 'neutral' ? theme.palette.divider : color, tone === 'neutral' ? 0.1 : 0.3)}`,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: { xs: 1.5, md: 3 },
      }}
    >
      <Box>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{position}</Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1.1 }}>{money(pace.current)}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t(`soFar.${metric}`)}</Typography>
      </Box>
      <Box sx={{ flex: 1, minWidth: 220 }}>
        <Chip
          icon={<Icon sx={{ color: `${color} !important` }} />}
          label={statusLabel}
          variant="outlined"
          sx={{ borderColor: alpha(color, 0.5), color: 'text.primary', fontWeight: 600, mb: 0.75 }}
        />
        {pace.median != null && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t(`usual.${granularity}`, { median: money(pace.median), low: money(pace.low), high: money(pace.high) })}
          </Typography>
        )}
        {pace.projectedTotal != null && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t(`projection.${granularity}`, { projected: money(pace.projectedTotal), typical: money(pace.typicalTotal) })}
          </Typography>
        )}
        {granularity === 'day' && data.unusualDays != null && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('day.unusualCount', { count: data.unusualDays })}
          </Typography>
        )}
      </Box>
    </Paper>
  );
};
