import { test, expect } from '@playwright/test';
import { goHome, openAnalysisPage, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test.setTimeout(120_000);

test('analysis tabs stay within the viewport at narrow desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await goHome(page);
  await openAnalysisPage(page);

  const tabList = page.getByRole('tablist', { name: /analysis tabs/i });
  await expect(tabList).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Profiling' })).toBeAttached();

  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(viewportWidth);

  const profilingTab = page.getByRole('tab', { name: 'Profiling' });
  await profilingTab.click();
  await expect(profilingTab).toHaveAttribute('aria-selected', 'true');
});

test('primary navigation routes render without Next.js', async ({ page }) => {
  await goHome(page);
  await openAnalysisPage(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: /^Settings$/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('tab', { name: 'Appearance' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Investments' }).click();
  await expect(page.getByRole('heading', { name: 'Investments Dashboard' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Portfolio Value', { exact: true })).toBeVisible({ timeout: 30_000 });
});
