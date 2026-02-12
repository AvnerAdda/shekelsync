import { test, expect } from '@playwright/test';
import { goHome, openAnalysisPage, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test.setTimeout(120_000);

test('Analysis page shows populated Budget and Scoring tabs', async ({ page }) => {
  await goHome(page);
  await openAnalysisPage(page);
  const budgetTab = page.locator('#analysis-tab-3');

  // Budget tab
  await budgetTab.click();
  await expect(page.getByRole('heading', { name: /Budget risk outlook/i })).toBeVisible();
  await expect(page.getByText('Groceries').first()).toBeVisible();
  await expect(page.getByText('Transport').first()).toBeVisible();

  // Scoring tab (Financial Health Score)
  await page.locator('#analysis-tab-4').click();
  await expect(page.getByText('Financial Health Score')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Savings').first()).toBeVisible();
});
