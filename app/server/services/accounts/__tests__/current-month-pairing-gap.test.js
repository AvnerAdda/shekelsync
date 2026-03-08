import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let currentMonthPairingGapService;

beforeAll(async () => {
  const module = await import('../current-month-pairing-gap.js');
  currentMonthPairingGapService = module.default ?? module;
});

describe('current month pairing gap service', () => {
  const pairingsMock = {
    listPairings: vi.fn(),
  };
  const autoPairingMock = {
    calculateDiscrepancy: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-08T12:00:00.000Z'));

    pairingsMock.listPairings.mockReset();
    autoPairingMock.calculateDiscrepancy.mockReset();

    currentMonthPairingGapService.__setDependencies({
      pairings: pairingsMock,
      autoPairing: autoPairingMock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    currentMonthPairingGapService.__resetDependencies();
  });

  it('returns zero totals when no active pairings exist', async () => {
    pairingsMock.listPairings.mockResolvedValue([]);

    const result = await currentMonthPairingGapService.getCurrentMonthPairingGap();

    expect(result.windowDays).toBe(30);
    expect(result.windowStartDate).toBe('2026-02-07');
    expect(result.windowEndDate).toBe('2026-03-08');
    expect(result.totals).toEqual({
      bankAmount: 0,
      cardAmount: 0,
      missingAmount: 0,
      affectedPairingsCount: 0,
      affectedCyclesCount: 0,
    });
    expect(result.pairings).toEqual([]);
    expect(autoPairingMock.calculateDiscrepancy).not.toHaveBeenCalled();
  });

  it('counts positive gaps and treats null cc totals as fully missing', async () => {
    pairingsMock.listPairings.mockResolvedValue([
      {
        id: 5,
        creditCardVendor: 'max',
        creditCardAccountNumber: '4886',
        bankVendor: 'discount',
        bankAccountNumber: '0162490242',
      },
    ]);

    autoPairingMock.calculateDiscrepancy.mockResolvedValue({
      cycles: [
        { cycleDate: '2026-03-07', bankTotal: 1000, ccTotal: 900, status: 'large_discrepancy' },
        { cycleDate: '2026-03-01', bankTotal: 500, ccTotal: null, status: 'missing_cc_cycle' },
        { cycleDate: '2026-02-10', bankTotal: 300, ccTotal: 300, status: 'matched' },
      ],
    });

    const result = await currentMonthPairingGapService.getCurrentMonthPairingGap();

    expect(result.totals).toEqual({
      bankAmount: 1500,
      cardAmount: 900,
      missingAmount: 600,
      affectedPairingsCount: 1,
      affectedCyclesCount: 2,
    });
    expect(result.pairings).toHaveLength(1);
    expect(result.pairings[0]).toMatchObject({
      pairingId: 5,
      bankAmount: 1500,
      cardAmount: 900,
      missingAmount: 600,
      affectedCyclesCount: 2,
    });
    expect(result.pairings[0].cycles).toEqual([
      {
        cycleDate: '2026-03-07',
        status: 'large_discrepancy',
        bankAmount: 1000,
        cardAmount: 900,
        missingAmount: 100,
      },
      {
        cycleDate: '2026-03-01',
        status: 'missing_cc_cycle',
        bankAmount: 500,
        cardAmount: 0,
        missingAmount: 500,
      },
    ]);
  });

  it('ignores negative gaps, old cycles, and gaps within tolerance', async () => {
    pairingsMock.listPairings.mockResolvedValue([
      {
        id: 9,
        creditCardVendor: 'visaCal',
        creditCardAccountNumber: '6219',
        bankVendor: 'discount',
        bankAccountNumber: '0162490242',
      },
    ]);

    autoPairingMock.calculateDiscrepancy.mockResolvedValue({
      cycles: [
        { cycleDate: '2026-03-06', bankTotal: 100, ccTotal: 120, status: 'cc_over_bank' }, // negative gap
        { cycleDate: '2026-03-05', bankTotal: 100, ccTotal: 98.5, status: 'fee_candidate' }, // <= tolerance
        { cycleDate: '2026-01-31', bankTotal: 300, ccTotal: 0, status: 'missing_cc_cycle' }, // outside window
      ],
    });

    const result = await currentMonthPairingGapService.getCurrentMonthPairingGap();

    expect(result.totals).toEqual({
      bankAmount: 0,
      cardAmount: 0,
      missingAmount: 0,
      affectedPairingsCount: 0,
      affectedCyclesCount: 0,
    });
    expect(result.pairings).toEqual([]);
  });

  it('validates days parameter', async () => {
    await expect(
      currentMonthPairingGapService.getCurrentMonthPairingGap({ days: 0 }),
    ).rejects.toMatchObject({ status: 400, message: 'days must be a positive integer' });

    await expect(
      currentMonthPairingGapService.getCurrentMonthPairingGap({ days: 31 }),
    ).rejects.toMatchObject({ status: 400, message: 'days must be less than or equal to 30' });
  });

  it('anchors window dates to Israel local day near UTC midnight', async () => {
    vi.setSystemTime(new Date('2026-03-07T22:30:00.000Z'));
    pairingsMock.listPairings.mockResolvedValue([]);

    const result = await currentMonthPairingGapService.getCurrentMonthPairingGap({ days: 1 });

    expect(result.windowEndDate).toBe('2026-03-08');
    expect(result.windowStartDate).toBe('2026-03-08');
  });
});
