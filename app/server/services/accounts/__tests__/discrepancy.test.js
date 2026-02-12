import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const getClientMock = vi.fn();
const queryMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();

let discrepancyService;

beforeAll(async () => {
  const module = await import('../discrepancy.js');
  discrepancyService = module.default ?? module;
});

beforeEach(() => {
  queryMock.mockReset();
  getClientMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();

  getClientMock.mockResolvedValue({
    query: clientQueryMock,
    release: releaseMock,
  });
  discrepancyService.__setDatabase({
    getClient: getClientMock,
    query: queryMock,
  });
  discrepancyService.__setUuidGenerator(() => '12345678-aaaa-bbbb-cccc-dddddddddddd');
});

afterEach(() => {
  discrepancyService.__resetDependencies?.();
  vi.restoreAllMocks();
});

describe('accounts discrepancy service', () => {
  it('throws 400 when pairingId is missing', async () => {
    await expect(
      discrepancyService.resolveDiscrepancy({ action: 'ignore' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'pairingId is required',
    });

    expect(getClientMock).not.toHaveBeenCalled();
  });

  it('throws 400 when action is invalid', async () => {
    await expect(
      discrepancyService.resolveDiscrepancy({ pairingId: 1, action: 'noop' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'action must be "ignore" or "add_cc_fee"',
    });

    expect(getClientMock).not.toHaveBeenCalled();
  });

  it('throws 400 when add_cc_fee is missing required fee details', async () => {
    await expect(
      discrepancyService.resolveDiscrepancy({ pairingId: 1, action: 'add_cc_fee' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'feeDetails (amount, date, name) required for add_cc_fee action',
    });

    expect(getClientMock).not.toHaveBeenCalled();
  });

  it('throws 404 when pairing does not exist', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      discrepancyService.resolveDiscrepancy({ pairingId: 77, action: 'ignore' }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'Pairing not found',
    });

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('marks discrepancy as ignored and writes log entry', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 9,
            credit_card_vendor: 'isracard',
            credit_card_account_number: '1234',
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await discrepancyService.resolveDiscrepancy({
      pairingId: 9,
      action: 'ignore',
      cycleDate: '2026-01-31',
    });

    expect(result).toEqual({
      success: true,
      resolution: 'ignored',
    });

    expect(String(clientQueryMock.mock.calls[1][0])).toContain('UPDATE account_pairings');
    expect(String(clientQueryMock.mock.calls[2][0])).toContain('INSERT INTO account_pairing_log');
    const logDetails = JSON.parse(clientQueryMock.mock.calls[2][1][1]);
    expect(logDetails.action).toBe('ignore');
    expect(logDetails.cycleDate).toBe('2026-01-31');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('creates a fee transaction and logs details for add_cc_fee', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            credit_card_vendor: 'isracard',
            credit_card_account_number: '5555',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 88 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await discrepancyService.resolveDiscrepancy({
      pairingId: 5,
      action: 'add_cc_fee',
      cycleDate: '2026-01-31',
      feeDetails: {
        amount: 17.2,
        date: '2026-01-30',
        processedDate: '2026-01-31',
        name: 'Late fee',
      },
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('fee_created');
    expect(result.transactionId).toMatch(/^fee-5-[0-9a-f]{8}$/i);
    expect(result.transaction).toMatchObject({
      identifier: result.transactionId,
      vendor: 'isracard',
      date: '2026-01-30',
      name: 'Late fee',
      price: -17.2,
    });

    const transactionInsertParams = clientQueryMock.mock.calls[2][1];
    expect(transactionInsertParams[0]).toBe(result.transactionId);
    expect(transactionInsertParams[1]).toBe('isracard');
    expect(transactionInsertParams[3]).toBe('2026-01-30');
    expect(transactionInsertParams[4]).toBe('2026-01-31');
    expect(transactionInsertParams[6]).toBe(-17.2);
    expect(transactionInsertParams[10]).toBe(88);

    const logDetails = JSON.parse(clientQueryMock.mock.calls[4][1][1]);
    expect(logDetails.categoryId).toBe(88);
    expect(logDetails.amount).toBe(-17.2);
    expect(logDetails.processedDate).toBe('2026-01-31');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('validates add_cc_fee payload before opening a DB client', async () => {
    await expect(
      discrepancyService.resolveDiscrepancy({
        pairingId: 5,
        action: 'add_cc_fee',
        feeDetails: {
          amount: 12,
          name: 'Fee without date',
        },
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'feeDetails (amount, date, name) required for add_cc_fee action',
    });

    expect(getClientMock).not.toHaveBeenCalled();
  });

  it('resets discrepancy acknowledgment and reports whether any rows changed', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await expect(discrepancyService.resetDiscrepancyAcknowledgment(4)).resolves.toEqual({ updated: true });

    queryMock.mockResolvedValueOnce({ rowCount: 0 });
    await expect(discrepancyService.resetDiscrepancyAcknowledgment(404)).resolves.toEqual({ updated: false });
  });

  it('returns discrepancy status as boolean or null when pairing is missing', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ discrepancy_acknowledged: 1 }] });
    await expect(discrepancyService.getDiscrepancyStatus(3)).resolves.toEqual({ acknowledged: true });

    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(discrepancyService.getDiscrepancyStatus(999)).resolves.toBeNull();
  });
});
