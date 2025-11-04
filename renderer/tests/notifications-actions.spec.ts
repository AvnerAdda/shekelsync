import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('bulk refresh notification action triggers success banner', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Smart Alerts' }).click();
  await expect(page.getByRole('heading', { name: 'Smart Alerts' })).toBeVisible();

  await page.getByRole('button', { name: 'Review budgets' }).click();

  await expect(page.getByText(/Synced 1\/1 accounts/)).toBeVisible();
});
