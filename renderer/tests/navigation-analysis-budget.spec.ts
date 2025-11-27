import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('Sidebar navigation reaches Analysis and shows Budget health statuses', async ({ page }) => {
  await goHome(page);

  // Navigate to Analysis via sidebar
  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByRole('tab', { name: 'Budget' })).toBeVisible();

  // Budget tab should surface health statuses
  await page.getByRole('tab', { name: 'Budget' }).click();
  await expect(page.getByText('Budget Health Monitor')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Groceries' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Transport' }).first()).toBeVisible();
  await expect(page.getByText('On Track', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Warning', { exact: true }).first()).toBeVisible();
});
