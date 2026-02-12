import { test, expect } from '@playwright/test';
import { goHome, openAnalysisPage, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test.setTimeout(120_000);

test('Analysis Spending tab shows chart and targets', async ({ page }) => {
  await goHome(page);
  await openAnalysisPage(page);

  // Spending tab
  await page.getByRole('tab', { name: 'Spending' }).click();
  await expect(page.getByText('Spending Categories')).toBeVisible();
  await expect(page.getByText(/Target vs Actual Allocation/i)).toBeVisible();

  // Targets section
  await expect(page.getByText('Essential', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Reward', { exact: true }).first()).toBeVisible();
});
