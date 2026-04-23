import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test.setTimeout(120_000);

test('investments accordion reveals account details', async ({ page }) => {
  await goHome(page);

  const investmentsNav = page.getByRole('button', { name: 'Investments' });
  await expect(investmentsNav).toBeVisible();
  await investmentsNav.click();
  await expect(page.getByRole('heading', { name: /Investments Dashboard/i })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Portfolio Value', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Holdings / Positions', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('MSFT Core', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Cash Reserve', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Cash', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Brokerage Demo', { exact: true }).first()).toBeVisible();
});
