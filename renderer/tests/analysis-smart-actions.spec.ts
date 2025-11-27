import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('Analysis Smart Actions tab generates and resolves an action', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Analysis' }).click();

  // Actions tab
  await page.getByRole('tab', { name: 'Actions' }).click();
  await expect(page.getByText('Unusual fuel spike')).toBeVisible();
  await expect(page.getByText('Budget overrun risk')).toBeVisible();

  // Resolve the action via status chips
  await page.getByRole('button', { name: 'Resolve' }).first().click({ timeout: 5000 });
  await expect(page.getByLabel('Resolve Action').getByText('Unusual fuel spike')).toBeVisible();
});
