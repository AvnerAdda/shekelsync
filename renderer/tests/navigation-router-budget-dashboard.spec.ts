import { test, expect } from '@playwright/test';
import { setupRendererTest, goHome } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('Router nav: Dashboard → Budgets → Analysis Budget health', async ({ page }) => {
  await goHome(page);

  // Jump directly to Analysis route
  await page.goto('/#/analysis');
  await expect(page.getByRole('tab', { name: 'Budget' })).toBeVisible();
  await page.getByRole('tab', { name: 'Budget' }).click();

  // Verify budget outlook is displayed
  await expect(page.getByRole('heading', { name: /Budget risk outlook/i })).toBeVisible();
  await expect(page.getByText('Groceries').first()).toBeVisible();
  await expect(page.getByText('Transport').first()).toBeVisible();

  // Navigate back to Dashboard
  await page.goto('/#/');
  await expect(page.getByRole('button', { name: 'Add Account' })).toBeVisible();
});
