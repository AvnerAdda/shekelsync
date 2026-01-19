import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('Analysis page shows populated Budget and Scoring tabs', async ({ page }) => {
  await goHome(page);

  await page.goto('/#/analysis', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: 'Budget' })).toBeVisible({ timeout: 15000 });

  // Budget tab
  await page.getByRole('tab', { name: 'Budget' }).click();
  await expect(page.getByRole('heading', { name: /Budget risk outlook/i })).toBeVisible();
  await expect(page.getByText('Groceries').first()).toBeVisible();
  await expect(page.getByText('Transport').first()).toBeVisible();

  // Scoring tab (Financial Health Score)
  await page.getByRole('tab', { name: 'Scoring' }).click();
  await expect(page.getByText('Financial Health Score')).toBeVisible();
  await expect(page.getByText('Savings').first()).toBeVisible();
});
