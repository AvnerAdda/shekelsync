import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLicense } from '@renderer/features/onboarding/hooks/useLicense';

const PUBLIC_STATUS = {
  registered: true,
  licenseType: 'pro',
  isReadOnly: false,
  canWrite: true,
  offlineMode: false,
  syncedToCloud: true,
};

describe('useLicense in public-access builds', () => {
  beforeEach(() => {
    delete (window as any).electronAPI;
  });

  afterEach(() => {
    delete (window as any).electronAPI;
    vi.restoreAllMocks();
  });

  it('allows full access outside Electron', async () => {
    const { result } = renderHook(() => useLicense());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status).toEqual(PUBLIC_STATUS);
    expect(result.current.isRegistered).toBe(true);
    expect(result.current.canWrite).toBe(true);
    expect(result.current.isReadOnly).toBe(false);
    expect(result.current.requiresRegistration).toBe(false);
  });

  it('fails open when the legacy license bridge cannot return a status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (window as any).electronAPI = {
      license: {
        getStatus: vi.fn().mockResolvedValue({
          success: false,
          error: 'Legacy license status unavailable',
        }),
      },
    };

    const { result } = renderHook(() => useLicense());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Legacy license status unavailable');
    expect(result.current.status).toEqual(PUBLIC_STATUS);
    expect(result.current.canWrite).toBe(true);
    expect(result.current.isReadOnly).toBe(false);
    expect(result.current.requiresRegistration).toBe(false);
  });
});
