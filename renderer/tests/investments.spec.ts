import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('investments accordion reveals account details', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Investments' }).click();
  await expect(page.getByRole('heading', { name: 'Investments Dashboard' })).toBeVisible();
  await expect(page.getByText('Portfolio Value', { exact: true })).toBeVisible();
  await expect(page.getByText('Brokerage Demo', { exact: true }).first()).toBeVisible();
});
