import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('analysis actionability setup modal renders categories', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByRole('heading', { name: 'Financial Intelligence' })).toBeVisible();
  await expect(page.getByText('78', { exact: true })).toBeVisible();
  await expect(page.getByText(/Potential savings: ₪250/)).toBeVisible();

  await page.getByRole('button', { name: 'Setup' }).click();
  await expect(page.getByText('Actionability Settings')).toBeVisible();
  await expect(page.getByText('Groceries')).toBeVisible();
  await expect(page.getByText('High: 1')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Actionability Settings')).not.toBeVisible();
});
