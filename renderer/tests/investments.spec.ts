import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('investments accordion reveals account details', async ({ page }) => {
  await goHome(page);

  const investmentsNav = page.getByRole('button', { name: 'Investments' });
  await expect(investmentsNav).toBeVisible();
  await investmentsNav.click();
  await expect(page.getByRole('heading', { name: /Investments Dashboard/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Portfolio Value', { exact: true })).toBeVisible();
  await expect(page.getByText('Brokerage Demo', { exact: true }).first()).toBeVisible();
});
