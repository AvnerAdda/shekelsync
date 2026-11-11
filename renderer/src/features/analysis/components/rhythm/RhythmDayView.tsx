import React, { useMemo, useState } from 'react';
import { Box, Grid, Paper, Typography, alpha, useTheme } from '@mui/material';
import {
  Bar, CartesianGrid, Cell, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { RhythmComparison, RhythmDay } from './types';
import { categoryLabel, formatDay, toAppLocale, weekdayNames } from './rhythm-format';
import { PaceHeadline, SectionCard } from './RhythmShared';

const RhythmDayView: React.FC<{ data: RhythmComparison }> = ({ data }) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'analysisPage.modals.rhythm.compare' });
  const { formatCurrency } = useFinancePrivacy();
  const locale = toAppLocale(i18n.language);
  const money = (value: number | null | undefined) => formatCurrency(value ?? 0, { absolute: true, maximumFractionDigits: 0 });
  const compactMoney = (value: number) => formatCurrency(value, { absolute: true, compact: true });
  const weekdays = useMemo(() => weekdayNames(i18n.language, 'long'), [i18n.language]);
  const days = data.days ?? [];
  const latestUnusual = [...days].reverse().find((day) => day.unusual);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selected = days.find((day) => day.date === selectedDate) ?? latestUnusual ?? days.at(-1) ?? null;
  const isSpend = data.metric === 'spend';

  const rows = days.map((day) => ({ ...day, label: formatDay(day.date, i18n.language) }));

  const DayTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const day: RhythmDay = payload[0].payload;
    return (
      <Paper sx={{ p: 1.5, minWidth: 190 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {weekdays[day.weekday]} · {formatDay(day.date, i18n.language)}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{money(day.value)}</Typography>
        {day.median != null && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {t('day.usualFor', { weekday: weekdays[day.weekday], median: money(day.median), low: money(day.low), high: money(day.high) })}
          </Typography>
        )}
        {day.unusual && (
          <Typography variant="caption" sx={{ color: 'warning.main', display: 'block', fontWeight: 600 }}>{t('day.unusual')}</Typography>
        )}
      </Paper>
    );
  };

  const barColor = (day: RhythmDay) => {
    if (day.unusual) return theme.palette.warning.main;
    return alpha(theme.palette.primary.main, day.date === selected?.date ? 0.9 : 0.55);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PaceHeadline data={data} />

      <SectionCard title={t('day.chartTitle', { metric: t(`metric.${data.metric}`) })} subtitle={t('day.chartSubtitle')}>
        <ResponsiveContainer width="100%" height={260} minHeight={260}>
          <ComposedChart data={rows} margin={{ top: 10, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.4)} vertical={false} />
            <XAxis dataKey="label" stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} style={{ fontSize: '0.7rem' }} minTickGap={16} />
            <YAxis stroke={theme.palette.text.secondary} tickFormatter={compactMoney} tickLine={false} axisLine={false} width={56} style={{ fontSize: '0.75rem' }} />
            <Tooltip content={<DayTooltip />} cursor={{ fill: alpha(theme.palette.primary.main, 0.06) }} />
            <Bar
              dataKey="value"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
              onClick={(entry: any) => setSelectedDate(entry?.date ?? entry?.payload?.date ?? null)}
              style={{ cursor: 'pointer' }}
            >
              {rows.map((day) => <Cell key={day.date} fill={barColor(day)} />)}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
        {isSpend && (
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: alpha(theme.palette.primary.main, 0.55) }} />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('day.legendNormal')}</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: 'warning.main' }} />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('day.legendUnusual')}</Typography>
            </Box>
          </Box>
        )}
      </SectionCard>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard
            title={selected ? `${weekdays[selected.weekday]} · ${formatDay(selected.date, i18n.language, { day: 'numeric', month: 'long' })}` : t('day.pickDay')}
            subtitle={selected?.median != null
              ? t('day.usualFor', { weekday: weekdays[selected.weekday], median: money(selected.median), low: money(selected.low), high: money(selected.high) })
              : t('day.clickHint')}
          >
            {!selected || selected.transactions.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('day.nothing')}</Typography>
            ) : selected.transactions.map((txn) => (
              <Box key={`${txn.vendor}-${txn.identifier}`} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.5 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap>{txn.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {categoryLabel({ name: txn.categoryName, nameEn: txn.categoryNameEn, nameFr: txn.categoryNameFr }, locale, t('uncategorized'))}
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{money(txn.amount)}</Typography>
              </Box>
            ))}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title={t('day.unusualTitle')} subtitle={t('day.unusualSubtitle')}>
            {days.filter((day) => day.unusual).length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('day.noUnusual')}</Typography>
            ) : [...days].reverse().filter((day) => day.unusual).map((day) => (
              <Box
                key={day.date}
                onClick={() => setSelectedDate(day.date)}
                sx={{
                  display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.75, px: 1, mx: -1, borderRadius: 1, cursor: 'pointer',
                  bgcolor: day.date === selected?.date ? alpha(theme.palette.warning.main, 0.08) : 'transparent',
                  '&:hover': { bgcolor: alpha(theme.palette.warning.main, 0.06) },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {weekdays[day.weekday]} · {formatDay(day.date, i18n.language)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap component="div">
                    {day.transactions.slice(0, 2).map((txn) => txn.name).join(' · ')}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'end' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{money(day.value)}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('day.usually', { amount: money(day.median) })}</Typography>
                </Box>
              </Box>
            ))}
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
};

export default RhythmDayView;
