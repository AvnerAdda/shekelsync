import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('investments accordion reveals account details', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Investments' }).click();
  await expect(page.getByRole('heading', { name: 'Investments Dashboard' })).toBeVisible();
  await expect(page.getByText('TOTAL VALUE', { exact: true })).toBeVisible();

  await expect(page.getByText('Liquid Investments')).toBeVisible();

  // Expand the first investment group
  await page.getByRole('button', { name: /Brokerage Account/ }).click();
  await expect(page.getByText('Brokerage Demo')).toBeVisible();

  // Expand the restricted savings group as well
  await page.getByRole('button', { name: /Pension Fund/ }).click();
  await expect(page.getByText('Pension Fund', { exact: true }).nth(1)).toBeVisible();
});
