import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('budget forecast list shows categories and statuses', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Analysis' }).click();
  await page.getByRole('tab', { name: 'Budget' }).click();
  await expect(page.getByRole('heading', { name: /Budget risk outlook/i })).toBeVisible();
  await expect(page.getByText('Groceries').first()).toBeVisible();
  await expect(page.getByText('Transport').first()).toBeVisible();
  await expect(page.getByText(/At risk/i)).toBeVisible();
  await expect(page.getByText(/Over Budget/i)).toBeVisible();
});
