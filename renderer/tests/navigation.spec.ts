import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('primary navigation routes render without Next.js', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByRole('tab', { name: 'Budget' })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText('Appearance')).toBeVisible();

  await page.getByRole('button', { name: 'Investments' }).click();
  await expect(page.getByRole('heading', { name: 'Investments Dashboard' })).toBeVisible();
  await expect(page.getByText('Portfolio Value', { exact: true })).toBeVisible();
});
