import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, beforeEach, expect, vi } from 'vitest';
import DiagnosticsPanel from '../DiagnosticsPanel';

type ElectronApiOverrides = {
  diagnostics?: Partial<ElectronDiagnosticsApi>;
  file?: Partial<ElectronFileApi>;
};

const buildElectronApi = (overrides: ElectronApiOverrides = {}): ElectronAPI => {
  const diagnostics: ElectronDiagnosticsApi = {
    getInfo: vi.fn().mockResolvedValue({ success: true }),
    openLogDirectory: vi.fn().mockResolvedValue({ success: true }),
    exportDiagnostics: vi.fn().mockResolvedValue({ success: true }),
    ...overrides.diagnostics,
  };
  const file: ElectronFileApi = {
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: true }),
    showOpenDialog: vi.fn(),
    writeFile: vi.fn(),
    ...overrides.file,
  };
  return {
    diagnostics,
    file,
  };
};

beforeEach(() => {
  window.electronAPI = undefined;
  vi.useRealTimers();
});

describe('DiagnosticsPanel', () => {
  it('renders fallback message when diagnostics tools are unavailable', () => {
    render(<DiagnosticsPanel />);

    expect(
      screen.getByText(/diagnostics tooling is only available/i),
    ).toBeInTheDocument();

    const openButton = screen.getByRole('button', { name: /open log folder/i });
    const exportButton = screen.getByRole('button', { name: /export diagnostics/i });
    expect(openButton).toBeDisabled();
    expect(exportButton).toBeDisabled();
  });

  it('loads diagnostics info from the main process bridge', async () => {
    const getInfo = vi.fn().mockResolvedValue({
      success: true,
      logDirectory: '/tmp/logs',
      appVersion: '0.3.0',
      platform: 'linux',
    });
    window.electronAPI = buildElectronApi({
      diagnostics: { getInfo },
    });

    render(<DiagnosticsPanel />);

    await waitFor(() => expect(getInfo).toHaveBeenCalled());
    expect(screen.getByText('/tmp/logs')).toBeInTheDocument();
    expect(screen.getByText(/version: 0\.3\.0/i)).toBeInTheDocument();
    expect(screen.getByText(/platform: linux/i)).toBeInTheDocument();
  });

  it('invokes open log directory handler and shows success state', async () => {
    const openLogDirectory = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = buildElectronApi({
      diagnostics: { openLogDirectory },
    });

    render(<DiagnosticsPanel />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /open log folder/i })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: /open log folder/i }));
    await waitFor(() => expect(openLogDirectory).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/failed to open log directory/i)).not.toBeInTheDocument();
  });

  it('exports diagnostics bundle when save dialog provides a destination', async () => {
    const exportDiagnostics = vi.fn().mockResolvedValue({ success: true });
    const showSaveDialog = vi
      .fn()
      .mockResolvedValue({ canceled: false, filePath: '/tmp/diag.json' });

    window.electronAPI = buildElectronApi({
      diagnostics: { exportDiagnostics },
      file: { showSaveDialog },
    });

    render(<DiagnosticsPanel />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /export diagnostics/i })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: /export diagnostics/i }));

    await waitFor(() => expect(showSaveDialog).toHaveBeenCalledTimes(1));
    expect(exportDiagnostics).toHaveBeenCalledWith('/tmp/diag.json');
  });
});
