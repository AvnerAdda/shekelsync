import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('Analysis page shows populated Budget and Scoring tabs', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByRole('heading', { name: /Financial Analysis/i })).toBeVisible();

  // Budget tab
  await page.getByRole('tab', { name: 'Budget' }).click();
  await expect(page.getByText('Budget Health Monitor')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Groceries' }).first()).toBeVisible();
  await expect(page.getByText('Smart Budget Suggestions')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Transport' }).first()).toBeVisible();

  // Scoring tab (Financial Health Score)
  await page.getByRole('tab', { name: 'Scoring' }).click();
  await expect(page.getByText('Financial Health Score')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Savings' }).first()).toBeVisible();
});
