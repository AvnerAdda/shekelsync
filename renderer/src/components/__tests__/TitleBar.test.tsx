import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import TitleBar from '@renderer/components/TitleBar';

vi.mock('@renderer/components/SmartNotifications', () => ({
  __esModule: true,
  default: () => <div data-testid="smart-notifications" />,
}));

vi.mock('@app/public/logo.svg?url', () => ({
  __esModule: true,
  default: 'logo.svg',
}));

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const createElectronApi = () => {
  const minimize = vi.fn().mockResolvedValue(undefined);
  const maximize = vi.fn().mockResolvedValue(true);
  const close = vi.fn().mockResolvedValue(undefined);
  const isMaximized = vi.fn().mockResolvedValue(false);
  const openLogDirectory = vi.fn().mockResolvedValue({ success: true });
  const exportDiagnostics = vi.fn().mockResolvedValue({ success: true });
  const showSaveDialog = vi
    .fn()
    .mockResolvedValue({ canceled: false, filePath: '/tmp/diag.json' });

  let stateListener: ((payload?: { maximized?: boolean }) => void) | undefined;

  window.electronAPI = {
    window: {
      minimize,
      maximize,
      close,
      isMaximized,
    },
    diagnostics: {
      openLogDirectory,
      exportDiagnostics,
    },
    file: {
      showSaveDialog,
    },
    events: {
      onWindowStateChanged: (callback) => {
        stateListener = callback;
        return () => {
          stateListener = undefined;
        };
      },
    },
  };

  return {
    minimize,
    maximize,
    close,
    isMaximized,
    openLogDirectory,
    exportDiagnostics,
    showSaveDialog,
    triggerState: (payload: { maximized?: boolean }) => stateListener?.(payload),
    hasStateListener: () => typeof stateListener === 'function',
  };
};

const renderTitleBar = (props: Partial<ComponentProps<typeof TitleBar>> = {}) => {
  const theme = createTheme();
  const container =
    document.getElementById('root') ??
    (() => {
      const node = document.createElement('div');
      node.id = 'root';
      document.body.appendChild(node);
      return node;
    })();

  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <TitleBar sessionDisplayName="Taylor" {...props} />
      </ThemeProvider>
    </MemoryRouter>,
    { container },
  );
};

describe('TitleBar (renderer)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    navigateMock.mockReset();
  });

  it('invokes window controls exposed by the Electron preload bridge', async () => {
    const api = createElectronApi();
    renderTitleBar();

    fireEvent.click(screen.getByLabelText(/minimize window/i));
    expect(api.minimize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText(/maximize window/i));
    await waitFor(() => expect(api.maximize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText(/close window/i));
    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it('navigates using the menu shortcuts and exports diagnostics bundles', async () => {
    const api = createElectronApi();
    renderTitleBar();

    const clickMenuItem = async (label: RegExp | string) => {
      const item = await screen.findByText(label);
      fireEvent.click(item);
    };

    const menuButton = screen.getByLabelText(/open menu/i);
    fireEvent.click(menuButton);
    await clickMenuItem(/Go/i);
    await clickMenuItem(/Analysis/i);
    expect(navigateMock).toHaveBeenCalledWith('/analysis');

    fireEvent.click(menuButton);
    await clickMenuItem(/Help/i);
    await clickMenuItem(/Open Log Folder/i);
    await waitFor(() => expect(api.openLogDirectory).toHaveBeenCalledTimes(1));

    fireEvent.click(menuButton);
    await clickMenuItem(/Help/i);
    await clickMenuItem(/Export Diagnostics/i);
    await waitFor(() => expect(api.showSaveDialog).toHaveBeenCalled());
    expect(api.exportDiagnostics).toHaveBeenCalledWith('/tmp/diag.json');
  });

  it('updates the maximize control label when window maximize events are emitted', async () => {
    const api = createElectronApi();
    renderTitleBar();

    await waitFor(() => expect(api.isMaximized).toHaveBeenCalled());
    await waitFor(() => expect(api.hasStateListener()).toBe(true));

    await screen.findByRole('button', { name: /maximize window/i });

    await act(async () => {
      api.triggerState({ maximized: true });
    });
    await screen.findByRole('button', { name: /restore window/i });

    await act(async () => {
      api.triggerState({ maximized: false });
    });
    await screen.findByRole('button', { name: /maximize window/i });
  });
});
