import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountPairingModal from '../AccountPairingModal';

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: getMock,
    post: postMock,
  },
}));

vi.mock('@renderer/shared/components/LicenseReadOnlyAlert', () => ({
  __esModule: true,
  default: () => null,
  isLicenseReadOnlyError: () => ({ isReadOnly: false }),
}));

const detailsPayload = {
  pairing: {
    id: 11,
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
          identifier: 'r1',
          vendor: 'discount',
          accountNumber: '0162490242',
          date: '2026-03-01T00:00:00.000Z',
          cycleDate: '2026-03-01',
          name: 'Repayment 1',
          price: -100,
          absAmount: 100,
          matchedAmount: 100,
          remainingAmount: 0,
          linkedExpenseCount: 1,
          linkedExpenseTxnIds: ['e1'],
          sharedPairingsCount: 1,
          sharedPairingIds: [11],
          status: 'matched',
        },
      ],
      cardTransactions: [
        {
          identifier: 'e1',
          vendor: 'max',
          accountNumber: '4886',
          date: '2026-02-20T00:00:00.000Z',
          processedDate: '2026-03-01T00:00:00.000Z',
          cycleDate: '2026-03-01',
          name: 'Expense 1',
          price: -100,
          absAmount: 100,
          linkedRepaymentCount: 1,
          linkedRepaymentIds: ['r1'],
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

describe('AccountPairingModal', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('opens transaction details modal when clicking a paired result row', async () => {
    getMock
      .mockResolvedValueOnce({ ok: true, data: { pairings: [] } })
      .mockResolvedValueOnce({ ok: true, data: detailsPayload })
      .mockResolvedValueOnce({ ok: true, data: detailsPayload });

    postMock.mockResolvedValueOnce({
      ok: true,
      data: {
        success: true,
        wasCreated: true,
        pairing: {
          id: 11,
          creditCardVendor: 'max',
          creditCardAccountNumber: '4886',
          bankVendor: 'discount',
          bankAccountNumber: '0162490242',
          matchPatterns: ['max', '4886'],
        },
      },
    });

    render(
      <AccountPairingModal
        isOpen
        onClose={vi.fn()}
        creditCardAccounts={[{ id: 1, vendor: 'max', nickname: 'Primary', account_number: '4886' }]}
      />,
    );

    const rowHint = await screen.findByText('Click to view transaction matching details');
    expect(await screen.findByText('Cycles: 1')).toBeInTheDocument();
    expect(await screen.findByText('Repayments: 1')).toBeInTheDocument();
    expect(await screen.findByText('Card Txns: 1')).toBeInTheDocument();
    fireEvent.click(rowHint.closest('li') as HTMLElement);

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/api/accounts/pairing/11/match-details?monthsBack=6');
    });

    expect(await screen.findByText(/Pairing Match Details/)).toBeInTheDocument();
    expect(await screen.findByText('Bank repayments')).toBeInTheDocument();
  });

  it('does not open details modal for missing rows', async () => {
    getMock.mockResolvedValueOnce({ ok: true, data: { pairings: [] } });
    postMock.mockResolvedValueOnce({
      ok: true,
      data: {
        success: false,
        reason: 'No matching bank account found',
      },
    });

    render(
      <AccountPairingModal
        isOpen
        onClose={vi.fn()}
        creditCardAccounts={[{ id: 1, vendor: 'max', nickname: 'Primary', account_number: '4886' }]}
      />,
    );

    const reason = await screen.findByText('No matching bank account found');
    fireEvent.click(reason.closest('li') as HTMLElement);

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Pairing Match Details/)).not.toBeInTheDocument();
  });

  it('shows details error state when details request fails', async () => {
    getMock
      .mockResolvedValueOnce({ ok: true, data: { pairings: [] } })
      .mockResolvedValueOnce({ ok: true, data: detailsPayload })
      .mockResolvedValueOnce({ ok: false, data: { error: 'details unavailable' } });

    postMock.mockResolvedValueOnce({
      ok: true,
      data: {
        success: true,
        wasCreated: true,
        pairing: {
          id: 11,
          creditCardVendor: 'max',
          creditCardAccountNumber: '4886',
          bankVendor: 'discount',
          bankAccountNumber: '0162490242',
          matchPatterns: ['max', '4886'],
        },
      },
    });

    render(
      <AccountPairingModal
        isOpen
        onClose={vi.fn()}
        creditCardAccounts={[{ id: 1, vendor: 'max', nickname: 'Primary', account_number: '4886' }]}
      />,
    );

    const rowHint = await screen.findByText('Click to view transaction matching details');
    fireEvent.click(rowHint.closest('li') as HTMLElement);

    expect(await screen.findByText('details unavailable')).toBeInTheDocument();
  });

  it('re-runs auto-pairing when credit card accounts change while modal remains open', async () => {
    getMock.mockResolvedValue({ ok: true, data: { pairings: [] } });
    postMock.mockResolvedValue({
      ok: true,
      data: {
        success: false,
        reason: 'No matching bank account found',
      },
    });

    const { rerender } = render(
      <AccountPairingModal
        isOpen
        onClose={vi.fn()}
        creditCardAccounts={[{ id: 1, vendor: 'max', nickname: 'Primary', account_number: '4886' }]}
      />,
    );

    expect(await screen.findByText('No matching bank account found')).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledWith('/api/accounts/auto-pair', {
      creditCardVendor: 'max',
      creditCardAccountNumber: '4886',
      applyTransactions: true,
    });

    rerender(
      <AccountPairingModal
        isOpen
        onClose={vi.fn()}
        creditCardAccounts={[
          { id: 1, vendor: 'max', nickname: 'Primary', account_number: '4886' },
          { id: 2, vendor: 'isracard', nickname: 'Secondary', account_number: '5222' },
        ]}
      />,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/api/accounts/auto-pair', {
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '5222',
        applyTransactions: true,
      });
    });
  });
});
