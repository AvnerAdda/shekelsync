import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('Accounts modal opens and displays merged account', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Add Account' }).click();

  await expect(page.getByText('Accounts Management')).toBeVisible();
  await expect(page.getByText('Test Card')).toBeVisible();
  await page.getByRole('tab', { name: 'Investments & Savings' }).click();
  await expect(page.getByText('Brokerage Demo')).toBeVisible();
});

test('Category hierarchy modal renders sample data', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Categories' }).click();

  await expect(page.getByRole('heading', { name: 'Category Hierarchy' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
});

test('Scrape modal can be opened via custom event', async ({ page }) => {
  await goHome(page);

  await page.evaluate(() => {
    window.dispatchEvent(new Event('openScrapeModal'));
  });

  await expect(page.getByText('Sync Transactions')).toBeVisible();
  await expect(page.getByRole('button', { name: 'SYNC' })).toBeVisible();
});
