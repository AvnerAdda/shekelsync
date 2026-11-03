import { describe, expect, it } from 'vitest';
import type { MortgageSchedule } from '@renderer/types/investments';
import {
  addRemainingAtDelivery,
  buildBalanceChartData,
  buildYearlyComposition,
  changeTrackType,
  createEmptyDraft,
  createEmptyTrack,
  draftFromView,
  effectiveToNominal,
  isDraftComputable,
  nominalToEffective,
  removeTrackFromDraft,
  applyDatesToAllTracks,
  plannedByTrack,
  resplitPlannedDrawdowns,
  trackDateIssue,
  toMortgagePayload,
} from '../mortgage-utils';

describe('mortgage-utils', () => {
  it('converts nominal and effective rates both ways', () => {
    expect(nominalToEffective(4)).toBeCloseTo(4.074, 3);
    expect(effectiveToNominal(nominalToEffective(4.54))).toBeCloseTo(4.54, 8);
  });

  it('resets fields that do not apply when the track type changes', () => {
    const fixed = { ...createEmptyTrack('fixed_unlinked', '2026-01-01'), rate: 4.5 };
    const prime = changeTrackType(fixed, 'prime');
    expect(prime.rate).toBeNull();
    expect(prime.margin).toBe(-0.5);
    const variable = changeTrackType(fixed, 'variable_cpi');
    expect(variable.rate).toBe(4.5);
    expect(variable.resetPeriodMonths).toBe(60);
  });

  it('splits the remaining off-plan drawdown in the same proportions', () => {
    const draft = createEmptyDraft('2026-09-10');
    draft.tracks = [
      { ...createEmptyTrack('variable_cpi', '2026-09-10'), rate: 2.63, tranches: [{ drawDate: '2026-09-10', amount: 117500, status: 'drawn' }] },
      { ...createEmptyTrack('prime', '2026-09-10'), tranches: [{ drawDate: '2026-09-10', amount: 500000, status: 'drawn' }] },
      { ...createEmptyTrack('fixed_unlinked', '2026-09-10'), rate: 4.54, tranches: [{ drawDate: '2026-09-10', amount: 745500, status: 'drawn' }] },
    ];
    const next = addRemainingAtDelivery(draft, '2026-12-10', 681500);
    const planned = next.tracks.map((track) => track.tranches[1]);
    expect(planned.map((tranche) => tranche.status)).toEqual(['planned', 'planned', 'planned']);
    expect(planned.reduce((sum, tranche) => sum + Number(tranche.amount), 0)).toBe(681500);
    expect(planned[0].amount).toBe(58750);
    expect(planned[1].amount).toBe(250000);
    expect(planned[2].rate).toBeNull();
  });

  it('prefills a single fixed track from a legacy projection', () => {
    const draft = draftFromView({
      accountId: 1, asOf: '2026-11-01', source: 'legacy', mortgage: null, summary: null, schedule: null, scenario: {},
      legacy: { track: { ...createEmptyTrack('legacy'), rate: 5, termMonths: 120, tranches: [{ drawDate: '2026-06-01', amount: 100000, status: 'drawn' }] } },
    });
    expect(draft.tracks[0]).toMatchObject({ type: 'fixed_unlinked', rate: 5, termMonths: 120 });
    expect(draft.tracks[0].tranches[0].amount).toBe(100000);
  });

  it('only marks complete drafts as computable and coerces the payload', () => {
    const draft = createEmptyDraft('2026-01-01');
    expect(isDraftComputable(draft)).toBe(false); // no amount yet
    draft.tracks[0].tranches[0].amount = 1000;
    expect(isDraftComputable(draft)).toBe(true);
    draft.tracks[0].grace = { type: 'partial', endDate: null };
    expect(isDraftComputable(draft)).toBe(false);
    const payload = toMortgagePayload({ ...draft, approvedAmount: '2000' as unknown as number });
    expect(payload.approvedAmount).toBe(2000);
    expect(payload.tracks[0].grace).toEqual({ type: 'partial', endDate: null });
  });

  it('builds balance/equity and yearly composition series', () => {
    const schedule = {
      asOf: '2026-11-01',
      monthly: [
        { month: '2026-11', payment: 100, interest: 60, principal: 40, indexation: 5, prepayment: 0, fees: 0, drawn: 0, balance: 1000, byTrack: { 1: 600, 2: 400 }, projected: true },
        { month: '2027-11', payment: 100, interest: 50, principal: 50, indexation: 0, prepayment: 0, fees: 0, drawn: 0, balance: 900, byTrack: { 1: 550, 2: 350 }, projected: true },
      ],
    } as unknown as MortgageSchedule;
    const points = buildBalanceChartData(schedule, { marketValue: 2000, ownershipPercentage: 50, annualGrowthPct: 10, valuationDate: '2026-11-01' });
    expect(points[0]).toMatchObject({ track_1: 600, track_2: 400, value: 2000, equity: 500 });
    expect(points[1].value).toBe(2200);
    expect(points[1].equity).toBe(650);
    const yearly = buildYearlyComposition(schedule);
    expect(yearly.map((row) => row.year)).toEqual(['2026', '2027']);
    expect(yearly[0]).toMatchObject({ interest: 60, principal: 40, indexation: 5, endBalance: 1000 });
  });

  it('re-indexes refinance and prepayment events when a track is removed', () => {
    const draft = createEmptyDraft('2026-01-01');
    draft.tracks = [createEmptyTrack('prime'), createEmptyTrack('fixed_unlinked'), createEmptyTrack('fixed_unlinked')];
    draft.events = [
      { type: 'refinance', date: '2026-06-10', trackIndex: null, closeTrackIndexes: [1] },
      { type: 'prepay_partial', date: '2026-07-01', trackIndex: 2, amount: 1000 },
      { type: 'prepay_partial', date: '2026-07-01', trackIndex: 0, amount: 1000 },
      { type: 'refinance', date: '2026-08-10', trackIndex: null, closeTrackIndexes: [0] },
    ];
    const next = removeTrackFromDraft(draft, 0);
    expect(next.tracks).toHaveLength(2);
    expect(next.events).toEqual([
      expect.objectContaining({ type: 'refinance', closeTrackIndexes: [0] }),
      expect.objectContaining({ type: 'prepay_partial', trackIndex: 1 }),
    ]);
  });

  describe('the off-plan case as entered', () => {
    const entered = () => ({
      ...createEmptyDraft('2026-11-01'),
      tracks: [
        { ...createEmptyTrack('variable_cpi'), rate: 2.63, firstPaymentDate: '2026-09-10', tranches: [
          { drawDate: '2026-09-10', amount: 117500, status: 'drawn' as const },
          { drawDate: '2026-12-10', amount: 682500, status: 'planned' as const },
        ] },
        { ...createEmptyTrack('fixed_unlinked'), rate: 4.45, firstPaymentDate: '2026-09-10', tranches: [{ drawDate: '2026-09-10', amount: 747500, status: 'drawn' as const }] },
        { ...createEmptyTrack('prime'), margin: -0.75, firstPaymentDate: '2026-12-01', tranches: [{ drawDate: '2026-09-10', amount: 500000, status: 'drawn' as const }] },
      ],
    });

    it('flags first payments on the draw day or months after it, and suggests one month after', () => {
      const draft = entered();
      expect(trackDateIssue(draft.tracks[1])).toMatchObject({ kind: 'on_or_before_draw', suggested: '2026-10-10' });
      expect(trackDateIssue(draft.tracks[2])).toMatchObject({ kind: 'long_gap', days: 82, suggested: '2026-10-10' });
      expect(trackDateIssue({ ...draft.tracks[2], firstPaymentDate: '2026-10-10' })).toBeNull();
    });

    it('accepts a two-month gap when the broken period is charged apart', () => {
      const track = { ...createEmptyTrack('fixed_unlinked'), rate: 4.45, firstPaymentDate: '2026-10-10', tranches: [{ drawDate: '2026-08-19', amount: 747500, status: 'drawn' as const }] };
      expect(trackDateIssue(track)).toMatchObject({ kind: 'long_gap' });
      expect(trackDateIssue(track, 'separate')).toBeNull();
      expect(trackDateIssue({ ...track, firstPaymentDate: '2026-12-10' }, 'separate')).toMatchObject({ kind: 'long_gap', suggested: '2026-10-10' });
      expect(trackDateIssue({ ...track, firstPaymentDate: '2026-09-10' }, 'separate')).toBeNull();
    });

    it('copies one track\'s dates to the others', () => {
      const draft = entered();
      draft.tracks[1].firstPaymentDate = '2026-10-10';
      const next = applyDatesToAllTracks(draft, 1);
      expect(next.tracks.map((track) => track.firstPaymentDate)).toEqual(['2026-10-10', '2026-10-10', '2026-10-10']);
      // Planned drawdowns keep their own date.
      expect(next.tracks[0].tranches[1].drawDate).toBe('2026-12-10');
    });

    it('re-splits planned drawdowns with the drawn mix', () => {
      const draft = entered();
      expect(plannedByTrack(draft)).toEqual({ total: 682500, byTrack: [{ index: 0, amount: 682500 }], firstDate: '2026-12-10' });
      const next = resplitPlannedDrawdowns(draft, '2026-12-10');
      const planned = next.tracks.map((track) => track.tranches.filter((tranche) => tranche.status === 'planned').reduce((sum, tranche) => sum + Number(tranche.amount), 0));
      expect(planned).toEqual([58750, 373750, 250000]);
    });
  });
});
