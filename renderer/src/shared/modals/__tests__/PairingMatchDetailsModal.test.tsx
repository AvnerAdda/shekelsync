import { act, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PairingMatchDetailsModal from '../PairingMatchDetailsModal';

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: getMock,
  },
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildPayload({
  pairingId,
  repaymentName,
  sharedPairingsCount,
  sharedPairingIds,
}: {
  pairingId: number;
  repaymentName: string;
  sharedPairingsCount: number;
  sharedPairingIds: number[];
}) {
  return {
    pairing: {
      id: pairingId,
      creditCardVendor: 'max',
      creditCardAccountNumber: '4886',
      bankVendor: 'discount',
      bankAccountNumber: '0162490242',
      matchPatterns: ['max', '4886'],
      isActive: true,
      discrepancyAcknowledged: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    summary: {
      cyclesCount: 1,
      repaymentCount: 1,
      cardTransactionCount: 1,
      totalBankAmount: 100,
      totalCardAmount: 100,
      totalMatchedAmount: 100,
      totalRemainingAmount: 0,
      statusCounts: {
        matched: 1,
        partial: 0,
        unmatched: 0,
        ambiguous: 0,
      },
    },
    cycles: [
      {
        cycleDate: '2026-03-01',
        cycleStatus: 'matched',
        bankTotal: 100,
        ccTotal: 100,
        difference: 0,
        matchedAccount: '4886',
        repayments: [
          {
            identifier: `rep-${pairingId}`,
            vendor: 'discount',
            accountNumber: '0162490242',
            date: '2026-03-01T00:00:00.000Z',
            cycleDate: '2026-03-01',
            name: repaymentName,
            price: -100,
            absAmount: 100,
            matchedAmount: 100,
            remainingAmount: 0,
            linkedExpenseCount: 1,
            linkedExpenseTxnIds: ['exp-1'],
            sharedPairingsCount,
            sharedPairingIds,
            status: 'matched',
            matchSource: 'inferred_amount_cycle',
          },
        ],
        cardTransactions: [
          {
            identifier: 'exp-1',
            vendor: 'max',
            accountNumber: '4886',
            date: '2026-02-20T00:00:00.000Z',
            processedDate: '2026-03-01T00:00:00.000Z',
            cycleDate: '2026-03-01',
            name: 'Expense 1',
            price: -100,
            absAmount: 100,
            linkedRepaymentCount: 1,
            linkedRepaymentIds: [`rep-${pairingId}`],
            isLinked: true,
            linkMethod: 'inferred_amount_cycle',
          },
        ],
      },
    ],
    periodMonths: 6,
    method: 'allocated',
    acknowledged: false,
    generatedAt: '2026-03-05T00:00:00.000Z',
  };
}

describe('PairingMatchDetailsModal', () => {
  beforeEach(() => {
    vi.useRealTimers();
    getMock.mockReset();
  });

  it('shows 0 shared pairings when there are no shared exclusions', async () => {
    getMock.mockResolvedValueOnce({
      ok: true,
      data: buildPayload({
        pairingId: 11,
        repaymentName: 'Repayment 1',
        sharedPairingsCount: 0,
        sharedPairingIds: [],
      }),
    });

    render(
      <PairingMatchDetailsModal
        isOpen
        onClose={vi.fn()}
        pairing={{
          id: 11,
          creditCardVendor: 'max',
          creditCardAccountNumber: '4886',
          bankVendor: 'discount',
          bankAccountNumber: '0162490242',
        }}
      />,
    );

    const dialog = await screen.findByRole('dialog', {}, { timeout: 10_000 });
    const repaymentCell = await within(dialog).findByText('Repayment 1', {}, { timeout: 10_000 });
    const row = repaymentCell.closest('tr');
    expect(row).toBeTruthy();

    const cells = within(row as HTMLTableRowElement).getAllByRole('cell');
    expect(cells[7]).toHaveTextContent('0');
  }, 10_000);

  it('shows the API error when details loading fails', async () => {
    getMock.mockResolvedValueOnce({
      ok: false,
      data: { error: 'details unavailable' },
    });

    render(
      <PairingMatchDetailsModal
        isOpen
        onClose={vi.fn()}
        pairing={{
          id: 33,
          creditCardVendor: 'max',
          creditCardAccountNumber: '4886',
          bankVendor: 'discount',
          bankAccountNumber: '0162490242',
        }}
      />,
    );

    expect(await screen.findByText('details unavailable')).toBeInTheDocument();
  });

  it('ignores stale request responses when switching pairings quickly', async () => {
    const firstRequest = createDeferred<{ ok: boolean; data: unknown }>();
    const secondRequest = createDeferred<{ ok: boolean; data: unknown }>();

    getMock
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);

    const { rerender } = render(
      <PairingMatchDetailsModal
        isOpen
        onClose={vi.fn()}
        pairing={{
          id: 11,
          creditCardVendor: 'max',
          creditCardAccountNumber: '4886',
          bankVendor: 'discount',
          bankAccountNumber: '0162490242',
        }}
      />,
    );

    rerender(
      <PairingMatchDetailsModal
        isOpen
        onClose={vi.fn()}
        pairing={{
          id: 22,
          creditCardVendor: 'isracard',
          creditCardAccountNumber: '5222',
          bankVendor: 'hapoalim',
          bankAccountNumber: '2345',
        }}
      />,
    );

    await act(async () => {
      secondRequest.resolve({
        ok: true,
        data: buildPayload({
          pairingId: 22,
          repaymentName: 'Repayment B',
          sharedPairingsCount: 1,
          sharedPairingIds: [22],
        }),
      });
      await Promise.resolve();
    });

    expect(await screen.findByText('Repayment B')).toBeInTheDocument();

    await act(async () => {
      firstRequest.resolve({
        ok: true,
        data: buildPayload({
          pairingId: 11,
          repaymentName: 'Repayment A',
          sharedPairingsCount: 1,
          sharedPairingIds: [11],
        }),
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByText('Repayment A')).not.toBeInTheDocument();
    });
  });
});
