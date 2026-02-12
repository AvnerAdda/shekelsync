import { test, expect } from '@playwright/test';
import { goHome, openAnalysisPage, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test.setTimeout(120_000);

test('primary navigation routes render without Next.js', async ({ page }) => {
  await goHome(page);
  await openAnalysisPage(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: /^Settings$/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Appearance')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Investments' }).click();
  await expect(page.getByRole('heading', { name: 'Investments Dashboard' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Portfolio Value', { exact: true })).toBeVisible({ timeout: 30_000 });
});
