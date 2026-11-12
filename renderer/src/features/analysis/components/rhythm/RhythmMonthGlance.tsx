import React, { useMemo } from 'react';
import { Box, Chip, Paper, Skeleton, Typography, alpha, useTheme } from '@mui/material';
import {
  Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { useRhythmComparison } from './useRhythmComparison';
import { paceTone } from './rhythm-format';
import { useToneColor } from './RhythmShared';
import type { RhythmPoint } from './types';

type GlanceRow = RhythmPoint & { band: [number, number] | null };

/**
 * Compact "spending through the month" for the Analysis page card: this month's
 * running total against the usual range at the same day of month.
 */
const RhythmMonthGlance: React.FC = () => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'analysisPage.modals.rhythm.compare' });
  const { formatCurrency } = useFinancePrivacy();
  const toneColor = useToneColor();
  const { data, loading, error } = useRhythmComparison('month', 'spend', 'all', true);
  const money = (value: number | null | undefined) => formatCurrency(value ?? 0, { absolute: true, maximumFractionDigits: 0 });
  const compactMoney = (value: number) => formatCurrency(value, { absolute: true, compact: true });

  const rows: GlanceRow[] = useMemo(() => {
    if (!data) return [];
    const length = Math.max(data.pace.length, 28);
    return (data.points ?? [])
      .filter((point) => point.x <= length)
      .map((point) => ({
        ...point,
        band: point.low != null && point.high != null ? [point.low, point.high] : null,
      }));
  }, [data]);

  if (!data) {
    if (error && !loading) {
      return <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>{t('loadFailed')}</Typography>;
    }
    return (
      <Box sx={{ mb: 2 }}>
        <Skeleton variant="text" width="50%" height={32} />
        <Skeleton variant="rectangular" width="100%" height={140} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  const { pace } = data;
  const color = toneColor(paceTone(pace.status, 'spend'));
  const statusLabel = pace.status === 'insufficient'
    ? t('status.insufficient')
    : pace.status === 'within'
      ? t('status.within')
      : t(`status.${pace.status}`, { percent: Math.abs(pace.deltaPercent ?? 0), amount: money(Math.abs(pace.deltaAmount ?? 0)) });

  const names = {
    current: t('series.current.month'),
    median: t('series.median'),
    band: t('series.band'),
  };

  const GlanceTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const row: GlanceRow = payload[0].payload;
    return (
      <Paper sx={{ p: 1.25, minWidth: 160 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('axis.dayN', { day: row.x })}</Typography>
        {row.current != null && (
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{names.current}: {money(row.current)}</Typography>
        )}
        {row.median != null && (
          <Typography variant="body2">{names.median}: {money(row.median)}</Typography>
        )}
        {row.band && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {names.band}: {money(row.band[0])} – {money(row.band[1])}
          </Typography>
        )}
      </Paper>
    );
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('chart.title.month', { metric: t('metric.spend') })} · {t('position.month', { day: pace.x, length: pace.length })}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 0.5 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{money(pace.current)}</Typography>
        <Chip
          size="small"
          label={statusLabel}
          variant="outlined"
          sx={{ borderColor: alpha(color, 0.5), color: 'text.primary', fontWeight: 600 }}
        />
      </Box>

      <ResponsiveContainer width="100%" height={140} minHeight={140}>
        <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="x"
            stroke={theme.palette.text.secondary}
            tickLine={false}
            axisLine={false}
            style={{ fontSize: 10 }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            stroke={theme.palette.text.secondary}
            tickFormatter={compactMoney}
            tickLine={false}
            axisLine={false}
            width={44}
            style={{ fontSize: 9 }}
          />
          <Tooltip content={<GlanceTooltip />} cursor={{ stroke: theme.palette.divider }} />
          <Area dataKey="band" stroke="none" fill={alpha(theme.palette.primary.main, 0.14)} isAnimationActive={false} connectNulls name={names.band} />
          <Line dataKey="median" stroke={theme.palette.text.disabled} strokeWidth={1.5} strokeDasharray="2 4" dot={false} isAnimationActive={false} name={names.median} />
          <Line
            dataKey="current"
            stroke={theme.palette.primary.main}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: theme.palette.background.paper }}
            connectNulls={false}
            isAnimationActive={false}
            name={names.current}
          />
          <ReferenceLine x={pace.x} stroke={alpha(theme.palette.primary.main, 0.5)} strokeDasharray="3 3" />
        </ComposedChart>
      </ResponsiveContainer>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 14, height: 3, borderRadius: 1, bgcolor: 'primary.main' }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{names.current}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 14, borderTop: `2px dotted ${theme.palette.text.disabled}` }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{names.median}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 14, height: 8, borderRadius: 0.5, bgcolor: alpha(theme.palette.primary.main, 0.14) }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{names.band}</Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default RhythmMonthGlance;
