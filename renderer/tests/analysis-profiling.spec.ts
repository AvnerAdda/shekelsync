import { expect, test } from '@playwright/test';

import { goHome, openAnalysisPage, setupRendererTest, type Handler } from './helpers/renderer-app';

const jsonResponse = (data: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data),
});

test.setTimeout(120_000);

test('Analysis Profiling tab shows the missing-key state by default', async ({ page }) => {
  await setupRendererTest(page);
  await goHome(page);
  await openAnalysisPage(page);

  await page.locator('#analysis-tab-6').click();

  await expect(page.getByRole('heading', { name: 'Financial Profiling' })).toBeVisible();
  await expect(page.getByText('OpenAI key required')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Settings' })).toBeVisible();
});

test('Analysis Profiling tab shows the incomplete-profile checklist when required fields are missing', async ({ page }) => {
  const overrides: Record<string, Handler> = {
    'GET /api/analytics/profiling': async ({ route }) => {
      await route.fulfill(jsonResponse({
        missingFields: ['location', 'monthly_income'],
        isStale: false,
        staleReasons: [],
        assessment: null,
      }));
    },
  };

  await page.addInitScript(() => {
    (window as any).__SHEKELSYNC_OPENAI_API_KEY__ = 'sk-test-key';
  });
  await setupRendererTest(page, overrides);
  await goHome(page);
  await openAnalysisPage(page);

  await page.locator('#analysis-tab-6').click();

  await expect(page.getByText('Profile details are incomplete')).toBeVisible();
  await expect(page.getByText('Location')).toBeVisible();
  await expect(page.getByText('Monthly income')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete Profile' })).toBeVisible();
});

test('Analysis Profiling tab can generate and display an assessment', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__SHEKELSYNC_OPENAI_API_KEY__ = 'sk-test-key';
  });
  await setupRendererTest(page);
  await goHome(page);
  await openAnalysisPage(page);

  await page.locator('#analysis-tab-6').click();
  await expect(page.getByRole('button', { name: 'Generate profiling' })).toBeVisible();

  await page.getByRole('button', { name: 'Generate profiling' }).click();

  await expect(page.getByText('Your profile sits above the official midpoint')).toBeVisible();
  await expect(page.getByText('Comparator breakdown')).toBeVisible();
  await expect(page.getByText('National Insurance average wage, effective January 1, 2026')).toBeVisible();
});
