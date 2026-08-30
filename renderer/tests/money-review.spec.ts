import { test, expect } from '@playwright/test';
import { setupRendererTest } from './helpers/renderer-app';

const reviewItems = [
  {
    id: 101,
    source: 'notification',
    sourceKey: 'money_review:notification:stale_sync:card',
    group: 'data',
    actionType: 'optimization_low_confidence',
    severity: 'critical',
    title: 'One account needs a fresh sync',
    description: 'Refresh the card account before relying on this month’s totals.',
    status: 'active',
    detectedAt: '2026-08-24T08:00:00.000Z',
    updatedAt: '2026-08-24T08:00:00.000Z',
    snoozedUntil: null,
    potentialImpact: 0,
    confidence: 0.9,
    priority: 98,
    primaryAction: { label: 'Sync account', action: 'bulk_refresh', params: {} },
    metadata: {
      notificationType: 'stale_sync',
      data: { stale_count: 1, days_since_sync: 4, oldest_account: 'Card account' },
    },
  },
  {
    id: 102,
    source: 'notification',
    sourceKey: 'money_review:notification:budget_exceeded:food',
    group: 'cash',
    actionType: 'budget_overrun',
    severity: 'high',
    title: 'Dining budget is over plan',
    description: 'Spending is ₪700 above the monthly dining budget.',
    status: 'active',
    detectedAt: '2026-08-24T08:00:00.000Z',
    updatedAt: '2026-08-24T08:00:00.000Z',
    snoozedUntil: null,
    potentialImpact: 700,
    confidence: 0.9,
    priority: 90,
    primaryAction: { label: 'Review budget', action: 'view_budgets', params: {} },
    metadata: {
      notificationType: 'budget_exceeded',
      data: { spent: 1700, budget: 1000, category_name: 'Dining' },
    },
  },
  {
    id: 103,
    source: 'optimizerV2',
    sourceKey: 'smart_action:103',
    group: 'improve',
    actionType: 'optimization_reallocate',
    severity: 'medium',
    title: 'Put this month’s surplus to work',
    description: 'Review a suggested allocation based on your confirmed cash flow.',
    status: 'accepted',
    detectedAt: '2026-08-24T08:00:00.000Z',
    updatedAt: '2026-08-24T08:00:00.000Z',
    snoozedUntil: null,
    potentialImpact: 0,
    confidence: 0.8,
    priority: 61,
    primaryAction: { label: 'Open optimizer', action: 'open_optimizer', params: {} },
    metadata: { source: 'optimizerV2', scope: 'general' },
  },
];

const reviewResponse = {
  success: true,
  generatedAt: '2026-08-24T08:30:00.000Z',
  summary: {
    open: 3,
    snoozed: 0,
    completed: 0,
    estimatedMinutes: 5,
    potentialImpact: 700,
    byGroup: { data: 1, cash: 1, improve: 1 },
  },
  items: reviewItems,
};

test('Money Review prioritizes work and exposes flexible lifecycle controls', async ({ page }, testInfo) => {
  let lifecyclePayload: Record<string, unknown> | null = null;
  let currentReviewResponse = reviewResponse;
  await setupRendererTest(page, {
    'GET /api/money-review': async ({ route }) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentReviewResponse) });
    },
    'PUT /api/money-review/items/102/status': async ({ route, request }) => {
      lifecyclePayload = request.postDataJSON() as Record<string, unknown>;
      const updatedItem = { ...reviewItems[1], status: 'snoozed', snoozedUntil: '2026-09-24T08:30:00.000Z' };
      currentReviewResponse = {
        ...reviewResponse,
        summary: {
          ...reviewResponse.summary,
          open: 2,
          snoozed: 1,
          estimatedMinutes: 3,
          potentialImpact: 0,
          byGroup: { data: 1, cash: 0, improve: 1 },
        },
        items: reviewItems.map((item) => item.id === 102 ? updatedItem : item),
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          item: updatedItem,
        }),
      });
    },
  });

  await page.goto('/#/', { waitUntil: 'domcontentloaded' });

  const dashboardReview = page.locator('section[aria-labelledby="money-review-dashboard-title"]');
  await expect(dashboardReview.getByText('One account needs a fresh sync')).toBeVisible({ timeout: 30_000 });
  await expect(dashboardReview.getByTestId('money-review-carousel')).toBeVisible();

  if (process.env.CAPTURE_MONEY_REVIEW === 'true') {
    await dashboardReview.screenshot({ path: testInfo.outputPath('money-review-dashboard.png') });
  }

  await dashboardReview.getByRole('button', { name: 'Review One account needs a fresh sync' }).click();

  let reviewDialog = page.getByRole('dialog');
  await expect(reviewDialog.getByRole('heading', { name: 'One account needs a fresh sync' })).toBeVisible({ timeout: 30_000 });
  await expect(reviewDialog.getByText('Why this appeared')).toBeVisible();
  await expect(reviewDialog.getByText('Accounts affected')).toBeVisible();
  await expect(reviewDialog.getByText(/No external AI or API key is required/)).toBeVisible();
  await expect(reviewDialog.getByText('Dining budget is over plan')).not.toBeVisible();

  await page.setViewportSize({ width: 1024, height: 768 });
  const compactViewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const compactDocumentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(compactDocumentWidth).toBeLessThanOrEqual(compactViewportWidth);
  await expect(reviewDialog.getByRole('button', { name: 'Sync account' })).toBeVisible();

  if (process.env.CAPTURE_MONEY_REVIEW === 'true') {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.screenshot({ path: testInfo.outputPath('money-review-item.png'), fullPage: true });
  }

  await reviewDialog.getByRole('button', { name: 'Close item' }).click();
  await expect(reviewDialog).not.toBeVisible();

  await dashboardReview.getByRole('button', { name: 'Review Dining budget is over plan' }).click();
  reviewDialog = page.getByRole('dialog');
  await expect(reviewDialog.getByRole('heading', { name: 'Dining budget is over plan' })).toBeVisible();
  await expect(reviewDialog.getByText('Dining budget is over plan')).toBeVisible();
  await expect(reviewDialog.getByText('One account needs a fresh sync')).not.toBeVisible();
  await expect(reviewDialog.getByText('What the numbers show')).toBeVisible();
  await expect(reviewDialog.getByText('Spent')).toBeVisible();
  await expect(reviewDialog.getByText('Budget', { exact: true })).toBeVisible();

  await reviewDialog.getByRole('button', { name: 'Snooze' }).click();
  await page.getByRole('menuitem', { name: /One month/ }).click();

  await expect.poll(() => lifecyclePayload).toEqual({ status: 'snoozed', snoozePreset: '1_month' });
  await expect(reviewDialog.getByRole('button', { name: 'Bring back now' })).toBeVisible();

  await reviewDialog.getByRole('button', { name: 'Close item' }).click();
  await dashboardReview.getByRole('button', { name: 'Review all' }).click();
  reviewDialog = page.getByRole('dialog');
  await expect(reviewDialog.getByRole('heading', { name: 'Money Review' })).toBeVisible();
  await expect(reviewDialog.getByRole('tab', { name: 'Snoozed (1)' })).toBeVisible();

  if (process.env.CAPTURE_MONEY_REVIEW === 'true') {
    await page.screenshot({ path: testInfo.outputPath('money-review-all.png'), fullPage: true });
  }
});
