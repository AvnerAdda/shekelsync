import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TitleBar from '../TitleBar';

const navigate = vi.fn();
const setMode = vi.fn();
const setLocale = vi.fn();
const checkForUpdates = vi.fn();
const downloadUpdate = vi.fn();
const installUpdate = vi.fn();

let mockActualTheme: 'light' | 'dark' = 'light';
let mockLocale: 'en' | 'he' | 'fr' = 'en';
let mockDonationStatus: { hasDonated: boolean; tier: 'none' | 'one_time'; supportStatus: 'none' | 'verified' | 'pending' } = {
  hasDonated: false,
  tier: 'none',
  supportStatus: 'none',
};

const translations: Record<string, string> = {
  'titleBar.tooltips.openMenu': 'Open menu',
  'titleBar.menu.file': 'File',
  'titleBar.menu.edit': 'Edit',
  'titleBar.menu.view': 'View',
  'titleBar.menu.go': 'Go',
  'titleBar.menu.help': 'Help',
  'titleBar.menu.back': 'Back',
  'titleBar.menu.items.analysis': 'Analysis',
  'titleBar.menu.items.exportDiagnostics': 'Export diagnostics',
  'titleBar.tooltips.darkMode': 'Dark mode',
  'titleBar.tooltips.lightMode': 'Light mode',
  'titleBar.tooltips.changeLanguage': 'Change language',
  'titleBar.tooltips.minimizeWindow': 'Minimize window',
  'titleBar.tooltips.maximizeWindow': 'Maximize window',
  'titleBar.tooltips.restoreWindow': 'Restore window',
  'titleBar.tooltips.closeWindow': 'Close window',
  'titleBar.search.placeholder': 'Search sections...',
  'support.titleBar.buyMeCoffee': 'Buy me a coffee',
  'common.languages.he': 'Hebrew',
  'common.languages.en': 'English',
  'common.languages.fr': 'French',
};

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: unknown }) => {
      if (Object.prototype.hasOwnProperty.call(translations, key)) {
        return translations[key];
      }
      if (typeof options?.defaultValue !== 'undefined') {
        return options.defaultValue;
      }
      return key;
    },
  }),
}));

vi.mock('@app/public/logo.svg?url', () => ({
  default: 'logo.svg',
}));

vi.mock('@renderer/features/notifications/components/SmartNotifications', () => ({
  default: () => <div data-testid="smart-notifications" />,
}));

vi.mock('@renderer/features/guide-tips/components/GuideTips', () => ({
  default: () => <div data-testid="guide-tips" />,
}));

vi.mock('../UpdateButton', () => ({
  default: () => <button type="button">update-button</button>,
}));

vi.mock('../../hooks/useUpdateManager', () => ({
  useUpdateManager: () => ({
    updateState: { status: 'idle' },
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  }),
}));

vi.mock('@renderer/contexts/ThemeContext', () => ({
  useThemeMode: () => ({
    mode: mockActualTheme,
    actualTheme: mockActualTheme,
    setMode,
  }),
}));

vi.mock('@renderer/i18n/I18nProvider', () => ({
  useLocaleSettings: () => ({
    locale: mockLocale,
    setLocale,
  }),
}));

vi.mock('@renderer/features/security/components/SecurityIndicator', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      security-indicator
    </button>
  ),
}));

vi.mock('@renderer/features/security/components/SecurityDetailsModal', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>security-modal-open</div> : null),
}));

vi.mock('@renderer/features/support', () => ({
  DONATION_OPEN_MODAL_EVENT: 'donation.open.modal',
  DonationModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div>
        <span>donation-modal-open</span>
        <button type="button" onClick={onClose}>
          close-donation-modal
        </button>
      </div>
    ) : null,
  useDonationStatus: () => ({ status: mockDonationStatus }),
}));

function buildElectronApi(isMacOS = false) {
  return {
    platform: { isMacOS },
    window: {
      isMaximized: vi.fn().mockResolvedValue(false),
      minimize: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      zoomIn: vi.fn().mockResolvedValue(undefined),
      zoomOut: vi.fn().mockResolvedValue(undefined),
      zoomReset: vi.fn().mockResolvedValue(undefined),
    },
    events: {
      onWindowStateChanged: vi.fn(() => vi.fn()),
    },
    diagnostics: {
      openLogDirectory: vi.fn().mockResolvedValue(undefined),
      exportDiagnostics: vi.fn().mockResolvedValue({ success: true }),
    },
    file: {
      showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/diagnostics.json' }),
    },
  };
}

async function renderTitleBar(props: React.ComponentProps<typeof TitleBar>) {
  await act(async () => {
    render(<TitleBar {...props} />);
    await Promise.resolve();
  });
}

describe('TitleBar component', () => {
  beforeEach(() => {
    navigate.mockReset();
    setMode.mockReset();
    setLocale.mockReset();
    checkForUpdates.mockReset();
    downloadUpdate.mockReset();
    installUpdate.mockReset();
    mockActualTheme = 'light';
    mockLocale = 'en';
    mockDonationStatus = { hasDonated: false, tier: 'none', supportStatus: 'none' };
    (window as any).electronAPI = buildElectronApi(false);
  });

  it('navigates to analysis from menu go submenu', async () => {
    await renderTitleBar({ sessionDisplayName: 'Demo User', authLoading: false });

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Analysis' }));

    expect(navigate).toHaveBeenCalledWith('/analysis');
  });

  it('toggles theme mode and applies language selection', async () => {
    await renderTitleBar({ sessionDisplayName: 'Demo User', authLoading: false });

    fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
    expect(setMode).toHaveBeenCalledWith('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Change language' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'French' }));
    expect(setLocale).toHaveBeenCalledWith('fr');
  });

  it('invokes electron window controls on non-macOS', async () => {
    await renderTitleBar({ sessionDisplayName: 'Demo User', authLoading: false });

    fireEvent.click(screen.getByRole('button', { name: 'Minimize window' }));
    fireEvent.click(screen.getByRole('button', { name: 'Maximize window' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));

    await waitFor(() => {
      expect((window as any).electronAPI.window.minimize).toHaveBeenCalledTimes(1);
      expect((window as any).electronAPI.window.maximize).toHaveBeenCalledTimes(1);
      expect((window as any).electronAPI.window.close).toHaveBeenCalledTimes(1);
    });
  });

  it('exports diagnostics via menu action and electron bridges', async () => {
    await renderTitleBar({ sessionDisplayName: 'Demo User', authLoading: false });

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export diagnostics' }));

    await waitFor(() => {
      expect((window as any).electronAPI.file.showSaveDialog).toHaveBeenCalledTimes(1);
      expect((window as any).electronAPI.diagnostics.exportDiagnostics).toHaveBeenCalledWith('/tmp/diagnostics.json');
    });
  });

  it('opens donation modal from button and global event, and hides window controls on macOS', async () => {
    (window as any).electronAPI = buildElectronApi(true);

    await renderTitleBar({ sessionDisplayName: 'Demo User', authLoading: false });

    expect(screen.queryByRole('button', { name: 'Minimize window' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Maximize window' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close window' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Buy me a coffee' }));
    expect(screen.getByText('donation-modal-open')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'close-donation-modal' }));
    await waitFor(() => {
      expect(screen.queryByText('donation-modal-open')).not.toBeInTheDocument();
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('donation.open.modal'));
    });
    await waitFor(() => {
      expect(screen.getByText('donation-modal-open')).toBeInTheDocument();
    });
  });
});
