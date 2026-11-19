import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import en from '../../../i18n/locales/en.json';
import UsageAnalyticsPanel from '../components/UsageAnalyticsPanel';

vi.mock('react-i18next', () => ({
  useTranslation: (_namespace: string, options?: { keyPrefix?: string }) => ({
    t: (key: string) => `${options?.keyPrefix || ''}.${key}`.split('.').filter(Boolean)
      .reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], en),
  }),
}));

type Settings = {
  usageAnalytics: { enabled: boolean; decidedAt: string | null };
  installationActivity: { enabled: boolean; excluded: boolean; consentedAt: string | null };
};
type Patch = { usageAnalytics?: Partial<Settings['usageAnalytics']>; installationActivity?: Partial<Settings['installationActivity']> };
const labels = en.usageAnalytics;

function bridge({ available = true, environmentExcluded = false, failUpdates = false } = {}) {
  let settings: Settings = {
    usageAnalytics: { enabled: true, decidedAt: '2026-11-03T10:00:00.000Z' },
    installationActivity: { enabled: false, excluded: false, consentedAt: null },
  };
  const update = vi.fn(async (patch: Patch) => {
    if (failUpdates) return { success: false, error: 'not_saved' };
    settings = {
      usageAnalytics: { ...settings.usageAnalytics, ...patch.usageAnalytics },
      installationActivity: { ...settings.installationActivity, ...patch.installationActivity },
    };
    return { success: true, settings };
  });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
    settings: { get: async () => ({ success: true, settings }), update, onChange: () => () => {} },
    analytics: { getStatus: async () => ({ success: true, status: {
      available: true, enabled: true,
      installationActivity: { available, enabled: false, excluded: environmentExcluded, excludedByEnvironment: environmentExcluded },
    } }) },
  } });
  return { update };
}

afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'electronAPI'); });

describe('active installation consent and owner exclusion', () => {
  test('existing anonymous consent never enables installation counting', async () => {
    const { update } = bridge();
    render(<UsageAnalyticsPanel />);
    await waitFor(() => expect(screen.getByLabelText(labels.installationCounting.toggle)).toBeEnabled());
    expect(screen.getByLabelText(labels.panel.toggle)).toBeChecked();
    expect(screen.getByLabelText(labels.installationCounting.toggle)).not.toBeChecked();
    expect(update).not.toHaveBeenCalled();
  });

  test('counting requires its own opt-in and can be turned off independently', async () => {
    const { update } = bridge();
    render(<UsageAnalyticsPanel />);
    const toggle = screen.getByLabelText(labels.installationCounting.toggle);
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(update).toHaveBeenLastCalledWith({ installationActivity: {
      enabled: true, consentedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    } });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(update).toHaveBeenLastCalledWith({ installationActivity: { enabled: false } });
    expect(screen.getByLabelText(labels.panel.toggle)).toBeChecked();
  });

  test('owner exclusion turns counting off and blocks both kinds of reporting', async () => {
    const { update } = bridge();
    render(<UsageAnalyticsPanel />);
    const exclude = screen.getByLabelText(labels.installationCounting.exclude);
    await waitFor(() => expect(exclude).toBeEnabled());
    fireEvent.click(exclude);
    await waitFor(() => expect(exclude).toBeChecked());
    expect(update).toHaveBeenLastCalledWith({ installationActivity: { excluded: true, enabled: false } });
    expect(screen.getByLabelText(labels.installationCounting.toggle)).toBeDisabled();
    expect(screen.getByLabelText(labels.panel.toggle)).toBeDisabled();
    expect(screen.getByText(labels.installationCounting.excluded)).toBeInTheDocument();
    fireEvent.click(exclude);
    await waitFor(() => expect(exclude).not.toBeChecked());
    expect(screen.getByLabelText(labels.installationCounting.toggle)).not.toBeChecked();
  });

  test('an environment exclusion cannot be overridden in Settings', async () => {
    bridge({ environmentExcluded: true });
    render(<UsageAnalyticsPanel />);
    await waitFor(() => expect(screen.getByLabelText(labels.installationCounting.exclude)).toBeChecked());
    expect(screen.getByLabelText(labels.installationCounting.exclude)).toBeDisabled();
    expect(screen.getByLabelText(labels.installationCounting.toggle)).toBeDisabled();
  });

  test('unconfigured collectors cannot accept counting consent', async () => {
    bridge({ available: false });
    render(<UsageAnalyticsPanel />);
    await waitFor(() => expect(screen.getByText(labels.installationCounting.unavailable)).toBeInTheDocument());
    expect(screen.getByLabelText(labels.installationCounting.toggle)).toBeDisabled();
    expect(screen.getByLabelText(labels.panel.toggle)).toBeEnabled();
  });

  test('failed saves leave counting disabled and show a recoverable error', async () => {
    bridge({ failUpdates: true });
    render(<UsageAnalyticsPanel />);
    const toggle = screen.getByLabelText(labels.installationCounting.toggle);
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText(labels.panel.saveFailed)).toBeInTheDocument());
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
  });
});
