import { useMemo } from 'react';
import { alpha, Box, Button, IconButton, Paper, Stack, TextField, Tooltip as MuiTooltip, Typography, useTheme } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { Area, AreaChart, CartesianGrid, DefaultZIndexes, ReferenceLine, ResponsiveContainer, Tooltip, usePlotArea, useXAxisInverseDataSnapScale, XAxis, YAxis, ZIndexLayer } from 'recharts';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { SpendingAllocation, SpendingCategory, SpendingTimelinePoint } from '@renderer/types/spending-categories';

export const ALLOCATION_ORDER: SpendingAllocation[] = ['essential', 'growth', 'stability', 'reward', 'unallocated'];
export const ALLOCATION_COLORS: Record<SpendingAllocation, string> = {
  essential: '#2196F3', growth: '#4CAF50', stability: '#FF9800', reward: '#E91E63', unallocated: '#9E9E9E',
};

interface Props {
  points: SpendingTimelinePoint[];
  targets: Record<SpendingCategory, number>;
  selectedDate: string;
  onSelect: (date: string) => void;
}

const timestamp = (date: string) => new Date(`${date}T12:00:00`).getTime();

function DateSelection({ onSelect }: { onSelect: (time: number) => void }) {
  const plot = usePlotArea();
  const invert = useXAxisInverseDataSnapScale();
  if (!plot || !invert) return null;
  // Resolve the actual click position; the hover tooltip can lag behind a quick
  // click or still refer to the previous position after changing the window.
  return <ZIndexLayer zIndex={DefaultZIndexes.activeDot + 1}><rect x={plot.x} y={plot.y} width={plot.width} height={plot.height} fill="transparent"
    aria-hidden="true" onClick={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.width) return;
      const time = Number(invert(plot.x + (event.clientX - bounds.left) / bounds.width * plot.width));
      if (Number.isFinite(time)) onSelect(time);
    }} /></ZIndexLayer>;
}

export default function SpendingTimeline({ points, targets, selectedDate, onSelect }: Props) {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.spendingChart' });
  const { formatCurrency } = useFinancePrivacy();
  const theme = useTheme();
  const { min, max, boundaries, chartData, ticks } = useMemo(() => {
    let low = 0;
    let high = 100;
    for (const point of points) {
      const values = Object.values(point.percentages).map((value) => value || 0);
      low = Math.min(low, values.reduce((sum, value) => sum + Math.min(0, value), 0));
      high = Math.max(high, values.reduce((sum, value) => sum + Math.max(0, value), 0));
    }
    let total = 0;
    const boundaries = ALLOCATION_ORDER.filter((key): key is SpendingCategory => key !== 'unallocated').map((key) => {
      total += targets[key] || 0;
      return { key, value: total };
    });
    const chartData = points.map((point) => ({ ...point.percentages, time: timestamp(point.date), point }));
    const ticks = [...new Set(Array.from({ length: Math.min(6, points.length) }, (_, i) =>
      chartData[Math.round(i * (chartData.length - 1) / Math.max(1, Math.min(6, points.length) - 1))].time))];
    return { min: Math.floor(low / 25) * 25, max: Math.ceil(high / 25) * 25, boundaries, chartData, ticks };
  }, [points, targets]);
  const dateLabel = (value: number) => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(new Date(value));
  const selectedIndex = points.findIndex((point) => point.date === selectedDate);

  return (
    <Box>
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mb: 2 }}>
        {boundaries.map(({ key, value }) => (
          <MuiTooltip key={key} title={t('timeline.boundary', { value })}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, bgcolor: alpha(ALLOCATION_COLORS[key], 0.08), borderRadius: 1.5, px: 1, py: 0.5 }}>
              <Box sx={{ width: 8, height: 8, bgcolor: ALLOCATION_COLORS[key], borderRadius: '50%' }} />
              <Typography variant="caption" sx={{ fontWeight: 550 }}>{t(`categories.${key}`)}</Typography>
              <Typography variant="caption" color="text.secondary">{targets[key]}%</Typography>
            </Box>
          </MuiTooltip>
        ))}
        {points.some((point) => point.allocation_amounts.unallocated !== 0) && <Typography variant="caption" color="text.secondary">
          <Box component="span" sx={{ display: 'inline-block', width: 12, height: 8, bgcolor: ALLOCATION_COLORS.unallocated, mr: 0.5 }} />
          {t('categories.unallocated')}
        </Typography>}
      </Stack>
      <Box role="region" aria-label={t('timeline.chartLabel')} data-testid="spending-timeline"
        dir="ltr" sx={{ width: '100%', height: { xs: 300, sm: 360 }, minWidth: 0, direction: 'ltr',
          '& .recharts-surface:focus:not(:focus-visible)': { outline: 'none' },
          '& .recharts-surface:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 } }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={chartData} stackOffset="sign" margin={{ top: 12, right: 14, bottom: 22, left: 0 }}
            accessibilityLayer>
            <CartesianGrid vertical={false} stroke={theme.palette.divider} strokeDasharray="3 3" />
            <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={ticks}
              tickFormatter={dateLabel} minTickGap={20} fontSize={11} tickLine={false} stroke={theme.palette.text.secondary}
              label={{ value: t('timeline.timeAxis'), position: 'insideBottom', offset: -16, fill: theme.palette.text.secondary, fontSize: 12 }} />
            <YAxis type="number" domain={[min, max]} ticks={[...new Set([min, 0, 25, 50, 75, 100, max])]}
              tickFormatter={(value) => `${value}%`} width={58}
              fontSize={11} tickLine={false} axisLine={false} stroke={theme.palette.text.secondary} />
            <Tooltip filterNull={false} isAnimationActive={false}
              content={({ active, label }) => {
                const point = active ? chartData.find((entry) => entry.time === Number(label))?.point : null;
                if (!point) return null;
                return <Paper variant="outlined" sx={{ p: 2, minWidth: 265, maxWidth: 330, borderRadius: 2.5, boxShadow: 5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 650, mb: 0.5 }}>{dateLabel(timestamp(point.window_start))} – {dateLabel(timestamp(point.date))}</Typography>
                  <Typography variant="caption" component="p" sx={{ mb: 1.25 }} color="text.secondary">{t('timeline.income')}: {formatCurrency(point.income, { showSign: true, maximumFractionDigits: 2 })}</Typography>
                  {!point.has_income && <Typography variant="caption">{t('timeline.noIncomeRow')}</Typography>}
                  {ALLOCATION_ORDER.map((key) => <Box key={key} sx={{ display: 'grid', gridTemplateColumns: '8px 1fr auto auto', gap: 1, alignItems: 'center', py: 0.35 }}>
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: ALLOCATION_COLORS[key] }} />
                    <Typography variant="caption">{t(`categories.${key}`)}</Typography>
                    <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(point.allocation_amounts[key], { maximumFractionDigits: 2 })}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 42, textAlign: 'end' }}>{point.percentages[key]?.toFixed(1) ?? '—'}%</Typography>
                  </Box>)}
                  <Typography variant="caption" component="p" color="text.secondary" sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1, mt: 1 }}>{t('timeline.growthUnspent')}: {formatCurrency(point.surplus, { maximumFractionDigits: 2 })}</Typography>
                  {point.deficit > 0 && <Typography variant="caption" component="p" color="error.main">{t('timeline.deficit')}: {formatCurrency(-point.deficit, { maximumFractionDigits: 2 })}</Typography>}
                </Paper>;
              }} />
            {ALLOCATION_ORDER.map((key) => <Area key={key} type="linear" dataKey={key} name={t(`categories.${key}`)}
              stackId="allocation" stroke={ALLOCATION_COLORS[key]} strokeWidth={1.25} fill={ALLOCATION_COLORS[key]} fillOpacity={0.56}
              dot={false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />)}
            {boundaries.map(({ key, value }) => <ReferenceLine key={key} y={value} ifOverflow="extendDomain"
              shape={({ x1, y1, x2, y2 }) => <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={ALLOCATION_COLORS[key]} strokeWidth={2} strokeDasharray="6 4"
                data-testid={`target-line-${key}`} data-percentage={value} />} />)}
            <ReferenceLine y={100} stroke={theme.palette.text.primary} strokeWidth={1.5} />
            <ReferenceLine x={timestamp(selectedDate)} stroke={theme.palette.text.secondary} strokeDasharray="3 3" />
            <DateSelection onSelect={(time) => {
              const point = chartData.find((entry) => entry.time === time);
              if (point) onSelect(point.point.date);
            }} />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.5, mt: 1.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <IconButton size="small" aria-label={t('timeline.previousDay')} disabled={selectedIndex <= 0} onClick={() => onSelect(points[selectedIndex - 1].date)}><ChevronLeftIcon /></IconButton>
          <TextField label={t('timeline.inspectDate')} type="date" size="small" value={selectedDate}
          onChange={(event) => { if (points.some((point) => point.date === event.target.value)) onSelect(event.target.value); }}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: points[0]?.date, max: points.at(-1)?.date } }} />
          <IconButton size="small" aria-label={t('timeline.nextDay')} disabled={selectedIndex >= points.length - 1} onClick={() => onSelect(points[selectedIndex + 1].date)}><ChevronRightIcon /></IconButton>
          <Button size="small" onClick={() => onSelect(points.at(-1)!.date)} disabled={selectedIndex === points.length - 1}>{t('timeline.latest')}</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 260 }}>{t('timeline.chartInteraction')}</Typography>
      </Stack>
    </Box>
  );
}
