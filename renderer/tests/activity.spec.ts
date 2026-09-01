import { expect, test } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('Activity is a first-class searchable transaction ledger', async ({ page }) => {
  await goHome(page);
  await page.getByRole('button', { name: 'Activity' }).click();

  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Monthly salary')).toBeVisible();
  await expect(page.getByText('Neighborhood market')).toBeVisible();

  await page.getByText('Expenses', { exact: true }).first().click();
  await expect(page.getByText('Neighborhood market')).toBeVisible();
  await expect(page.getByText('Monthly salary')).toBeHidden();

  await page.getByRole('button', { name: 'Advanced search' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
