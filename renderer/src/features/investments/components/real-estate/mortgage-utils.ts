import type {
  MortgageDraft,
  MortgageSchedule,
  MortgageTrack,
  MortgageTrackType,
  MortgageView,
} from '@renderer/types/investments';

export interface TrackTypeMeta {
  /** Rate entered by the user (fixed tracks, current rate of variable tracks). */
  needsRate: boolean;
  /** Margin over prime / anchor. */
  needsMargin: boolean;
  /** Rate resets every N months. */
  variable: boolean;
  /** Principal linked to the CPI. */
  cpiLinked: boolean;
}

export const TRACK_TYPES: MortgageTrackType[] = [
  'prime',
  'fixed_unlinked',
  'fixed_cpi',
  'variable_unlinked',
  'variable_cpi',
];

export const TRACK_TYPE_META: Record<MortgageTrackType, TrackTypeMeta> = {
  prime: { needsRate: false, needsMargin: true, variable: false, cpiLinked: false },
  fixed_unlinked: { needsRate: true, needsMargin: false, variable: false, cpiLinked: false },
  fixed_cpi: { needsRate: true, needsMargin: false, variable: false, cpiLinked: true },
  variable_unlinked: { needsRate: true, needsMargin: true, variable: true, cpiLinked: false },
  variable_cpi: { needsRate: true, needsMargin: true, variable: true, cpiLinked: true },
  fx_linked: { needsRate: true, needsMargin: false, variable: false, cpiLinked: false },
  legacy: { needsRate: true, needsMargin: false, variable: false, cpiLinked: false },
};

export const TRACK_TYPE_FALLBACK_LABELS: Record<MortgageTrackType, string> = {
  prime: 'Prime',
  fixed_unlinked: 'Fixed, unlinked (קל"צ)',
  fixed_cpi: 'Fixed, CPI-linked (ק"צ)',
  variable_unlinked: 'Variable, unlinked',
  variable_cpi: 'Variable, CPI-linked',
  fx_linked: 'Foreign currency',
  legacy: 'Mortgage (single)',
};

/** Categorical slots (reference data-viz palette), assigned by track order, never cycled. */
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export function seriesColor(index: number, mode: 'light' | 'dark'): string {
  const palette = mode === 'dark' ? SERIES_DARK : SERIES_LIGHT;
  return palette[Math.min(index, palette.length - 1)];
}

export function nominalToEffective(nominalPct: number): number {
  return (Math.pow(1 + nominalPct / 1200, 12) - 1) * 100;
}

export function effectiveToNominal(effectivePct: number): number {
  return (Math.pow(1 + effectivePct / 100, 1 / 12) - 1) * 1200;
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addMonthsIso(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

export function createEmptyTrack(type: MortgageTrackType = 'prime', today = todayIso()): MortgageTrack {
  const meta = TRACK_TYPE_META[type];
  return {
    type,
    label: null,
    rate: null,
    margin: meta.needsMargin ? (type === 'prime' ? -0.5 : 1) : null,
    rateConvention: 'nominal',
    resetPeriodMonths: meta.variable ? 60 : null,
    amortization: 'spitzer',
    termMonths: 360,
    firstPaymentDate: addMonthsIso(today, 1),
    grace: { type: 'none', endDate: null },
    cpiFloorAtBase: false,
    anchor: null,
    tranches: [{ drawDate: today, amount: null, status: 'drawn', rate: null, termMode: 'same_maturity' }],
  };
}

/**
 * New track that reuses an existing track's schedule (draw date, first
 * payment, term): tracks of one mortgage are almost always drawn and paid
 * together.
 */
export function createTrackLike(reference: MortgageTrack | undefined, type: MortgageTrackType, today = todayIso()): MortgageTrack {
  const track = createEmptyTrack(type, today);
  if (!reference) return track;
  const drawn = reference.tranches.find((tranche) => tranche.status === 'drawn') || reference.tranches[0];
  return {
    ...track,
    termMonths: reference.termMonths,
    firstPaymentDate: reference.firstPaymentDate ?? track.firstPaymentDate,
    paymentDay: reference.paymentDay ?? null,
    tranches: [{ ...track.tranches[0], drawDate: drawn?.drawDate || today }],
  };
}

export function createEmptyDraft(today = todayIso()): MortgageDraft {
  return { tracks: [createEmptyTrack('prime', today)], events: [], options: { brokenPeriodInterest: 'monthly' } };
}

/** Change a track's type, resetting fields that no longer apply. */
export function changeTrackType(track: MortgageTrack, type: MortgageTrackType): MortgageTrack {
  const meta = TRACK_TYPE_META[type];
  return {
    ...track,
    type,
    rate: meta.needsRate ? track.rate ?? null : null,
    margin: meta.needsMargin ? (track.margin ?? (type === 'prime' ? -0.5 : 1)) : null,
    resetPeriodMonths: meta.variable ? (track.resetPeriodMonths ?? 60) : null,
    cpiFloorAtBase: meta.cpiLinked ? Boolean(track.cpiFloorAtBase) : false,
  };
}

/** Starting draft for the editor from a mortgage view. */
export function draftFromView(view: MortgageView | null, today = todayIso()): MortgageDraft {
  if (view?.mortgage && view.mortgage.tracks.length > 0) {
    return JSON.parse(JSON.stringify(view.mortgage)) as MortgageDraft;
  }
  const legacyTrack = view?.legacy?.track;
  if (legacyTrack) {
    // Pre-fill one fixed track from the single-mortgage fields.
    const tranche = legacyTrack.tranches[0];
    return {
      tracks: [{
        ...createEmptyTrack('fixed_unlinked', today),
        rate: legacyTrack.rate ?? null,
        termMonths: legacyTrack.termMonths,
        firstPaymentDate: legacyTrack.firstPaymentDate ?? null,
        tranches: [{ drawDate: tranche.drawDate, amount: tranche.amount, status: 'drawn', rate: null, termMode: 'same_maturity' }],
        anchor: null,
      }],
      events: [],
      options: { brokenPeriodInterest: 'monthly' },
    };
  }
  const draft = createEmptyDraft(today);
  if (view?.legacy?.balance) draft.tracks[0].tranches[0].amount = view.legacy.balance;
  return draft;
}

/**
 * Remove a track and re-index events that point at tracks by position:
 * `trackIndex` and a refinance's `closeTrackIndexes`. Events left without a
 * track (or a refinance closing nothing) are dropped.
 */
export function removeTrackFromDraft(draft: MortgageDraft, index: number): Pick<MortgageDraft, 'tracks' | 'events'> {
  const shift = (value: number) => (value > index ? value - 1 : value);
  const events = draft.events
    .filter((event) => event.trackIndex !== index)
    .map((event) => ({
      ...event,
      trackIndex: event.trackIndex === null || event.trackIndex === undefined ? null : shift(event.trackIndex),
      closeTrackIndexes: event.closeTrackIndexes
        ? event.closeTrackIndexes.filter((value) => value !== index).map(shift)
        : event.closeTrackIndexes,
    }))
    .filter((event) => event.type !== 'refinance' || (event.closeTrackIndexes && event.closeTrackIndexes.length > 0));
  return { tracks: draft.tracks.filter((_, trackIndex) => trackIndex !== index), events };
}

export function trancheTotals(track: MortgageTrack): { drawn: number; planned: number } {
  return track.tranches.reduce((totals, tranche) => {
    const amount = Number(tranche.amount) || 0;
    if (tranche.status === 'planned') totals.planned += amount;
    else totals.drawn += amount;
    return totals;
  }, { drawn: 0, planned: 0 });
}

/**
 * Off-plan helper: add a planned drawdown on `drawDate` split across tracks in
 * proportion to what each already drew. Fixed-rate tranches leave the rate
 * empty so the backend assumes the market average at draw time.
 */
export function addRemainingAtDelivery(draft: MortgageDraft, drawDate: string, amount: number): MortgageDraft {
  const drawnByTrack = draft.tracks.map((track) => trancheTotals(track).drawn);
  const totalDrawn = drawnByTrack.reduce((sum, value) => sum + value, 0);
  if (!(amount > 0) || totalDrawn <= 0) return draft;
  let allocated = 0;
  const tracks = draft.tracks.map((track, index) => {
    const isLast = index === draft.tracks.length - 1;
    const share = isLast ? amount - allocated : Math.round(amount * (drawnByTrack[index] / totalDrawn));
    allocated += share;
    if (share <= 0) return track;
    return {
      ...track,
      tranches: [...track.tranches, { drawDate, amount: share, status: 'planned' as const, rate: null, termMode: 'same_maturity' as const }],
    };
  });
  return { ...draft, tracks };
}

function daysBetweenIso(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

export interface TrackDateIssue {
  kind: 'on_or_before_draw' | 'long_gap';
  firstDraw: string;
  firstPayment: string;
  days: number;
  suggested: string;
}

/**
 * The first payment is normally one month after the first draw. Flags a first
 * payment on/before the draw, or more than 45 days after it (without grace).
 */
export function trackDateIssue(track: MortgageTrack, brokenPeriodInterest?: string): TrackDateIssue | null {
  const draws = track.tranches.map((tranche) => tranche.drawDate).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date || '')).sort();
  const firstDraw = draws[0];
  const firstPayment = track.firstPaymentDate || null;
  if (!firstDraw || !firstPayment || !/^\d{4}-\d{2}-\d{2}$/.test(firstPayment)) return null;
  const days = daysBetweenIso(firstDraw, firstPayment);
  if (brokenPeriodInterest === 'separate') {
    // Interest to the next payment day is charged apart; regular payments
    // start one month after that payment day.
    const paymentDay = Number(firstPayment.slice(8, 10));
    const sameMonth = `${firstDraw.slice(0, 8)}${String(paymentDay).padStart(2, '0')}`;
    const nextPaymentDay = firstDraw < sameMonth ? sameMonth : addMonthsIso(sameMonth, 1);
    const expected = firstDraw === sameMonth ? addMonthsIso(firstDraw, 1) : addMonthsIso(nextPaymentDay, 1);
    if (days <= 0) return { kind: 'on_or_before_draw', firstDraw, firstPayment, days, suggested: expected };
    if (firstPayment > addMonthsIso(expected, 0) && daysBetweenIso(expected, firstPayment) > 10 && (!track.grace || track.grace.type === 'none')) {
      return { kind: 'long_gap', firstDraw, firstPayment, days, suggested: expected };
    }
    return null;
  }
  const suggested = addMonthsIso(firstDraw, 1);
  if (days <= 0) return { kind: 'on_or_before_draw', firstDraw, firstPayment, days, suggested };
  if (days > 45 && (!track.grace || track.grace.type === 'none')) return { kind: 'long_gap', firstDraw, firstPayment, days, suggested };
  return null;
}

/** Copy one track's first draw date and first payment date to every other track. */
export function applyDatesToAllTracks(draft: MortgageDraft, sourceIndex: number): MortgageDraft {
  const source = draft.tracks[sourceIndex];
  if (!source) return draft;
  const sourceDraw = [...source.tranches].filter((tranche) => tranche.status !== 'planned').map((tranche) => tranche.drawDate).sort()[0]
    || source.tranches[0]?.drawDate;
  return {
    ...draft,
    tracks: draft.tracks.map((track, index) => {
      if (index === sourceIndex) return track;
      const firstDrawn = track.tranches.findIndex((tranche) => tranche.status !== 'planned');
      return {
        ...track,
        firstPaymentDate: source.firstPaymentDate ?? track.firstPaymentDate,
        paymentDay: source.paymentDay ?? track.paymentDay ?? null,
        tranches: track.tranches.map((tranche, position) => (position === firstDrawn && sourceDraw ? { ...tranche, drawDate: sourceDraw } : tranche)),
      };
    }),
  };
}

/** Total of planned drawdowns, and how it is split between tracks today. */
export function plannedByTrack(draft: MortgageDraft): { total: number; byTrack: Array<{ index: number; amount: number }>; firstDate: string | null } {
  let total = 0;
  let firstDate: string | null = null;
  const byTrack = draft.tracks.map((track, index) => {
    const planned = track.tranches.filter((tranche) => tranche.status === 'planned');
    const amount = planned.reduce((sum, tranche) => sum + (Number(tranche.amount) || 0), 0);
    for (const tranche of planned) if (tranche.drawDate && (!firstDate || tranche.drawDate < firstDate)) firstDate = tranche.drawDate;
    total += amount;
    return { index, amount };
  }).filter((item) => item.amount > 0);
  return { total, byTrack, firstDate };
}

/** Remove every planned drawdown and add their total back split with the drawn mix. */
export function resplitPlannedDrawdowns(draft: MortgageDraft, drawDate: string): MortgageDraft {
  const { total } = plannedByTrack(draft);
  if (!(total > 0)) return draft;
  const withoutPlanned = {
    ...draft,
    tracks: draft.tracks.map((track) => ({ ...track, tranches: track.tranches.filter((tranche) => tranche.status !== 'planned') })),
  };
  return addRemainingAtDelivery(withoutPlanned, drawDate, total);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Strip UI-only state and coerce numbers before sending to the API. */
export function toMortgagePayload(draft: MortgageDraft): MortgageDraft {
  return {
    lender: draft.lender || null,
    label: draft.label || null,
    approvedAmount: numberOrNull(draft.approvedAmount),
    options: draft.options || { brokenPeriodInterest: 'monthly' },
    // Keep the saved bank-debit matcher when tracks are edited.
    paymentMatch: draft.paymentMatch || null,
    notes: draft.notes || null,
    tracks: draft.tracks.map((track) => ({
      type: track.type,
      label: track.label || null,
      rate: numberOrNull(track.rate),
      margin: numberOrNull(track.margin),
      rateConvention: track.rateConvention,
      resetPeriodMonths: numberOrNull(track.resetPeriodMonths),
      amortization: track.amortization,
      termMonths: numberOrNull(track.termMonths),
      paymentDay: numberOrNull(track.paymentDay),
      firstPaymentDate: track.firstPaymentDate || null,
      grace: track.grace?.type && track.grace.type !== 'none'
        ? { type: track.grace.type, endDate: track.grace.endDate || null }
        : { type: 'none', endDate: null },
      cpiFloorAtBase: Boolean(track.cpiFloorAtBase),
      anchor: track.anchor?.date && numberOrNull(track.anchor.balance) !== null
        ? {
          date: track.anchor.date,
          balance: numberOrNull(track.anchor.balance),
          remainingMonths: numberOrNull(track.anchor.remainingMonths),
          payment: numberOrNull(track.anchor.payment),
        }
        : null,
      status: track.status || 'active',
      tranches: track.tranches.map((tranche) => ({
        drawDate: tranche.drawDate,
        amount: numberOrNull(tranche.amount),
        status: tranche.status,
        rate: numberOrNull(tranche.rate),
        termMode: tranche.termMode || 'same_maturity',
        termMonths: numberOrNull(tranche.termMonths),
        notes: tranche.notes || null,
      })),
    })),
    events: draft.events.map((event) => ({
      type: event.type,
      date: event.date,
      trackIndex: event.trackIndex,
      amount: numberOrNull(event.amount),
      mode: event.mode || null,
      fee: numberOrNull(event.fee),
      rate: numberOrNull(event.rate),
      closeTrackIndexes: event.closeTrackIndexes || null,
      notes: event.notes || null,
    })),
  };
}

/** Client-side completeness check so the preview only fires on drafts the API can accept. */
export function isDraftComputable(draft: MortgageDraft): boolean {
  if (draft.tracks.length === 0) return false;
  return draft.tracks.every((track) => {
    const meta = TRACK_TYPE_META[track.type];
    if (!(Number(track.termMonths) > 0)) return false;
    if (meta.needsMargin && numberOrNull(track.margin) === null) return false;
    if (meta.needsRate && numberOrNull(track.rate) === null) return false;
    if (track.grace?.type && track.grace.type !== 'none' && !track.grace.endDate) return false;
    return track.tranches.length > 0
      && track.tranches.every((tranche) => /^\d{4}-\d{2}-\d{2}$/.test(tranche.drawDate) && Number(tranche.amount) > 0);
  });
}

export interface PropertyValueContext {
  marketValue: number | null;
  ownershipPercentage: number;
  annualGrowthPct: number;
  valuationDate: string | null;
}

export interface BalanceChartPoint {
  month: string;
  balance: number;
  equity: number | null;
  value: number | null;
  projected: boolean;
  [trackId: string]: number | string | boolean | null;
}

function monthsBetween(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  return (ty * 12 + tm) - (fy * 12 + fm);
}

/**
 * Monthly balance per track plus the owner's equity (owned value − owned debt),
 * with the property value compounded from its valuation date at the expected growth.
 */
export function buildBalanceChartData(schedule: MortgageSchedule | null, property: PropertyValueContext | null): BalanceChartPoint[] {
  if (!schedule) return [];
  const ownership = (property?.ownershipPercentage || 100) / 100;
  const valuationMonth = (property?.valuationDate || schedule.asOf).slice(0, 7);
  const growth = (property?.annualGrowthPct ?? 0) / 100;
  return schedule.monthly.map((point) => {
    const value = property?.marketValue
      ? property.marketValue * Math.pow(1 + growth, monthsBetween(valuationMonth, point.month) / 12)
      : null;
    const row: BalanceChartPoint = {
      month: point.month,
      balance: point.balance,
      value: value === null ? null : Math.round(value),
      equity: value === null ? null : Math.round((value - point.balance) * ownership),
      projected: point.projected,
    };
    for (const [trackId, balance] of Object.entries(point.byTrack)) row[`track_${trackId}`] = balance;
    return row;
  });
}

export interface YearlyCompositionPoint {
  year: string;
  interest: number;
  principal: number;
  indexation: number;
  payment: number;
  endBalance: number;
  projected: boolean;
}

export function buildYearlyComposition(schedule: MortgageSchedule | null): YearlyCompositionPoint[] {
  if (!schedule) return [];
  const byYear = new Map<string, YearlyCompositionPoint>();
  for (const point of schedule.monthly) {
    const year = point.month.slice(0, 4);
    const bucket = byYear.get(year) || { year, interest: 0, principal: 0, indexation: 0, payment: 0, endBalance: 0, projected: false };
    bucket.interest += point.interest;
    bucket.principal += point.principal + point.prepayment;
    bucket.indexation += point.indexation;
    bucket.payment += point.payment;
    bucket.endBalance = point.balance;
    bucket.projected = bucket.projected || point.projected;
    byYear.set(year, bucket);
  }
  return Array.from(byYear.values()).map((bucket) => ({
    ...bucket,
    interest: Math.round(bucket.interest),
    principal: Math.round(bucket.principal),
    indexation: Math.round(bucket.indexation),
    payment: Math.round(bucket.payment),
    endBalance: Math.round(bucket.endBalance),
  }));
}
