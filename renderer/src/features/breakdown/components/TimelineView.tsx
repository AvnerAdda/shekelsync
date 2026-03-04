import React from 'react';
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Line, Area } from 'recharts';
import { useTheme, alpha, Box, ToggleButtonGroup, ToggleButton } from '@mui/material';
import { CHART_COLORS } from '@renderer/shared/chart-colors';
import {
  BreakdownTransaction,
  CategoryBreakdownItem,
  CategoryType,
  DailyBreakdownItem,
  DrillLevel,
  FormatCurrencyFn,
  MonthlyBreakdownItem,
  OverviewDataItem,
} from '../types';
import { getBreakdownStrings } from '../strings';

interface TimelineViewProps {
  monthlyData: MonthlyBreakdownItem[];
  dailyData?: DailyBreakdownItem[];
  transactions?: BreakdownTransaction[];
  categoryBreakdown?: CategoryBreakdownItem[];
  currentLevel?: DrillLevel | null;
  currentData?: OverviewDataItem[];
  startDate: Date;
  endDate: Date;
  categoryType: CategoryType;
  title: string;
  formatCurrencyValue: FormatCurrencyFn;
}

interface TimelineSeriesDefinition {
  id: number;
  key: string;
  name: string;
  color: string;
}

type TimelineMode = 'simple' | 'cumulative' | 'cumulativeCategory';

const formatDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toDateKey = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    return raw.slice(0, 10);
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
};

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
};

const TimelineView: React.FC<TimelineViewProps> = ({
  monthlyData,
  dailyData = [],
  transactions = [],
  categoryBreakdown = [],
  currentLevel = null,
  currentData = [],
  startDate,
  endDate,
  categoryType,
  title,
  formatCurrencyValue,
}) => {
  const theme = useTheme();
  const strings = getBreakdownStrings();
  const timelineStrings = strings.timeline;
  const [timelineMode, setTimelineMode] = React.useState<TimelineMode>('cumulative');

  const fallbackChartData = React.useMemo(() => {
    const hasDailySeries = dailyData.length > 0;

    if (hasDailySeries) {
      const sortedDaily = [...dailyData].sort((a, b) => a.date.localeCompare(b.date));
      let cumulativeTotal = 0;
      let cumulativeInflow = 0;
      let cumulativeOutflow = 0;

      return sortedDaily.map((item) => {
        const inflow = item.inflow ?? (categoryType === 'income' ? item.total : 0);
        const outflow = item.outflow ?? (categoryType === 'expense' ? item.total : 0);
        cumulativeTotal += item.total;
        cumulativeInflow += inflow;
        cumulativeOutflow += outflow;

        return {
          label: item.date,
          total: item.total,
          inflow,
          outflow,
          cumulativeTotal,
          cumulativeInflow,
          cumulativeOutflow,
        };
      });
    }

    const sortedMonthly = [...monthlyData].sort((a, b) => a.month.localeCompare(b.month));
    let cumulativeTotal = 0;
    let cumulativeInflow = 0;
    let cumulativeOutflow = 0;

    return sortedMonthly.map((item) => {
      const inflow = item.inflow ?? (categoryType === 'income' ? item.total : 0);
      const outflow = item.outflow ?? (categoryType === 'expense' ? item.total : 0);
      cumulativeTotal += item.total;
      cumulativeInflow += inflow;
      cumulativeOutflow += outflow;

      return {
        label: item.month,
        total: item.total,
        inflow,
        outflow,
        cumulativeTotal,
        cumulativeInflow,
        cumulativeOutflow,
      };
    });
  }, [dailyData, monthlyData, categoryType]);

  const drillSeriesDefinitions = React.useMemo<TimelineSeriesDefinition[]>(() => {
    if (currentLevel?.type === 'subcategory') {
      const subcategoryId = toNumberOrNull(currentLevel.subcategoryId);
      if (subcategoryId === null) {
        return [];
      }
      const parentEntry = categoryBreakdown.find((entry) => entry.parentId === currentLevel.parentId);
      const subcategoryEntry = parentEntry?.subcategories?.find((sub) => sub.id === subcategoryId);
      return [{
        id: subcategoryId,
        key: `series_${subcategoryId}`,
        name: currentLevel.subcategoryName || subcategoryEntry?.name || title,
        color: subcategoryEntry?.color || CHART_COLORS[0],
      }];
    }

    return currentData
      .map((entry, index) => {
        const id = toNumberOrNull(entry.id);
        if (id === null) return null;
        return {
          id,
          key: `series_${id}`,
          name: entry.name,
          color: entry.color || CHART_COLORS[index % CHART_COLORS.length],
        };
      })
      .filter((entry): entry is TimelineSeriesDefinition => Boolean(entry));
  }, [categoryBreakdown, currentData, currentLevel, title]);

  const drillChart = React.useMemo(() => {
    if (transactions.length === 0 || drillSeriesDefinitions.length === 0) {
      return null;
    }

    const rangeStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const rangeEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    if (!Number.isFinite(rangeStart.getTime()) || !Number.isFinite(rangeEnd.getTime()) || rangeEnd < rangeStart) {
      return null;
    }

    const dayKeys: string[] = [];
    const inRangeDays = new Set<string>();
    for (const cursor = new Date(rangeStart); cursor <= rangeEnd; cursor.setDate(cursor.getDate() + 1)) {
      const dayKey = formatDateKey(cursor);
      dayKeys.push(dayKey);
      inRangeDays.add(dayKey);
    }
    if (dayKeys.length === 0) {
      return null;
    }

    const seriesById = new Map<number, TimelineSeriesDefinition>();
    drillSeriesDefinitions.forEach((series) => {
      seriesById.set(series.id, series);
    });

    const deltaBySeries = new Map<string, Map<string, number>>();
    drillSeriesDefinitions.forEach((series) => {
      deltaBySeries.set(series.key, new Map());
    });

    const currentParentId = toNumberOrNull(currentLevel?.parentId);
    const currentSubcategoryId = toNumberOrNull(currentLevel?.subcategoryId);

    for (const tx of transactions) {
      const dayKey = toDateKey(tx.date as Date | string | null | undefined);
      if (!dayKey || !inRangeDays.has(dayKey)) {
        continue;
      }

      const txParentId = toNumberOrNull(tx.parent_id ?? tx.parentId);
      const txSubcategoryId = toNumberOrNull(tx.subcategory_id ?? tx.subcategoryId);
      let targetId: number | null = null;

      if (!currentLevel) {
        targetId = txParentId;
      } else if (currentLevel.type === 'parent') {
        if (currentParentId !== null && txParentId !== currentParentId) {
          continue;
        }
        targetId = txSubcategoryId ?? txParentId;
      } else {
        if (currentSubcategoryId === null || txSubcategoryId !== currentSubcategoryId) {
          continue;
        }
        targetId = currentSubcategoryId;
      }

      if (targetId === null) {
        continue;
      }

      const series = seriesById.get(targetId);
      if (!series) {
        continue;
      }

      const txPrice = Number(tx.price ?? 0);
      if (!Number.isFinite(txPrice)) {
        continue;
      }
      const amount = categoryType === 'income' ? txPrice : Math.abs(txPrice);
      const seriesDelta = deltaBySeries.get(series.key);
      if (!seriesDelta) {
        continue;
      }
      seriesDelta.set(dayKey, (seriesDelta.get(dayKey) || 0) + amount);
    }

    let hasAnyValue = false;
    const runningTotals = new Map<string, number>();
    let totalRunning = 0;

    const rows = dayKeys.map((dayKey) => {
      const row: Record<string, string | number> = { label: dayKey };
      let dayTotal = 0;

      drillSeriesDefinitions.forEach((series) => {
        const dayDelta = deltaBySeries.get(series.key)?.get(dayKey) || 0;
        const nextTotal = (runningTotals.get(series.key) || 0) + dayDelta;
        runningTotals.set(series.key, nextTotal);
        row[`${series.key}_simple`] = dayDelta;
        row[`${series.key}_cumulative`] = nextTotal;
        dayTotal += dayDelta;

        if (timelineMode === 'simple' && dayDelta > 0) {
          hasAnyValue = true;
        }
        if (timelineMode === 'cumulativeCategory' && nextTotal > 0) {
          hasAnyValue = true;
        }
      });

      totalRunning += dayTotal;
      row.total_simple = dayTotal;
      row.total_cumulative = totalRunning;
      if (timelineMode === 'cumulative' && totalRunning > 0) {
        hasAnyValue = true;
      }

      return row;
    });

    if (!hasAnyValue) {
      return null;
    }

    return { rows, series: drillSeriesDefinitions };
  }, [transactions, drillSeriesDefinitions, startDate, endDate, currentLevel, categoryType, timelineMode]);

  const chartData = (drillChart?.rows ?? fallbackChartData) as Array<Record<string, string | number>>;
  const activeSeries = drillChart?.series ?? [];

  const useCumulativeFallback = timelineMode !== 'simple';
  const totalDataKey = useCumulativeFallback ? 'cumulativeTotal' : 'total';
  const inflowDataKey = useCumulativeFallback ? 'cumulativeInflow' : 'inflow';
  const outflowDataKey = useCumulativeFallback ? 'cumulativeOutflow' : 'outflow';
  const drillDataKeySuffix = timelineMode === 'cumulativeCategory' ? '_cumulative' : '_simple';

  const hasInflow = !drillChart && fallbackChartData.some((entry) => Number(entry[inflowDataKey as keyof typeof entry] ?? 0) > 0);
  const hasOutflow = !drillChart && fallbackChartData.some((entry) => Number(entry[outflowDataKey as keyof typeof entry] ?? 0) > 0);
  const shouldFallbackToTotal = !hasInflow && !hasOutflow;

  const formatXAxisLabel = React.useCallback((value: string | number) => {
    const label = String(value ?? '');
    if (label.length === 10 && label[4] === '-' && label[7] === '-') {
      return label.slice(5);
    }
    return label;
  }, []);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={timelineMode}
          onChange={(_, mode: TimelineMode | null) => {
            if (mode) {
              setTimelineMode(mode);
            }
          }}
        >
          <ToggleButton value="simple">{timelineStrings.simpleMode}</ToggleButton>
          <ToggleButton value="cumulativeCategory">{timelineStrings.cumulativeCategoryMode}</ToggleButton>
          <ToggleButton value="cumulative">{timelineStrings.cumulativeMode}</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <ResponsiveContainer width="100%" height={400} minHeight={400}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tickFormatter={formatXAxisLabel} minTickGap={20} />
          <YAxis tickFormatter={(value) => formatCurrencyValue(typeof value === 'number' ? value : Number(value ?? 0))} />
          <Tooltip
            formatter={(value) => formatCurrencyValue(typeof value === 'number' ? value : Number(value ?? 0))}
            labelFormatter={(value) => String(value ?? '')}
            contentStyle={{
              backgroundColor: alpha(theme.palette.background.paper, 0.8),
              backdropFilter: 'blur(8px)',
              borderRadius: 8,
              border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
              boxShadow: theme.shadows[4],
            }}
          />
          <Legend />
          {drillChart ? (
            timelineMode === 'cumulative' ? (
              <>
                {activeSeries.map((series) => (
                  <Area
                    key={`${series.key}_stack`}
                    type="monotone"
                    dataKey={`${series.key}_cumulative`}
                    name={series.name}
                    stroke={series.color}
                    fill={alpha(series.color, 0.26)}
                    strokeWidth={1.2}
                    stackId="cumulative"
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey="total_cumulative"
                  stroke={theme.palette.text.primary}
                  strokeWidth={2}
                  name={timelineStrings.fallbackLegend}
                  dot={false}
                />
              </>
            ) : (
              activeSeries.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={`${series.key}${drillDataKeySuffix}`}
                  stroke={series.color}
                  strokeWidth={2}
                  name={series.name}
                  dot={false}
                />
              ))
            )
          ) : (
            shouldFallbackToTotal ? (
              <Line
                type="monotone"
                dataKey={totalDataKey}
                stroke={theme.palette.primary.main}
                strokeWidth={2}
                name={timelineStrings.fallbackLegend}
              />
            ) : (
              <>
                {hasOutflow && (
                  <Line
                    type="monotone"
                    dataKey={outflowDataKey}
                    stroke={theme.palette.error.main}
                    strokeWidth={2}
                    name={categoryType === 'income' ? timelineStrings.outflow : title}
                  />
                )}
                {hasInflow && (
                  <Line
                    type="monotone"
                    dataKey={inflowDataKey}
                    stroke={theme.palette.success.main}
                    strokeWidth={2}
                    name={categoryType === 'expense' ? timelineStrings.income : timelineStrings.inflow}
                  />
                )}
              </>
            )
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </Box>
  );
};

export default TimelineView;
