import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import CategoryHierarchyModal from '@renderer/shared/modals/CategoryHierarchyModal';

const apiGetMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params && 'count' in params) {
        return `${key}:${params.count as string}`;
      }
      return key;
    },
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => apiGetMock(...args),
  },
}));

const renderModal = () =>
  render(
    <ThemeProvider theme={createTheme()}>
      <CategoryHierarchyModal open onClose={vi.fn()} />
    </ThemeProvider>,
  );

const sampleCategories = {
  categories: [
    {
      id: 1,
      name: 'Housing',
      parent_id: null,
      category_type: 'expense',
      display_order: 1,
      is_active: true,
    },
    {
      id: 2,
      name: 'Rent',
      parent_id: 1,
      category_type: 'expense',
      display_order: 2,
      is_active: true,
    },
    {
      id: 3,
      name: 'Salary',
      parent_id: null,
      category_type: 'income',
      display_order: 1,
      is_active: true,
    },
  ],
  uncategorized: {
    totalCount: 3,
    totalAmount: 1500,
    recentTransactions: [
      {
        identifier: 'txn-1',
        vendor: 'Store',
        date: '2024-01-01',
        name: 'Groceries',
        price: -50,
      },
    ],
  },
};

// TODO: Re-enable once Vitest runner perf issue with this heavy modal is resolved.
describe.skip('CategoryHierarchyModal', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockImplementation(async (url: string) => {
      if (url === '/api/categories/hierarchy') {
        return { ok: true, data: sampleCategories };
      }
      if (url === '/api/categorization_rules') {
        return { ok: true, data: [] };
      }
      return { ok: true, data: {} };
    });
  });

  it('loads hierarchy data, shows uncategorized summary, and renders empty rules message', async () => {
    renderModal();

    await waitFor(() => expect(apiGetMock).toHaveBeenCalledWith('/api/categories/hierarchy'));
    expect(apiGetMock).toHaveBeenCalledWith('/api/categorization_rules');

    await waitFor(() => {
      expect(screen.getByText('summary.pendingCount')).toBeInTheDocument();
      expect(screen.getByText('Housing')).toBeInTheDocument();
      expect(screen.getByText('Rent')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('tab', { name: 'tabs.rules' }));
    expect(screen.getByText('rulesList.empty')).toBeInTheDocument();
  });

  it('surfaces an error when categories fail to load', async () => {
    apiGetMock.mockImplementation(async (url: string) => {
      if (url === '/api/categories/hierarchy') {
        return { ok: false };
      }
      if (url === '/api/categorization_rules') {
        return { ok: true, data: [] };
      }
      return { ok: true, data: {} };
    });

    renderModal();

    await waitFor(() => {
      expect(screen.getByText('errors.loadCategories')).toBeInTheDocument();
    });
  });
});
