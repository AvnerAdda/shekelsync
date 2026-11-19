import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { goHome, setupRendererTest } from './helpers/renderer-app';

const { version } = JSON.parse(fs.readFileSync(new URL('../../app/package.json', import.meta.url), 'utf8'));

test('installation counts need separate consent and owner exclusion persists after reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await setupRendererTest(page);
  await page.addInitScript((installedVersion) => {
    const key = 'test-installation-activity-settings';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      lastSeenReleaseVersion: installedVersion,
      usageAnalytics: { enabled: true, decidedAt: '2026-11-03T10:00:00.000Z' },
      installationActivity: { enabled: false, excluded: false, consentedAt: null },
    }));
    localStorage.setItem('theme-mode', 'light');
    const get = () => JSON.parse(localStorage.getItem(key) || '{}');
    (window as any).electronAPI = {
      app: { getVersion: async () => installedVersion },
      settings: {
        get: async () => ({ success: true, settings: get() }),
        update: async (patch: Record<string, any>) => {
          const current = get();
          const settings = { ...current, ...patch,
            usageAnalytics: { ...current.usageAnalytics, ...patch.usageAnalytics },
            installationActivity: { ...current.installationActivity, ...patch.installationActivity } };
          localStorage.setItem(key, JSON.stringify(settings));
          return { success: true, settings };
        },
        onChange: () => () => {},
      },
      analytics: { getStatus: async () => ({ success: true, status: {
        available: true, enabled: true, installationActivity: { available: true, enabled: get().installationActivity.enabled, excluded: get().installationActivity.excluded },
      } }) },
    };
  }, version);
  await goHome(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Privacy & Security', exact: true }).click();
  const panel = page.getByTestId('usage-analytics-panel');
  const counting = panel.getByLabel('Include this installation in active-usage counts', { exact: true });
  const exclusion = panel.getByLabel('Exclude this installation from all usage statistics', { exact: true });
  await expect(counting).not.toBeChecked();
  await counting.check();
  await expect(counting).toBeChecked();
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: '/tmp/shekelsync-active-installations.png', animations: 'disabled' });
  await exclusion.check();
  await expect(counting).not.toBeChecked();
  await expect(counting).toBeDisabled();
  await page.reload();
  await expect(exclusion).toBeChecked();
  await expect(counting).toBeDisabled();
  await expect(panel.getByLabel('Share anonymous usage statistics', { exact: true })).toBeDisabled();
});
