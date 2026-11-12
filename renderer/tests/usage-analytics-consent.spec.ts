import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { goHome, setupRendererTest } from './helpers/renderer-app';

const { version } = JSON.parse(fs.readFileSync(new URL('../../app/package.json', import.meta.url), 'utf8'));

test('analytics consent stays dismissible when Windows cannot save the choice', async ({ page }) => {
  await setupRendererTest(page);
  await page.addInitScript((installedVersion) => {
    (window as any).__analyticsChoices = [];
    (window as any).electronAPI = {
      app: { getVersion: async () => installedVersion },
      settings: {
        get: async () => ({
          success: true,
          settings: { lastSeenReleaseVersion: installedVersion, usageAnalytics: { enabled: false, decidedAt: null } },
        }),
        update: async (patch: Record<string, unknown>) => {
          (window as any).__analyticsChoices.push(patch);
          return { success: false, error: 'EPERM: operation not permitted, fsync' };
        },
        onChange: () => () => {},
      },
      analytics: { getStatus: async () => ({ success: true, status: { available: true, enabled: false } }) },
    };
  }, version);

  await goHome(page);
  const dialog = page.getByRole('dialog', { name: 'Help improve ShekelSync?', exact: true });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'No thanks', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Could not save your choice. Please try again.');
  await expect(dialog.getByRole('button', { name: 'No thanks', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-dashboard-ready="true"]')).toBeVisible();

  const choices = await page.evaluate(() => (window as any).__analyticsChoices);
  expect(choices).toHaveLength(1);
  expect(choices[0].usageAnalytics).toMatchObject({ enabled: false });
  expect(choices[0].usageAnalytics.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});
