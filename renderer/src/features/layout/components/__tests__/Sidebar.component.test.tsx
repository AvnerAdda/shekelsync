import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from '../Sidebar';

const showNotification = vi.fn();
const getPageAccessStatus = vi.fn();
const mockGet = vi.fn();
const mockPost = vi.fn();
let mockOnboardingStatus: any = {};

let mockCredentials: any[] = [];
let mockInvestmentAccounts: any[] = [];
let mockInvestmentSuggestions: any[] = [];
let mockUncategorizedCount = 0;
let mockPingOk = true;
let mockPairingGap: any = null;
let mockScrapeEvent: any = null;
let mockCredentialsOk = true;

const translations: Record<string, string> = {
  'menu.home': 'Home',
  'menu.overview': 'Home',
  'menu.review': 'Review',
  'menu.activity': 'Activity',
  'menu.plan': 'Plan',
  'menu.wealth': 'Wealth',
  'menu.analysis': 'Analysis',
  'menu.investments': 'Investments',
  'menu.settings': 'Settings',
  'tooltips.collapseSidebar': 'Collapse sidebar',
  'tooltips.expandSidebar': 'Expand sidebar',
  'tooltips.addAccount': 'Add account',
  'tooltips.addAccountPairingGap': 'Current month may be missing card transactions. Open Account Pairing for unmatched cards and run Recovery Sync (100 days).',
  'tooltips.addAccountInvestmentSuggestions': 'You have investment transactions ready to link in Investments & Savings.',
  'tooltips.categories': 'Categories',
  'actions.addAccount': 'Add Account',
  'actions.categories': 'Categories',
  'sync.never': 'Never',
  'sync.yesterday': 'Yesterday',
  'sync.justNow': 'Just now',
  'sync.clickToSync': 'Click to sync accounts',
  'sync.syncing': 'Syncing...',
  'accountSync.neverSynced': 'Never synced',
  'dbStatus.connected': 'DB Connected',
  'dbStatus.disconnected': 'DB Disconnected',
  'dbStatus.checking': 'Checking DB',
  'popover.title': 'Account sync status',
  'popover.noAccounts': 'No accounts',
  'stats.connected': 'Connected',
  'stats.accountsConnected': 'accounts connected',
  'credentials.loading': 'Loading account data...',
  'credentials.unavailable': 'Account data unavailable',
  'credentials.loadFailed': 'Account data could not be refreshed. Existing account details were kept.',
  'credentials.retry': 'Retry loading accounts',
  'uncategorized': 'uncategorized',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'sync.daysAgo') return `${options?.count} days ago`;
      if (key === 'sync.hoursAgo') return `${options?.count} hours ago`;
      if (key === 'sync.minutesAgo') return `${options?.count} minutes ago`;
      if (key === 'popover.refreshStaleAccounts') return `Refresh ${options?.count} stale accounts`;
      return translations[key] || (typeof options?.defaultValue === 'string' ? options.defaultValue : key);
    },
  }),
}));

vi.mock('@renderer/features/notifications/NotificationContext', () => ({
  useNotification: () => ({ showNotification }),
}));

vi.mock('@app/contexts/OnboardingContext', () => ({
  useOnboarding: () => ({
    status: mockOnboardingStatus,
    getPageAccessStatus,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock('@/hooks/useScrapeProgress', () => ({
  useScrapeProgress: () => ({ latestEvent: mockScrapeEvent }),
}));

vi.mock('@renderer/shared/modals/AccountsModal', () => ({
  default: ({
    isOpen,
    openRequest,
  }: {
    isOpen: boolean;
    openRequest?: { tab?: string; addFlow?: boolean } | null;
  }) =>
    isOpen ? (
      <div>{`accounts-modal-open:${openRequest?.tab ?? ''}:${openRequest?.addFlow ? 'add' : ''}`}</div>
    ) : null,
}));

vi.mock('@renderer/shared/modals/ScrapeModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>scrape-modal-open</div> : null),
}));

vi.mock('@renderer/shared/modals/CategoryHierarchyModal', () => ({
  default: ({
    open,
    initialTab,
    initialRuleVendor,
    focusedTransaction,
  }: {
    open: boolean;
    initialTab?: number;
    initialRuleVendor?: string | null;
    focusedTransaction?: { identifier: string; vendor: string } | null;
  }) =>
    open ? (
      <div data-testid="categories-modal">
        {`categories-modal-open:${initialTab ?? 0}:${initialRuleVendor ?? ''}:${focusedTransaction?.identifier ?? ''}:${focusedTransaction?.vendor ?? ''}`}
      </div>
    ) : null,
}));

function setupDefaultApiMocks() {
  mockGet.mockImplementation((endpoint: string) => {
    if (endpoint === '/api/credentials') {
      return Promise.resolve({
        ok: mockCredentialsOk,
        statusText: mockCredentialsOk ? 'OK' : 'Protected data unavailable',
        data: mockCredentialsOk ? mockCredentials : { error: 'Protected data unavailable' },
      });
    }
    if (endpoint === '/api/ping') {
      return Promise.resolve({ ok: mockPingOk, data: {} });
    }
    if (endpoint === '/api/investments/accounts') {
      return Promise.resolve({ ok: true, data: { accounts: mockInvestmentAccounts } });
    }
    if (endpoint === '/api/investments/smart-suggestions?thresholdDays=90') {
      return Promise.resolve({ ok: true, data: { success: true, suggestions: mockInvestmentSuggestions } });
    }
    if (endpoint === '/api/categories/hierarchy') {
      return Promise.resolve({ ok: true, data: { uncategorized: { totalCount: mockUncategorizedCount } } });
    }
    if (endpoint === '/api/accounts/pairing/current-month-gap?days=30') {
      return Promise.resolve({ ok: true, data: mockPairingGap });
    }

    return Promise.resolve({ ok: true, data: {} });
  });

  mockPost.mockResolvedValue({
    ok: true,
    data: {
      success: true,
      totalProcessed: 0,
      successCount: 0,
      totalTransactions: 0,
    },
  });
}

async function renderSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const view = render(<Sidebar {...props} />);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

describe('Sidebar component', () => {
  beforeEach(() => {
    vi.useRealTimers();
    showNotification.mockReset();
    getPageAccessStatus.mockReset();
    mockGet.mockReset();
    mockPost.mockReset();

    mockScrapeEvent = null;
    mockCredentialsOk = true;
    mockOnboardingStatus = {};
    mockPingOk = true;
    mockUncategorizedCount = 0;
    mockInvestmentSuggestions = [];
    mockPairingGap = {
      windowDays: 30,
      windowStartDate: '2026-02-08',
      windowEndDate: '2026-03-08',
      tolerance: 2,
      totals: {
        bankAmount: 0,
        cardAmount: 0,
        missingAmount: 0,
        affectedPairingsCount: 0,
        affectedCyclesCount: 0,
      },
      pairings: [],
      generatedAt: '2026-03-08T00:00:00.000Z',
    };

    mockCredentials = [
      {
        id: 'cred-1',
        vendor: 'hapoalim',
        nickname: 'Main Bank',
        lastUpdate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        institution_id: 10,
        institution: { institution_type: 'bank' },
      },
      {
        id: 'cred-2',
        vendor: 'isracard',
        nickname: 'Main Card',
        lastUpdate: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
        institution_id: 11,
        institution: { institution_type: 'credit_card' },
      },
    ];

    mockInvestmentAccounts = [{ id: 100, account_type: 'pension' }];

    getPageAccessStatus.mockImplementation(() => ({ isLocked: false, reason: '' }));
    setupDefaultApiMocks();

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    delete (window as any).electronAPI;
  });

  it('calls onPageChange when a menu item is clicked', async () => {
    const onPageChange = vi.fn();

    await renderSidebar({ currentPage: 'home', onPageChange });

    fireEvent.click(screen.getByText('Plan'));

    expect(onPageChange).toHaveBeenCalledWith('plan');
  });

  it('suppresses lock indicators while onboarding status is unresolved', async () => {
    mockOnboardingStatus = null;
    getPageAccessStatus.mockImplementation(() => ({
      isLocked: true,
      requiredStep: 'firstScrape',
      reason: 'Complete your first transaction scrape to unlock this page',
    }));

    const onPageChange = vi.fn();
    const { container } = await renderSidebar({ currentPage: 'home', onPageChange });

    expect(getPageAccessStatus).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="LockIcon"]')).toBeNull();
  });

  it('renders credential fetch failures as errors rather than empty account state', async () => {
    mockCredentialsOk = false;
    mockCredentials = [];

    const { container } = await renderSidebar({ currentPage: 'home', onPageChange: vi.fn() });

    await waitFor(() => {
      expect(screen.getAllByText('Account data unavailable').length).toBeGreaterThan(0);
    });

    expect(screen.queryByText('0 Connected')).not.toBeInTheDocument();
    expect(screen.queryByText('No accounts')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="WarningAmberIcon"]')).toBeNull();

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Retry loading accounts' }));
    await waitFor(() => {
      expect(screen.getByText(
        'Account data could not be refreshed. Existing account details were kept.',
      )).toBeInTheDocument();
    });
    expect(screen.queryByText('No accounts')).not.toBeInTheDocument();
  });

  it('preserves the last successful account details when a refresh fails', async () => {
    mockCredentials = [
      {
        id: 'cred-preserved',
        vendor: 'hapoalim',
        nickname: 'Preserved Bank',
        lastUpdate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        institution_id: 10,
        institution: { institution_type: 'bank' },
      },
    ];

    await renderSidebar({ currentPage: 'home', onPageChange: vi.fn() });
    await waitFor(() => {
      expect(screen.getByText('1 Connected')).toBeInTheDocument();
    });

    mockCredentialsOk = false;
    act(() => {
      window.dispatchEvent(new Event('dataRefresh'));
    });

    await waitFor(() => {
      expect(screen.getAllByText('Account data unavailable').length).toBeGreaterThan(0);
    });

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Retry loading accounts' }));
    await waitFor(() => {
      expect(screen.getByText('Preserved Bank')).toBeInTheDocument();
    });
    expect(screen.queryByText('No accounts')).not.toBeInTheDocument();
  });

  it('opens the categories modal from the global event with vendor and transaction context', async () => {
    const onPageChange = vi.fn();

    await renderSidebar({ currentPage: 'home', onPageChange });

    act(() => {
      window.dispatchEvent(new CustomEvent('openCategoriesModal', {
        detail: {
          tab: 'create_rules',
          vendor: 'Mega Store',
          transaction: {
            identifier: 'txn-42',
            vendor: 'bank-a',
          },
        },
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('categories-modal')).toHaveTextContent(
        'categories-modal-open:2:Mega Store:txn-42:bank-a',
      );
    }, { timeout: 10_000 });
  });

  it('runs bulk refresh for stale sync and surfaces success notification', async () => {
    const user = userEvent.setup();
    const onDataRefresh = vi.fn();
    const onPageChange = vi.fn();

    mockCredentials = [
      {
        id: 'cred-stale',
        vendor: 'leumi',
        nickname: 'Old Account',
        lastUpdate: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
        institution_id: 20,
        institution: { institution_type: 'bank' },
      },
    ];

    mockPost.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        totalProcessed: 2,
        successCount: 2,
        totalTransactions: 14,
      },
    });

    await renderSidebar({ currentPage: 'home', onPageChange, onDataRefresh });

    await screen.findByText(/days ago/, {}, { timeout: 10_000 });

    await user.click(screen.getByRole('button', { name: 'Click to sync accounts' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/scrape/bulk', {});
    }, { timeout: 10_000 });

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith('Synced 2/2 accounts (14 transactions)', 'success');
      expect(onDataRefresh).toHaveBeenCalled();
    }, { timeout: 10_000 });
  }, 10_000);

  it('surfaces partial bulk refresh as a warning and refreshes successful data', async () => {
    const onPageChange = vi.fn();
    const onDataRefresh = vi.fn();
    mockCredentials = [
      {
        id: 'cred-partial',
        vendor: 'discount',
        nickname: 'Partial Account',
        lastUpdate: new Date(Date.now() - 80 * 60 * 60 * 1000).toISOString(),
        institution_id: 21,
        institution: { institution_type: 'bank' },
      },
    ];
    mockPost.mockResolvedValue({
      ok: true,
      data: {
        success: false,
        status: 'partial',
        totalProcessed: 2,
        successCount: 1,
        failureCount: 1,
        totalTransactions: 7,
      },
    });

    await renderSidebar({ currentPage: 'home', onPageChange, onDataRefresh });
    await waitFor(() => {
      expect(screen.getByText(/days ago/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Click to sync accounts' }));

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith(
        'Synced 1/2 accounts (7 transactions)',
        'warning',
      );
      expect(onDataRefresh).toHaveBeenCalledOnce();
    });
  });

  it('shows the standard error notification when bulk refresh fails', async () => {
    const onPageChange = vi.fn();

    mockCredentials = [
      {
        id: 'cred-stale-2',
        vendor: 'discount',
        nickname: 'Stale Account',
        lastUpdate: new Date(Date.now() - 80 * 60 * 60 * 1000).toISOString(),
        institution_id: 21,
        institution: { institution_type: 'bank' },
      },
    ];

    mockPost.mockResolvedValue({
      ok: false,
      statusText: 'Forbidden',
      data: { error: 'license blocked' },
    });

    await renderSidebar({ currentPage: 'home', onPageChange });

    await waitFor(() => {
      expect(screen.getByText(/days ago/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Click to sync accounts' }));

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith('Bulk sync failed', 'error');
    });
  });

  it('reacts to global open events for accounts and profile setup', async () => {
    const onPageChange = vi.fn();

    await renderSidebar({ currentPage: 'home', onPageChange });

    act(() => {
      window.dispatchEvent(new CustomEvent('openAccountsModal'));
    });
    await waitFor(() => {
      expect(screen.getByText('accounts-modal-open::')).toBeInTheDocument();
    }, { timeout: 10_000 });

    act(() => {
      window.dispatchEvent(new CustomEvent('openProfileSetup'));
    });
    expect(onPageChange).toHaveBeenCalledWith('settings');

    act(() => {
      window.dispatchEvent(new CustomEvent('openScrapeModal'));
    });
    await waitFor(() => {
      expect(screen.getByText('scrape-modal-open')).toBeInTheDocument();
    }, { timeout: 10_000 });
  });

  it('opens categories modal on guided event with requested tab', async () => {
    const onPageChange = vi.fn();

    await renderSidebar({ currentPage: 'home', onPageChange });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('guideOpenCategoriesModal', { detail: { tab: 'create_rules' } }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('categories-modal')).toHaveTextContent('categories-modal-open:2');
    });
  });

  it('defers onDataRefresh until scrape completion event when bridge exists', async () => {
    const onPageChange = vi.fn();
    const onDataRefresh = vi.fn();
    (window as any).electronAPI = { events: { onScrapeProgress: vi.fn() } };

    const view = await renderSidebar({ currentPage: 'home', onPageChange, onDataRefresh });

    act(() => {
      window.dispatchEvent(new CustomEvent('guideTriggerBulkSync'));
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/scrape/bulk', {});
    });
    expect(onDataRefresh).not.toHaveBeenCalled();

    mockScrapeEvent = { status: 'completed' };
    view.rerender(<Sidebar currentPage="home" onPageChange={onPageChange} onDataRefresh={onDataRefresh} />);

    await waitFor(() => {
      expect(onDataRefresh).toHaveBeenCalled();
    });
  });

  it('ends bridge-backed syncing and refreshes data on partial progress', async () => {
    const onPageChange = vi.fn();
    const onDataRefresh = vi.fn();
    (window as any).electronAPI = { events: { onScrapeProgress: vi.fn() } };

    const view = await renderSidebar({ currentPage: 'home', onPageChange, onDataRefresh });

    act(() => {
      window.dispatchEvent(new CustomEvent('guideTriggerBulkSync'));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Syncing...' })).toBeInTheDocument();
    });
    expect(onDataRefresh).not.toHaveBeenCalled();

    mockScrapeEvent = { status: 'partial' };
    view.rerender(<Sidebar currentPage="home" onPageChange={onPageChange} onDataRefresh={onDataRefresh} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Click to sync accounts' })).toBeInTheDocument();
      expect(onDataRefresh).toHaveBeenCalledOnce();
    });
  });

  it('opens accounts modal when sync is not stale', async () => {
    const onPageChange = vi.fn();
    mockCredentials = [
      {
        id: 'cred-fresh',
        vendor: 'hapoalim',
        nickname: 'Fresh Account',
        lastUpdate: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        institution_id: 30,
        institution: { institution_type: 'bank' },
      },
    ];

    await renderSidebar({ currentPage: 'home', onPageChange });

    fireEvent.click(screen.getByRole('button', { name: 'Click to sync accounts' }));

    await waitFor(() => {
      expect(screen.getByText('accounts-modal-open::')).toBeInTheDocument();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('passes investment open requests to accounts modal', async () => {
    const onPageChange = vi.fn();

    await renderSidebar({ currentPage: 'investments', onPageChange });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('openAccountsModal', {
          detail: { tab: 'investments', addFlow: true },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('accounts-modal-open:investments:add')).toBeInTheDocument();
    });
  });

  it('shows navigation shortcut hints when the sidebar is expanded', async () => {
    const onPageChange = vi.fn();

    await renderSidebar({ currentPage: 'home', onPageChange });

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Wealth')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();

    for (const shortcut of ['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6']) {
      expect(screen.getByText(shortcut)).toBeInTheDocument();
    }
  });

  it('uses the existing analysis and investments onboarding gates for Plan and Wealth', async () => {
    const onPageChange = vi.fn();

    mockOnboardingStatus = {
      profileCompleted: true,
      bankAccountLinked: true,
      creditCardLinked: true,
      firstSyncCompleted: true,
      dismissed: false,
      stats: {
        bankCount: 1,
        creditCardCount: 1,
        transactionCount: 12,
      },
    };
    getPageAccessStatus.mockImplementation((page: string) => ({
      isLocked: page === 'analysis' || page === 'investments',
      reason: page === 'analysis'
        ? 'Analysis setup required'
        : page === 'investments'
          ? 'Investment setup required'
          : '',
    }));

    await renderSidebar({ currentPage: 'home', onPageChange });

    expect(Array.from(new Set(getPageAccessStatus.mock.calls.map(([page]) => page)))).toEqual([
      'home',
      'review',
      'activity',
      'analysis',
      'investments',
      'settings',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Analysis setup required' }));
    fireEvent.click(screen.getByRole('button', { name: 'Investment setup required' }));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('does not navigate when a sidebar page is locked', async () => {
    const onPageChange = vi.fn();

    mockOnboardingStatus = {
      profileCompleted: true,
      bankAccountLinked: true,
      creditCardLinked: true,
      firstSyncCompleted: true,
      dismissed: false,
      stats: {
        bankCount: 1,
        creditCardCount: 1,
        transactionCount: 12,
      },
    };
    getPageAccessStatus.mockImplementation((page: string) => {
      if (page === 'investments') {
        return {
          isLocked: true,
          reason: 'Finish setup first',
        };
      }

      return {
        isLocked: false,
        reason: '',
      };
    });

    await renderSidebar({ currentPage: 'home', onPageChange });

    fireEvent.click(screen.getByRole('button', { name: 'Finish setup first' }));

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('shows backend message when bulk refresh returns success=false', async () => {
    const onPageChange = vi.fn();
    mockCredentials = [
      {
        id: 'cred-stale-3',
        vendor: 'leumi',
        nickname: 'Stale 3',
        lastUpdate: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
        institution_id: 31,
        institution: { institution_type: 'bank' },
      },
    ];
    mockPost.mockResolvedValue({
      ok: true,
      data: {
        success: false,
        message: 'Partial failure',
      },
    });

    await renderSidebar({ currentPage: 'home', onPageChange });

    fireEvent.click(screen.getByRole('button', { name: 'Click to sync accounts' }));

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith('Partial failure', 'error');
    });
  });

  it('dispatches dataRefresh when sync succeeds without onDataRefresh callback', async () => {
    const onPageChange = vi.fn();
    const dataRefreshListener = vi.fn();
    window.addEventListener('dataRefresh', dataRefreshListener);
    mockCredentials = [
      {
        id: 'cred-stale-4',
        vendor: 'discount',
        nickname: 'Stale 4',
        lastUpdate: new Date(Date.now() - 80 * 60 * 60 * 1000).toISOString(),
        institution_id: 32,
        institution: { institution_type: 'bank' },
      },
    ];
    mockPost.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        totalProcessed: 0,
        successCount: 0,
        totalTransactions: 0,
      },
    });

    await renderSidebar({ currentPage: 'home', onPageChange });

    fireEvent.click(screen.getByRole('button', { name: 'Click to sync accounts' }));

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith('All accounts are up to date', 'success');
    });
    await waitFor(() => {
      expect(dataRefreshListener).toHaveBeenCalled();
    });

    window.removeEventListener('dataRefresh', dataRefreshListener);
  });

  it('shows fallback error notification when bulk refresh throws', async () => {
    const onPageChange = vi.fn();
    mockCredentials = [
      {
        id: 'cred-stale-5',
        vendor: 'isracard',
        nickname: 'Stale 5',
        lastUpdate: new Date(Date.now() - 90 * 60 * 60 * 1000).toISOString(),
        institution_id: 33,
        institution: { institution_type: 'credit_card' },
      },
    ];
    mockPost.mockRejectedValue(new Error('network down'));

    await renderSidebar({ currentPage: 'home', onPageChange });

    fireEvent.click(screen.getByRole('button', { name: 'Click to sync accounts' }));

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith('Bulk sync failed', 'error');
    });
  });

  it('shows add-account pairing gap guidance when current-month missing amount exists', async () => {
    const onPageChange = vi.fn();
    mockPairingGap = {
      windowDays: 30,
      windowStartDate: '2026-02-08',
      windowEndDate: '2026-03-08',
      tolerance: 2,
      totals: {
        bankAmount: 1000,
        cardAmount: 900,
        missingAmount: 100,
        affectedPairingsCount: 1,
        affectedCyclesCount: 1,
      },
      pairings: [{ pairingId: 1, missingAmount: 100 }],
      generatedAt: '2026-03-08T00:00:00.000Z',
    };

    await renderSidebar({ currentPage: 'home', onPageChange });

    const addAccountButton = screen.getByRole('button', { name: 'Add Account' });
    fireEvent.mouseOver(addAccountButton);

    await waitFor(() => {
      expect(
        screen.getByText(
          'Current month may be missing card transactions. Open Account Pairing for unmatched cards and run Recovery Sync (100 days).',
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('WarningAmberIcon')).toBeInTheDocument();
  });

  it('shows add-account warning when investment suggestions are available', async () => {
    const onPageChange = vi.fn();
    mockInvestmentSuggestions = [
      {
        categoryName: 'פיקדון',
        transactionCount: 1,
      },
    ];

    await renderSidebar({ currentPage: 'home', onPageChange });

    const addAccountButton = screen.getByRole('button', { name: 'Add Account' });
    fireEvent.mouseOver(addAccountButton);

    await waitFor(() => {
      expect(
        screen.getByText('You have investment transactions ready to link in Investments & Savings.'),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('WarningAmberIcon')).toBeInTheDocument();
  });
});
