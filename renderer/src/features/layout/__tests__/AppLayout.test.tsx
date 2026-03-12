import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppLayout from '@renderer/routes/AppLayout';

const mockGet = vi.fn();
const showNotification = vi.fn();

let latestSearchProps: any = null;

vi.mock('@renderer/features/layout/components/Sidebar', () => ({
  default: () => <div data-testid="sidebar" />,
}));

vi.mock('@renderer/features/layout/components/TitleBar', () => ({
  default: () => <div data-testid="title-bar" />,
}));

vi.mock('@renderer/features/chatbot/components/FinancialChatbot', () => ({
  default: () => null,
}));

vi.mock('@renderer/features/support', () => ({
  DonationReminderDialog: () => null,
  useDonationStatus: () => ({
    status: { shouldShowMonthlyReminder: false, currentMonthKey: '2026-03' },
    loading: false,
    markReminderShown: vi.fn(),
  }),
}));

vi.mock('@app/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { email: 'user@example.com', name: 'Test User' } },
    loading: false,
  }),
}));

vi.mock('@renderer/features/notifications/NotificationContext', () => ({
  useNotification: () => ({ showNotification }),
}));

vi.mock('@renderer/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

vi.mock('@renderer/features/search/components/GlobalTransactionSearch', () => ({
  __esModule: true,
  default: (props: any) => {
    latestSearchProps = props;
    return props.open ? (
      <div data-testid="global-search">
        {JSON.stringify(props.initialFilters || {})}
      </div>
    ) : null;
  },
}));

vi.mock('@renderer/shared/modals/TransactionDetailModal', () => ({
  __esModule: true,
  default: ({ open, transaction }: { open: boolean; transaction: any }) => (
    open ? <div data-testid="transaction-detail">{transaction?.name || transaction?.identifier}</div> : null
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) => options?.defaultValue || _key,
  }),
}));

function LocationIndicator() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderAppLayout(initialEntries: string[] = ['/']) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <AppLayout />,
      children: [
        {
          index: true,
          element: <LocationIndicator />,
        },
        {
          path: 'analysis',
          element: <LocationIndicator />,
        },
      ],
    },
  ], { initialEntries });

  render(<RouterProvider router={router} />);
  return router;
}

describe('AppLayout', () => {
  beforeEach(() => {
    mockGet.mockReset();
    showNotification.mockReset();
    latestSearchProps = null;
  });

  it('remaps /budgets navigation events to the analysis budget tab', async () => {
    renderAppLayout();

    await act(async () => {
      window.dispatchEvent(new CustomEvent('navigateTo', {
        detail: {
          path: '/budgets',
        },
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/analysis?tab=budget');
    });
  });

  it('opens global search with initial filters from events', async () => {
    renderAppLayout();

    await act(async () => {
      window.dispatchEvent(new CustomEvent('openTransactionSearch', {
        detail: {
          vendor: 'Mega Store',
          tag: 'groceries',
        },
      }));
    });

    expect(screen.getByTestId('global-search')).toHaveTextContent('"vendor":"Mega Store"');
    expect(latestSearchProps.initialFilters).toEqual({
      vendor: 'Mega Store',
      tag: 'groceries',
    });
  });

  it('loads and opens the global transaction detail modal from events', async () => {
    mockGet.mockResolvedValue({
      ok: true,
      data: {
        identifier: 'txn-1',
        vendor: 'bank-a',
        name: 'Coffee',
        category_name: null,
        parent_name: null,
        category_definition_id: null,
        category_type: null,
        memo: null,
        tags: [],
        price: -20,
        date: '2026-03-09',
        processed_date: null,
        account_number: null,
        type: null,
        status: null,
      },
    });

    renderAppLayout();

    await act(async () => {
      window.dispatchEvent(new CustomEvent('openTransactionDetail', {
        detail: {
          identifier: 'txn-1',
          vendor: 'bank-a',
        },
      }));
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/transactions/txn-1%7Cbank-a');
    });

    await waitFor(() => {
      expect(screen.getByTestId('transaction-detail')).toHaveTextContent('Coffee');
    });
  });
});
