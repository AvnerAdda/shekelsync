/** Plans (savings goals, What-if scenarios) layered on the cash-flow outlook. */

export interface PlanOverlayDay {
  date: string;
  scenario_change: number;
  external_contributions: number;
  included_contributions?: number;
  reserved_floor: number;
}

export interface PlanOverlay {
  as_of_date: string;
  status: 'ready' | 'incomplete';
  spending_period_end: string | null;
  available_spend: number | null;
  available_spend_baseline: number | null;
  shortfall: number | null;
  cash_buffer: number;
  reserved_cash: number;
  include_goals: boolean;
  starting_floor: number;
  daily: PlanOverlayDay[];
  scenarios: Array<{ id: number; name: string; selected: boolean }>;
  goals: Array<{ id: number; name: string; reserve_location: 'included_cash' | 'external'; monthly_contribution: number; remaining_amount: number }>;
}

export interface PlanSelection {
  goals: boolean;
  scenarioIds: number[];
}

export interface OutlookRow {
  date: string;
  historicalCumulative: number | null;
  expectedCumulative: number | null;
  [key: string]: unknown;
}

export interface PlannedOutlook<Row extends OutlookRow> {
  rows: Array<Row & { plannedCumulative: number | null; reservedFloor: number | null }>;
  plannedEnding: number | null;
  plannedLowest: { date: string; value: number } | null;
  expectedEnding: number | null;
  /** First day the planned balance falls below the reserved floor. */
  dipDate: string | null;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function isPlanOverlay(value: unknown): value is PlanOverlay {
  const overlay = value as PlanOverlay | null;
  return Boolean(overlay) && Array.isArray(overlay?.daily) && Array.isArray(overlay?.scenarios) && finite(overlay?.starting_floor);
}

/** Whether any selected plan can move the curve. */
export function hasActivePlans(overlay: PlanOverlay | null, selection: PlanSelection): boolean {
  if (!overlay) return false;
  const known = new Set(overlay.scenarios.map(scenario => scenario.id));
  return (selection.goals && overlay.goals.length > 0) || selection.scenarioIds.some(id => known.has(id));
}

/**
 * Adds `plannedCumulative` (expected balance + scenario changes − external goal
 * contributions) and `reservedFloor` to the forecast rows. History rows are
 * left untouched except today's anchor, where both curves start.
 */
export function applyPlanOverlay<Row extends OutlookRow>(
  rows: Row[],
  overlay: PlanOverlay | null,
  startingBalance: number | null | undefined,
): PlannedOutlook<Row> {
  const empty = { plannedCumulative: null, reservedFloor: null };
  const anchorIndex = rows.reduce((found, row, index) => (row.historicalCumulative !== null ? index : found), -1);
  if (!overlay || !finite(startingBalance)) {
    return { rows: rows.map(row => ({ ...row, ...empty })), plannedEnding: null, plannedLowest: null, expectedEnding: null, dipDate: null };
  }
  const days = [...overlay.daily].sort((left, right) => left.date.localeCompare(right.date));
  let pointer = 0;
  let delta = 0;
  let floor = overlay.starting_floor;
  let plannedEnding: number | null = null;
  let expectedEnding: number | null = null;
  let plannedLowest: { date: string; value: number } | null = null;
  let dipDate: string | null = null;
  const result = rows.map((row, index) => {
    const isAnchor = index === anchorIndex;
    if (!isAnchor && (index < anchorIndex || row.historicalCumulative !== null)) return { ...row, ...empty };
    while (pointer < days.length && days[pointer].date <= row.date) {
      const day = days[pointer];
      // Plan days start tomorrow, so nothing before today's anchor moves the curve.
      delta += (Number(day.scenario_change) || 0) - (Number(day.external_contributions) || 0);
      if (finite(day.reserved_floor)) floor = day.reserved_floor;
      pointer += 1;
    }
    const expected = isAnchor ? startingBalance : row.expectedCumulative;
    if (!finite(expected)) return { ...row, ...empty };
    const planned = Math.round((expected + delta) * 100) / 100;
    plannedEnding = planned;
    expectedEnding = expected;
    if (!plannedLowest || planned < plannedLowest.value) plannedLowest = { date: row.date, value: planned };
    if (!dipDate && planned < floor) dipDate = row.date;
    return { ...row, plannedCumulative: planned, reservedFloor: floor };
  });
  return { rows: result, plannedEnding, plannedLowest, expectedEnding, dipDate };
}

/** Forecast horizon in days from the extended forecast period (7–365). */
export function overlayHorizon(period: { start?: string; end?: string; days?: number } | null | undefined, today = new Date()): number {
  let days = finite(period?.days) ? period!.days! : NaN;
  if (!Number.isFinite(days) && period?.end) {
    const end = Date.parse(`${period.end}T12:00:00`);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime();
    days = Math.round((end - start) / 86_400_000);
  }
  if (!Number.isFinite(days)) days = 183;
  return Math.min(365, Math.max(7, Math.round(days)));
}
