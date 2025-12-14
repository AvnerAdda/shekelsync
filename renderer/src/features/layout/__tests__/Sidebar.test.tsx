import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import Sidebar from '../components/Sidebar';

const showNotificationMock = vi.fn();
const getPageAccessStatusMock = vi.fn();
const apiGetMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && typeof params.count !== 'undefined' ? `${key}:${params.count}` : key,
  }),
}));

vi.mock('@renderer/shared/modals/AccountsModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="accounts-modal" /> : null),
}));

vi.mock('@renderer/shared/modals/ScrapeModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="scrape-modal" /> : null),
}));

vi.mock('@renderer/shared/modals/CategoryHierarchyModal', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="category-modal" /> : null),
}));

vi.mock('@renderer/features/notifications/NotificationContext', () => ({
  useNotification: () => ({ showNotification: showNotificationMock }),
}));

vi.mock('@app/contexts/OnboardingContext', () => ({
  useOnboarding: () => ({
    getPageAccessStatus: getPageAccessStatusMock,
  }),
}));

vi.mock('@/hooks/useScrapeProgress', () => ({
  useScrapeProgress: () => ({ latestEvent: null }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}));

const renderSidebar = (props?: Partial<React.ComponentProps<typeof Sidebar>>) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <Sidebar currentPage="home" onPageChange={vi.fn()} {...props} />
    </ThemeProvider>,
  );

const mockSuccessfulApis = (lastUpdate: string) => {
  apiGetMock.mockImplementation(async (url: string) => {
    switch (url) {
      case '/api/credentials':
        return {
          ok: true,
          data: [
            {
              id: 'cred-1',
              vendor: 'test-bank',
              nickname: 'Checking',
              lastUpdate,
              institution: { institution_type: 'bank' },
              institution_id: 'inst-1',
            },
          ],
        };
      case '/api/ping':
        return { ok: true };
      case '/api/investments/accounts':
        return { ok: true, data: { accounts: [{ account_type: 'pension' }] } };
      case '/api/categories/hierarchy':
        return { ok: true, data: { uncategorized: { totalCount: 2 } } };
      default:
        return { ok: true, data: {} };
    }
  });

  apiPostMock.mockResolvedValue({
    ok: true,
    data: { success: true, successCount: 1, totalProcessed: 1, totalTransactions: 2 },
  });
};

describe('Sidebar', () => {
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
    getPageAccessStatusMock.mockReturnValue({ isLocked: false, reason: '' });
    mockSuccessfulApis(new Date().toISOString());
  });

  it('renders menu items and invokes page change on click', async () => {
    const onPageChange = vi.fn();

    renderSidebar({ onPageChange });

    await waitFor(() => expect(screen.getByText('stats.accounts:1')).toBeInTheDocument());

    await userEvent.click(screen.getByText('menu.analysis'));
    expect(onPageChange).toHaveBeenCalledWith('analysis');
  });

  it('triggers a bulk refresh when sync is stale', async () => {
    const staleDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    mockSuccessfulApis(staleDate);

    renderSidebar();

    await waitFor(() => expect(screen.getByText(/sync\.daysAgo/)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/sync\.daysAgo/));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/scrape/bulk', {}));
    expect(showNotificationMock).toHaveBeenCalled();
  });

  it('opens the accounts modal when sync is recent', async () => {
    renderSidebar();

    const syncLabel = await screen.findByText('sync.justNow');

    fireEvent.click(syncLabel);

    expect(apiPostMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('accounts-modal')).toBeInTheDocument();
  });

  it('displays account sync statuses and refreshes stale accounts from the popover', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();

    apiGetMock.mockImplementation(async (url: string) => {
      switch (url) {
        case '/api/credentials':
          return {
            ok: true,
            data: [
              {
                id: 'cred-1',
                vendor: 'test-bank',
                nickname: 'Bank A',
                lastUpdate: threeDaysAgo,
                institution: { institution_type: 'bank' },
                institution_id: 'inst-1',
              },
              {
                id: 'cred-2',
                vendor: 'credit-card',
                nickname: 'Card B',
                lastUpdate: thirtyHoursAgo,
                institution: { institution_type: 'credit_card' },
                institution_id: 'inst-2',
              },
            ],
          };
        case '/api/ping':
          return { ok: true };
        case '/api/investments/accounts':
          return { ok: true, data: { accounts: [{ account_type: 'pension' }] } };
        case '/api/categories/hierarchy':
          return { ok: true, data: { uncategorized: { totalCount: 0 } } };
        default:
          return { ok: true, data: {} };
      }
    });

    renderSidebar();

    const syncText = await screen.findByText(/sync\.daysAgo:3/);
    const syncContainer = syncText.closest('div');
    expect(syncContainer).not.toBeNull();

    fireEvent.mouseEnter(syncContainer as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText('Bank A')).toBeInTheDocument();
      expect(screen.getByText('Card B')).toBeInTheDocument();
    });

    const refreshButton = screen.getByRole('button', { name: 'popover.refreshStaleAccounts:2' });
    await userEvent.click(refreshButton);

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/scrape/bulk', {}));
  });
});
