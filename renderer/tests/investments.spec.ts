import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test.setTimeout(120_000);

test('investment tabs stay within the viewport at narrow desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await goHome(page);

  await page.getByRole('button', { name: 'Investments' }).click();
  await expect(page.getByRole('heading', { name: /Investments Dashboard/i })).toBeVisible({ timeout: 30000 });

  const tabList = page.getByRole('tablist', { name: 'Investment sections' });
  await expect(tabList).toBeVisible();
  await expect(page.getByRole('tab', { name: 'History & Details' })).toBeAttached();

  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(viewportWidth);

  const historyTab = page.getByRole('tab', { name: 'History & Details' });
  await historyTab.click();
  await expect(historyTab).toHaveAttribute('aria-selected', 'true');
});

test('investments accordion reveals account details', async ({ page }) => {
  await goHome(page);

  const investmentsNav = page.getByRole('button', { name: 'Investments' });
  await expect(investmentsNav).toBeVisible();
  await investmentsNav.click();
  await expect(page.getByRole('heading', { name: /Investments Dashboard/i })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Portfolio Value', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole('tab', { name: 'Holdings & Balance' }).click();
  await expect(page.getByText('Holdings / Positions', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('MSFT Core', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Cash Reserve', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Cash', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Brokerage Demo', { exact: true }).first()).toBeVisible();
});
