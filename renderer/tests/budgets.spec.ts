import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('budgets page shows cards and create dialog fields', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Budgets' }).click();
  await expect(page.getByRole('heading', { name: 'Budget Management' })).toBeVisible();
  await expect(page.getByText('Rent')).toBeVisible();

  await page.getByRole('button', { name: 'Create Budget' }).click();
  await expect(page.getByText('Create New Budget')).toBeVisible();

  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible();

  const limitInput = page.getByLabel('Budget Limit (₪)');
  await limitInput.fill('4500');
  await expect(limitInput).toHaveValue('4500');

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Create New Budget')).not.toBeVisible();
});
