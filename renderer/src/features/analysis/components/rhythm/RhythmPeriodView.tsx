import React, { useMemo } from 'react';
import { Box, Grid, Paper, Typography, alpha, useTheme } from '@mui/material';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { RhythmComparison, RhythmPoint } from './types';
import {
  categoryLabel, deltaTone, formatPeriodLabel, toAppLocale, weekdayNames,
} from './rhythm-format';
import { PaceHeadline, SectionCard, useToneColor } from './RhythmShared';

interface Props {
  data: RhythmComparison;
}

type ChartRow = RhythmPoint & { band: [number, number] | null; label: string };

const RhythmPeriodView: React.FC<Props> = ({ data }) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.modals.rhythm.compare' });
  const { formatCurrency } = useFinancePrivacy();
  const toneColor = useToneColor();
  const locale = toAppLocale(i18n.language);
  const granularity = data.granularity === 'week' ? 'week' : 'month';
  const money = (value: number | null | undefined) => formatCurrency(value ?? 0, { absolute: true, maximumFractionDigits: 0 });
  const compactMoney = (value: number) => formatCurrency(value, { absolute: true, compact: true });
  const days = useMemo(() => weekdayNames(i18n.language), [i18n.language]);
  const xLabel = (x: number) => (granularity === 'week' ? days[x - 1] : String(x));
  const periodLength = data.pace.length;
  const comparable = Math.max(0, (data.periods?.length ?? 1) - 1);

  const rows: ChartRow[] = useMemo(() => (data.points ?? [])
    .filter((point) => granularity === 'week' || point.x <= Math.max(periodLength, 28))
    .map((point) => ({
      ...point,
      band: point.low != null && point.high != null ? [point.low, point.high] : null,
      label: xLabel(point.x),
    })), [data.points, granularity, periodLength, days]); // eslint-disable-line react-hooks/exhaustive-deps

  const seriesNames = {
    current: t(`series.current.${granularity}`),
    previous: t(`series.previous.${granularity}`),
    median: t('series.median'),
    band: t('series.band'),
  };

  const ChartTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const row: ChartRow = payload[0].payload;
    const entries: Array<[string, number | null, string]> = [
      [seriesNames.current, row.current, theme.palette.primary.main],
      [seriesNames.previous, row.previous, theme.palette.text.secondary],
      [seriesNames.median, row.median, theme.palette.text.disabled],
    ];
    return (
      <Paper sx={{ p: 1.5, minWidth: 180 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {granularity === 'week' ? row.label : t('axis.dayN', { day: row.x })}
        </Typography>
        {entries.filter(([, value]) => value != null).map(([name, value, color]) => (
          <Box key={name} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Box sx={{ width: 10, height: 2, bgcolor: color }} />
            <Typography variant="body2" sx={{ flex: 1 }}>{name}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{money(value)}</Typography>
          </Box>
        ))}
        {row.band && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
            {seriesNames.band}: {money(row.band[0])} – {money(row.band[1])}
          </Typography>
        )}
      </Paper>
    );
  };

  const legend = [
    { key: 'current', label: seriesNames.current, swatch: <Box sx={{ width: 16, height: 3, borderRadius: 1, bgcolor: 'primary.main' }} /> },
    { key: 'previous', label: seriesNames.previous, swatch: <Box sx={{ width: 16, borderTop: `2px dashed ${theme.palette.text.secondary}` }} /> },
    { key: 'median', label: t(`series.medianOf.${granularity}`, { count: comparable }), swatch: <Box sx={{ width: 16, borderTop: `2px dotted ${theme.palette.text.disabled}` }} /> },
    { key: 'band', label: seriesNames.band, swatch: <Box sx={{ width: 16, height: 10, borderRadius: 0.5, bgcolor: alpha(theme.palette.primary.main, 0.14) }} /> },
  ];

  const periods = data.periods ?? [];
  const totalsRows = periods.map((period) => ({
    ...period,
    label: formatPeriodLabel(period.key, granularity, i18n.language),
    value: period.isCurrent ? Math.max(period.total, period.projected ?? 0) : period.total,
  }));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PaceHeadline data={data} />

      <SectionCard
        title={t(`chart.title.${granularity}`, { metric: t(`metric.${data.metric}`) })}
        subtitle={t(`chart.subtitle.${granularity}`, { count: comparable })}
      >
        {comparable === 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>{t('notEnoughHistory')}</Typography>
        )}
        <ResponsiveContainer width="100%" height={300} minHeight={300}>
          <ComposedChart data={rows} margin={{ top: 10, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.4)} vertical={false} />
            <XAxis
              dataKey="label"
              stroke={theme.palette.text.secondary}
              tickLine={false}
              axisLine={false}
              style={{ fontSize: '0.75rem' }}
              interval={granularity === 'week' ? 0 : 'preserveStartEnd'}
              minTickGap={12}
            />
            <YAxis
              stroke={theme.palette.text.secondary}
              tickFormatter={compactMoney}
              tickLine={false}
              axisLine={false}
              width={56}
              style={{ fontSize: '0.75rem' }}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: theme.palette.divider }} />
            <Area
              dataKey="band"
              stroke="none"
              fill={alpha(theme.palette.primary.main, 0.14)}
              isAnimationActive={false}
              connectNulls
              name={seriesNames.band}
            />
            <Line dataKey="median" stroke={theme.palette.text.disabled} strokeWidth={1.5} strokeDasharray="2 4" dot={false} isAnimationActive={false} name={seriesNames.median} />
            <Line dataKey="previous" stroke={theme.palette.text.secondary} strokeWidth={1.5} strokeDasharray="6 4" dot={false} isAnimationActive={false} name={seriesNames.previous} />
            <Line
              dataKey="current"
              stroke={theme.palette.primary.main}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: theme.palette.background.paper }}
              connectNulls={false}
              isAnimationActive={false}
              name={seriesNames.current}
            />
            <ReferenceLine
              x={xLabel(data.pace.x)}
              stroke={alpha(theme.palette.primary.main, 0.5)}
              strokeDasharray="3 3"
              label={{ value: t('axis.today'), position: 'insideTopRight', fill: theme.palette.text.secondary, fontSize: 11 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1, justifyContent: 'center' }}>
          {legend.map((item) => (
            <Box key={item.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {item.swatch}
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{item.label}</Typography>
            </Box>
          ))}
        </Box>
      </SectionCard>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <SectionCard
            title={t('drivers.title')}
            subtitle={t(`drivers.subtitle.${granularity}`, { day: granularity === 'week' ? days[data.pace.x - 1] : data.pace.x })}
          >
            {(data.drivers ?? []).length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {comparable === 0 ? t('notEnoughHistory') : t('drivers.none')}
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                {(data.drivers ?? []).map((driver) => {
                  const color = toneColor(deltaTone(driver.delta, data.metric));
                  const scale = Math.max(...(data.drivers ?? []).map((item) => Math.abs(item.delta)), 1);
                  return (
                    <Box key={`${driver.categoryId}`}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                          {categoryLabel(driver, locale, t('uncategorized'))}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600, color }}>
                          {formatCurrency(driver.delta, { showSign: true, maximumFractionDigits: 0 })}
                        </Typography>
                      </Box>
                      <Box sx={{ height: 4, borderRadius: 2, bgcolor: alpha(theme.palette.divider, 0.4), mt: 0.5 }}>
                        <Box sx={{ height: 4, borderRadius: 2, bgcolor: color, width: `${(Math.abs(driver.delta) / scale) * 100}%` }} />
                      </Box>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {t('drivers.compare', { current: money(driver.current), typical: money(driver.typical) })}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <SectionCard title={t(`totals.title.${granularity}`)} subtitle={t('totals.subtitle')}>
            <ResponsiveContainer width="100%" height={170} minHeight={170}>
              <BarChart data={totalsRows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="20%">
                <XAxis dataKey="label" stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} style={{ fontSize: '0.7rem' }} interval={0} minTickGap={0} />
                <YAxis hide />
                <Tooltip
                  cursor={{ fill: alpha(theme.palette.primary.main, 0.06) }}
                  content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload;
                    return (
                      <Paper sx={{ p: 1.25 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{row.label}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {row.isCurrent ? t('totals.soFar', { amount: money(row.total) }) : money(row.total)}
                        </Typography>
                        {row.isCurrent && row.projected != null && (
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {t('totals.projected', { amount: money(row.projected) })}
                          </Typography>
                        )}
                      </Paper>
                    );
                  }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {totalsRows.map((row) => (
                    <Cell
                      key={row.key}
                      fill={row.isCurrent ? alpha(theme.palette.primary.main, 0.25) : alpha(theme.palette.text.secondary, 0.35)}
                      stroke={row.isCurrent ? theme.palette.primary.main : 'none'}
                      strokeDasharray={row.isCurrent ? '4 3' : undefined}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('totals.legend')}</Typography>
          </SectionCard>
          {(data.newMerchants ?? []).length > 0 && (
            <Box sx={{ mt: 2 }}>
              <SectionCard title={t(`newMerchants.title.${granularity}`)} subtitle={t('newMerchants.subtitle')}>
                {(data.newMerchants ?? []).map((merchant) => (
                  <Box key={merchant.merchant} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.5 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap>{merchant.merchant}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {categoryLabel(merchant.category, locale, t('uncategorized'))}
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{money(merchant.amount)}</Typography>
                  </Box>
                ))}
              </SectionCard>
            </Box>
          )}
        </Grid>
      </Grid>
    </Box>
  );
};

export default RhythmPeriodView;
