import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { goHome, setupRendererTest } from './helpers/renderer-app';

const performanceBudgets = JSON.parse(
  fs.readFileSync(new URL('../../scripts/performance-budgets.json', import.meta.url), 'utf8'),
);
const startupBudgetMs = Number(
  process.env.DASHBOARD_STARTUP_BUDGET_MS || performanceBudgets.dashboardStartupMs,
);
const forecastRequestBudget = Number(
  process.env.DASHBOARD_FORECAST_REQUEST_BUDGET || performanceBudgets.dashboardForecastRequests,
);

test.skip(
  process.env.PLAYWRIGHT_USE_PREVIEW !== 'true',
  'Performance budgets require the production preview server.',
);

test('production dashboard stays within startup and request budgets', async ({ page }) => {
  const forecastRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/forecast/daily') {
      forecastRequests.push(url.toString());
    }
  });

  await page.addInitScript(() => {
    (window as any).__SHEKELSYNC_PERF_START__ = performance.now();
  });
  await setupRendererTest(page);
  await goHome(page);
  await expect(page.locator('[data-dashboard-ready="true"]')).toBeVisible({ timeout: startupBudgetMs });

  const startupMs = await page.evaluate(() => (
    performance.now() - Number((window as any).__SHEKELSYNC_PERF_START__ || 0)
  ));

  await page.waitForTimeout(100);
  console.log(`Dashboard startup: ${startupMs.toFixed(1)}ms; forecast requests: ${forecastRequests.length}`);
  expect(startupMs).toBeLessThan(startupBudgetMs);
  expect(forecastRequests.length).toBeLessThanOrEqual(forecastRequestBudget);
});
