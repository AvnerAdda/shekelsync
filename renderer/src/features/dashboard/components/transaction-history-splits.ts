import type { DashboardChartBreakdown } from '@renderer/types/dashboard';

export type BarSplitBy = 'none' | 'subcategory' | 'vendor';
export type BarFlow = 'income' | 'expenses' | 'investments';

export interface SplitBarSeries {
  dataKey: string;
  flow: BarFlow;
  label: string;
  isForecast: boolean;
  colorIndex: number;
}

interface SplitOptions {
  includeCapitalReturns: boolean;
  includeCardRepayments: boolean;
  showForecast: boolean;
  scale: 'linear' | 'log';
  uncategorizedLabel: string;
  unknownVendorLabel: string;
}

export interface SplitBarDetail extends SplitBarSeries {
  amount: number;
}

const flows: BarFlow[] = ['income', 'expenses', 'investments'];
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const nonzero = (value: number) => Math.abs(value) > 1e-8;

/** Build three independent stacks. Amounts stay in currency for tooltip display. */
export function buildSplitBarData(
  rows: Array<Record<string, any>>,
  splitBy: Exclude<BarSplitBy, 'none'>,
  options: SplitOptions,
) {
  const unknownLabel = splitBy === 'subcategory' ? options.uncategorizedLabel : options.unknownVendorLabel;
  const groupsByFlow = new Map<BarFlow, Map<string, string>>(flows.map(flow => [flow, new Map()]));
  const groupedRows = rows.map(row => {
    const groups = new Map<BarFlow, Map<string, { label: string; amount: number }>>();
    if (row.isInGap || (row.isForecast && !options.showForecast)) return groups;

    for (const flow of flows) {
      const suffix = flow[0].toUpperCase() + flow.slice(1);
      const total = row.isForecast
        ? row[`originalForecast${suffix}`] ?? row[`forecast${suffix}`]
        : row[`original${suffix}`] ?? row[flow];
      if (total == null) continue;
      const values = new Map<string, { label: string; amount: number }>();
      const add = (key: string, label: string, amount: number) => {
        values.set(key, { label, amount: (values.get(key)?.amount || 0) + amount });
      };
      for (const item of (row.chartBreakdown || []) as DashboardChartBreakdown[]) {
        const name = splitBy === 'subcategory' ? item.categoryName?.trim() : item.vendor?.trim();
        const key = splitBy === 'subcategory' && item.categoryId != null
          ? `category:${item.categoryId}`
          : name ? `name:${name}` : 'unknown';
        let amount = number(item[flow]);
        if (!row.isForecast) {
          if (flow === 'income' && options.includeCapitalReturns) amount += number(item.capitalReturns);
          if (flow === 'expenses') {
            amount = options.includeCardRepayments
              ? amount - number(item.pairedCardExpenses) + number(item.pairedCardRepayments)
              : amount - number(item.cardRepayments);
          }
        }
        if (nonzero(amount)) add(key, name || unknownLabel, amount);
      }

      // Older or partial forecast responses can lack category/source evidence.
      // Keep their full total visible without attributing it to a known category.
      const sum = [...values.values()].reduce((acc, entry) => acc + entry.amount, 0);
      const remainder = number(total) - sum;
      if (nonzero(remainder)) add('unknown', unknownLabel, remainder);
      for (const [key, value] of values) {
        if (!nonzero(value.amount)) values.delete(key);
        else groupsByFlow.get(flow)!.set(key, value.label);
      }
      groups.set(flow, values);
    }
    return groups;
  });

  const series: SplitBarSeries[] = [];
  const lookup = new Map<string, SplitBarSeries>();
  for (const flow of flows) {
    const entries = [...groupsByFlow.get(flow)!].sort(([a], [b]) => a.localeCompare(b));
    // Even a period without one flow keeps the same three bar positions.
    if (!entries.length) entries.push(['unknown', unknownLabel]);
    entries.forEach(([key, label], colorIndex) => {
      for (const isForecast of [false, true]) {
        if (isForecast && !options.showForecast) continue;
        if (isForecast && !rows.some(row => row.isForecast)) continue;
        const item = { dataKey: `split_${flow}_${colorIndex}${isForecast ? '_forecast' : ''}`,
          flow, label, isForecast, colorIndex };
        series.push(item);
        lookup.set(JSON.stringify([flow, key, isForecast]), item);
      }
    });
  }

  const data = rows.map((row, index) => {
    const result: Record<string, any> & { splitDetails: SplitBarDetail[] } = { ...row, splitDetails: [] };
    for (const [flow, values] of groupedRows[index]) {
      const positive = [...values.values()].reduce((sum, value) => sum + Math.max(0, value.amount), 0);
      const negative = [...values.values()].reduce((sum, value) => sum + Math.max(0, -value.amount), 0);
      for (const [key, value] of values) {
        const item = lookup.get(JSON.stringify([flow, key, Boolean(row.isForecast)]))!;
        const total = value.amount < 0 ? negative : positive;
        // Log the stack total once, then retain each segment's share of that total.
        // Logging every segment independently would inflate the bar height.
        result[item.dataKey] = options.scale === 'log'
          ? value.amount / total * Math.log10(Math.max(1, total))
          : value.amount;
        result.splitDetails.push({ ...item, amount: value.amount });
      }
    }
    return result;
  });
  return { data, series };
}
