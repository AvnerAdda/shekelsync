import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('Analysis Spending tab shows chart and targets', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Analysis' }).click();

  // Spending tab
  await page.getByRole('tab', { name: 'Spending' }).click();
  await expect(page.getByText('Spending Categories')).toBeVisible();
  await expect(page.getByText('Target vs Actual Allocation')).toBeVisible();

  // Targets section
  await expect(page.getByText('Essential', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Reward', { exact: true }).first()).toBeVisible();
});
