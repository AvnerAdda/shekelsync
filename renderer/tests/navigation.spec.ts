import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('primary navigation routes render without Next.js', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByRole('heading', { name: 'Financial Intelligence' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Setup' })).toBeVisible();

  await page.getByRole('button', { name: 'Budgets' }).click();
  await expect(page.getByRole('heading', { name: 'Budget Management' })).toBeVisible();
  await expect(page.getByText('Rent')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Budget' })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Appearance')).toBeVisible();

  await page.getByRole('button', { name: 'Investments' }).click();
  await expect(page.getByRole('heading', { name: 'Investments Dashboard' })).toBeVisible();
  await expect(page.getByText('TOTAL VALUE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Portfolio Setup' })).toBeVisible();
});
