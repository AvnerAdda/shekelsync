import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { goHome, setupRendererTest } from './helpers/renderer-app';

const { version } = JSON.parse(fs.readFileSync(new URL('../../app/package.json', import.meta.url), 'utf8'));

async function setupReleaseSettings(page: Page, seenVersion: string) {
  await setupRendererTest(page);
  await page.addInitScript((initialVersion) => {
    const key = 'test-release-announcement';
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({ lastSeenReleaseVersion: initialVersion }));
    }
    (window as any).electronAPI = {
      app: { getVersion: async () => 'test' },
      settings: {
        get: async () => ({ success: true, settings: JSON.parse(localStorage.getItem(key) || '{}') }),
        update: async (patch: Record<string, unknown>) => {
          const settings = { ...JSON.parse(localStorage.getItem(key) || '{}'), ...patch };
          localStorage.setItem(key, JSON.stringify(settings));
          return { success: true, settings };
        },
        onChange: () => () => {},
      },
    };
  }, seenVersion);
}

test('announces the installed release once, then allows reopening from the update menu', async ({ page }, testInfo) => {
  await setupReleaseSettings(page, '0.1.0');
  await goHome(page);
  const dialog = page.getByRole('dialog', { name: 'What’s new', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`Version ${version}`)).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Added', exact: true })).toBeAttached();
  await expect(dialog.getByText('Multi-track mortgage planning in Wealth', { exact: false })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('whats-new.png') });

  await dialog.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.waitForFunction((currentVersion) => (
    JSON.parse(localStorage.getItem('test-release-announcement') || '{}').lastSeenReleaseVersion === currentVersion
  ), version);

  await page.reload();
  await expect(page.locator('[data-dashboard-ready="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByRole('menuitem', { name: 'What’s new in this version' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('keeps acknowledged versions quiet at startup', async ({ page }) => {
  await setupReleaseSettings(page, version);
  await goHome(page);
  await expect(page.locator('[data-dashboard-ready="true"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'What’s new', exact: true })).not.toBeVisible();
});
