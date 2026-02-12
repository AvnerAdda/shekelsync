import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from '../Sidebar';

const showNotification = vi.fn();
const getPageAccessStatus = vi.fn();
const mockGet = vi.fn();
const mockPost = vi.fn();

let mockCredentials: any[] = [];
let mockInvestmentAccounts: any[] = [];
let mockUncategorizedCount = 0;
let mockPingOk = true;
let mockScrapeEvent: any = null;
let mockLicenseCheck = { isReadOnly: false, reason: undefined as string | undefined };

const translations: Record<string, string> = {
  'menu.overview': 'Overview',
  'menu.analysis': 'Analysis',
  'menu.investments': 'Investments',
  'menu.settings': 'Settings',
  'tooltips.collapseSidebar': 'Collapse sidebar',
  'tooltips.expandSidebar': 'Expand sidebar',
  'tooltips.addAccount': 'Add account',
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
  'stats.accountsConnected': 'accounts connected',
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
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>accounts-modal-open</div> : null),
}));

vi.mock('@renderer/shared/modals/ScrapeModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>scrape-modal-open</div> : null),
}));

vi.mock('@renderer/shared/modals/CategoryHierarchyModal', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>categories-modal-open</div> : null),
}));

vi.mock('@renderer/shared/components/LicenseReadOnlyAlert', () => ({
  __esModule: true,
  default: ({ open, reason }: { open: boolean; reason?: string }) =>
    open ? <div>{`license-alert:${reason || ''}`}</div> : null,
  isLicenseReadOnlyError: () => mockLicenseCheck,
}));

function setupDefaultApiMocks() {
  mockGet.mockImplementation((endpoint: string) => {
    if (endpoint === '/api/credentials') {
      return Promise.resolve({ ok: true, data: mockCredentials });
    }
    if (endpoint === '/api/ping') {
      return Promise.resolve({ ok: mockPingOk, data: {} });
    }
    if (endpoint === '/api/investments/accounts') {
      return Promise.resolve({ ok: true, data: { accounts: mockInvestmentAccounts } });
    }
    if (endpoint === '/api/categories/hierarchy') {
      return Promise.resolve({ ok: true, data: { uncategorized: { totalCount: mockUncategorizedCount } } });
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
  await act(async () => {
    render(<Sidebar {...props} />);
    await Promise.resolve();
  });
}

describe('Sidebar component', () => {
  beforeEach(() => {
    showNotification.mockReset();
    getPageAccessStatus.mockReset();
    mockGet.mockReset();
    mockPost.mockReset();

    mockScrapeEvent = null;
    mockLicenseCheck = { isReadOnly: false, reason: undefined };
    mockPingOk = true;
    mockUncategorizedCount = 0;

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

    fireEvent.click(screen.getByText('Analysis'));

    expect(onPageChange).toHaveBeenCalledWith('analysis');
  });

  it('runs bulk refresh for stale sync and surfaces success notification', async () => {
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

    await waitFor(() => {
      expect(screen.getByText(/days ago/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Click to sync accounts' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/scrape/bulk', {});
    });

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith('Synced 2/2 accounts (14 transactions)', 'success');
      expect(onDataRefresh).toHaveBeenCalled();
    });
  });

  it('opens read-only license alert when bulk refresh is blocked', async () => {
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

    mockLicenseCheck = { isReadOnly: true, reason: 'License is read-only' };
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
      expect(screen.getByText('license-alert:License is read-only')).toBeInTheDocument();
    });
  });

  it('reacts to global open events for accounts and profile setup', async () => {
    const onPageChange = vi.fn();

    await renderSidebar({ currentPage: 'home', onPageChange });

    act(() => {
      window.dispatchEvent(new CustomEvent('openAccountsModal'));
    });
    await waitFor(() => {
      expect(screen.getByText('accounts-modal-open')).toBeInTheDocument();
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('openProfileSetup'));
    });
    expect(onPageChange).toHaveBeenCalledWith('settings');
  });
});
