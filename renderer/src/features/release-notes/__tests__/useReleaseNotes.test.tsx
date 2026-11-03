import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { version } from '@app/package.json';
import { signalStartupReady } from '@renderer/app/startup/startup-readiness';
import { OPEN_RELEASE_NOTES_EVENT } from '../constants';
import { useReleaseNotes } from '../useReleaseNotes';

describe('release announcements', () => {
  let stored: { lastSeenReleaseVersion?: string };
  let get: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stored = {};
    document.body.dataset.appReady = 'true';
    get = vi.fn(async () => ({ success: true, settings: { ...stored } }));
    update = vi.fn(async (patch) => {
      stored = { ...stored, ...patch };
      return { success: true, settings: stored };
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true, writable: true, value: { settings: { get, update } },
    });
  });

  afterEach(() => {
    delete document.body.dataset.appReady;
    Object.defineProperty(window, 'electronAPI', { configurable: true, writable: true, value: undefined });
  });

  it('waits for startup, shows an unseen version and persists only on dismissal', async () => {
    delete document.body.dataset.appReady;
    const { result, unmount } = renderHook(() => useReleaseNotes());
    expect(get).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
    act(() => signalStartupReady());
    await waitFor(() => expect(result.current.open).toBe(true));
    expect(update).not.toHaveBeenCalled();
    act(() => result.current.dismiss());
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(update).toHaveBeenCalledWith({ lastSeenReleaseVersion: version });
    unmount();

    const nextLaunch = renderHook(() => useReleaseNotes());
    await waitFor(() => expect(nextLaunch.result.current.pending).toBe(false));
    expect(nextLaunch.result.current.open).toBe(false);
  });

  it('shows new versions after an earlier version was acknowledged', async () => {
    stored.lastSeenReleaseVersion = '0.1.0';
    const { result } = renderHook(() => useReleaseNotes());
    await waitFor(() => expect(result.current.open).toBe(true));
  });

  it('holds the announcement while another dialog is open', async () => {
    const { result, rerender } = renderHook(({ suppressed }) => useReleaseNotes({ suppressed }), {
      initialProps: { suppressed: true },
    });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(result.current.open).toBe(false);
    expect(result.current.pending).toBe(true);
    rerender({ suppressed: false });
    await waitFor(() => expect(result.current.open).toBe(true));
  });

  it('allows the current notes to be reopened from the menu', async () => {
    stored.lastSeenReleaseVersion = version;
    const { result } = renderHook(() => useReleaseNotes());
    await waitFor(() => expect(result.current.pending).toBe(false));
    act(() => window.dispatchEvent(new Event(OPEN_RELEASE_NOTES_EVENT)));
    expect(result.current.open).toBe(true);
  });

  it('does not block the app if settings reads or writes fail', async () => {
    get.mockRejectedValue(new Error('Settings unavailable'));
    update.mockRejectedValue(new Error('Disk unavailable'));
    const { result } = renderHook(() => useReleaseNotes());
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.open).toBe(false);
    act(() => window.dispatchEvent(new Event(OPEN_RELEASE_NOTES_EVENT)));
    act(() => result.current.dismiss());
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.open).toBe(false);
  });

  it('keeps later startup prompts suppressed until the acknowledgement is saved', async () => {
    let finishSave: (value: { success: boolean }) => void = () => {};
    update.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const { result } = renderHook(() => useReleaseNotes());
    await waitFor(() => expect(result.current.open).toBe(true));
    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);
    expect(result.current.pending).toBe(true);
    await act(async () => finishSave({ success: true }));
    expect(result.current.pending).toBe(false);
  });

  it('does not reopen after dismissal when a slow settings read finishes', async () => {
    let finishRead: (value: unknown) => void = () => {};
    get.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    const { result } = renderHook(() => useReleaseNotes());
    await waitFor(() => expect(get).toHaveBeenCalled());
    act(() => window.dispatchEvent(new Event(OPEN_RELEASE_NOTES_EVENT)));
    act(() => result.current.dismiss());
    await act(async () => finishRead({ success: true, settings: {} }));
    expect(result.current.open).toBe(false);
  });
});
