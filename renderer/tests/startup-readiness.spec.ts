import { expect, test } from '@playwright/test';
import { setupRendererTest } from './helpers/renderer-app';

test('startup shell remains visible until the dashboard is usable', async ({ page }) => {
  let releaseDashboard: () => void = () => {};
  const dashboardGate = new Promise<void>((resolve) => {
    releaseDashboard = resolve;
  });

  await setupRendererTest(page, {
    'GET /api/analytics/dashboard': async ({ route }) => {
      await dashboardGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: { totalIncome: 2_000, totalExpenses: 1_200 },
          history: [],
        }),
      });
    },
  });

  await page.goto('/#/', { waitUntil: 'domcontentloaded' });

  const startupShell = page.locator('#startup-shell');
  await expect(startupShell).toBeVisible();
  await expect(startupShell.getByText('Opening your dashboard...')).toBeVisible();
  await expect(page.locator('[data-dashboard-ready="true"]')).not.toBeVisible();

  releaseDashboard();

  await expect(page.locator('[data-dashboard-ready="true"]')).toBeVisible({ timeout: 30_000 });
  await expect(startupShell).toHaveCount(0);
});
