import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AppLockGate from '../components/AppLockGate';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/app/startup/startup-readiness', () => ({
  signalStartupReady: vi.fn(),
}));

type Bridge = NonNullable<NonNullable<Window['electronAPI']>['appLock']>;

function installBridge(bridge: Bridge | undefined) {
  (window as any).electronAPI = bridge ? { appLock: bridge, platform: { isMacOS: true } } : undefined;
}

afterEach(() => {
  delete (window as any).electronAPI;
});

describe('AppLockGate', () => {
  it('renders the app directly when there is no lock bridge (browser/tests)', () => {
    installBridge(undefined);
    render(<AppLockGate><div>app content</div></AppLockGate>);
    expect(screen.getByText('app content')).toBeTruthy();
  });

  it('renders the app when the main process reports it unlocked', async () => {
    installBridge({
      getState: vi.fn().mockResolvedValue({ success: true, locked: false, method: null }),
      unlock: vi.fn(),
    });
    render(<AppLockGate><div>app content</div></AppLockGate>);
    expect(await screen.findByText('app content')).toBeTruthy();
  });

  it('keeps the app hidden and prompts once when locked', async () => {
    const unlock = vi.fn().mockResolvedValue({ success: false, locked: true, cancelled: true });
    installBridge({
      getState: vi.fn().mockResolvedValue({ success: true, locked: true, method: 'touchid' }),
      unlock,
    });
    render(<AppLockGate><div>app content</div></AppLockGate>);

    expect(await screen.findByTestId('app-lock-screen')).toBeTruthy();
    await waitFor(() => expect(unlock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('cancelled')).toBeTruthy();
    expect(screen.queryByText('app content')).toBeNull();
    expect(screen.getByText('description.touchid')).toBeTruthy();
  });

  it('shows the app after a successful retry', async () => {
    const unlock = vi.fn()
      .mockResolvedValueOnce({ success: false, locked: true, error: 'nope' })
      .mockResolvedValueOnce({ success: true, locked: false, method: 'password' });
    installBridge({
      getState: vi.fn().mockResolvedValue({ success: true, locked: true, method: 'password' }),
      unlock,
    });
    render(<AppLockGate><div>app content</div></AppLockGate>);

    expect(await screen.findByText('failed')).toBeTruthy();
    expect(screen.getByText('description.password')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'unlock' }));

    expect(await screen.findByText('app content')).toBeTruthy();
    expect(unlock).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the lock state cannot be read', async () => {
    installBridge({
      getState: vi.fn().mockRejectedValue(new Error('ipc down')),
      unlock: vi.fn().mockResolvedValue({ success: false, locked: true }),
    });
    render(<AppLockGate><div>app content</div></AppLockGate>);

    expect(await screen.findByTestId('app-lock-screen')).toBeTruthy();
    expect(screen.queryByText('app content')).toBeNull();
  });
});
