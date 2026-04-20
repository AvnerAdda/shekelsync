import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS_TAB_ID,
  getCanonicalSettingsHash,
  resolveSettingsSectionIdFromHash,
  resolveSettingsTabIdFromHash,
  SETTINGS_TABS,
  type SettingsTabId,
} from '../pages/settings-tabs';

const TAB_LABELS: Record<SettingsTabId, string> = {
  profile: 'Profile',
  appearance: 'Appearance',
  sync: 'Sync',
  privacy: 'Privacy & Security',
  system: 'System',
};

const SYNC_INPUT_LABEL = 'Sync draft';

function StatefulSyncPanel() {
  const [draft, setDraft] = React.useState('');

  return (
    <label>
      {SYNC_INPUT_LABEL}
      <input
        aria-label={SYNC_INPUT_LABEL}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </label>
  );
}

function LocationIndicator() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</div>;
}

function SettingsTabsHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTabId = resolveSettingsTabIdFromHash(location.hash) ?? DEFAULT_SETTINGS_TAB_ID;

  return (
    <>
      <div role="tablist" aria-label="Settings">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTabId === tab.id}
            onClick={() => {
              navigate(`${location.pathname}${location.search}#${getCanonicalSettingsHash(tab.id)}`);
            }}
          >
            {TAB_LABELS[tab.id]}
          </button>
        ))}
      </div>

      {SETTINGS_TABS.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          hidden={activeTabId !== tab.id}
          data-testid={`settings-tabpanel-${tab.id}`}
        >
          {tab.id === 'sync' ? <StatefulSyncPanel /> : `${TAB_LABELS[tab.id]} panel`}
        </div>
      ))}

      <LocationIndicator />
    </>
  );
}

function renderHarness(initialEntry: string | { pathname: string; hash?: string; search?: string } = '/settings') {
  const router = createMemoryRouter([
    {
      path: '/settings',
      element: <SettingsTabsHarness />,
    },
  ], {
    initialEntries: [initialEntry],
  });

  render(<RouterProvider router={router} />);
  return router;
}

describe('SettingsPage tab helpers', () => {
  it('defaults to the Profile tab for /settings', () => {
    renderHarness();

    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('settings-tabpanel-profile')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
  });

  it('maps the legacy #language hash to the Appearance tab', () => {
    renderHarness({ pathname: '/settings', hash: '#language' });

    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('settings-tabpanel-appearance')).not.toHaveAttribute('hidden');
  });

  it.each(['#chatbot', '#security'])('maps %s to the Privacy & Security tab', (hash) => {
    renderHarness({ pathname: '/settings', hash });

    expect(screen.getByRole('tab', { name: 'Privacy & Security' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('settings-tabpanel-privacy')).not.toHaveAttribute('hidden');
  });

  it('updates the URL to the canonical hash when tabs are clicked', async () => {
    renderHarness({ pathname: '/settings', hash: '#language' });

    fireEvent.click(screen.getByRole('tab', { name: 'Sync' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/settings#sync');
    });

    fireEvent.click(screen.getByRole('tab', { name: 'System' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/settings#system');
    });
  });

  it('keeps tab panel state mounted while switching tabs', async () => {
    renderHarness();

    fireEvent.click(screen.getByRole('tab', { name: 'Sync' }));

    fireEvent.change(screen.getByLabelText(SYNC_INPUT_LABEL), {
      target: { value: 'keep this draft' },
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Profile' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Sync' }));

    await waitFor(() => {
      expect(screen.getByLabelText(SYNC_INPUT_LABEL)).toHaveValue('keep this draft');
    });
  });

  it('resolves legacy hashes to the matching section id within the chosen tab', () => {
    expect(resolveSettingsSectionIdFromHash('#language', 'appearance')).toBe('language');
    expect(resolveSettingsSectionIdFromHash('#diagnostics', 'system')).toBe('diagnostics');
    expect(resolveSettingsSectionIdFromHash('#about', 'system')).toBe('about');
  });
});
