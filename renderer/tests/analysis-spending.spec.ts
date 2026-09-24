import { test, expect } from '@playwright/test';
import { goHome, openAnalysisPage } from './helpers/renderer-app';

import { setupSpendingTimeline } from './helpers/spending-timeline';

test.beforeEach(async ({ page }) => {
  await setupSpendingTimeline(page);
});

test.setTimeout(120_000);

test('Analysis Spending tab shows chart and targets', async ({ page }) => {
  await goHome(page);
  await openAnalysisPage(page);

  // Spending tab
  await page.getByRole('tab', { name: 'Spending' }).click();
  await expect(page.getByRole('heading', { name: 'Spending categories over time' })).toBeVisible();
  await expect(page.getByTestId('spending-timeline')).toBeVisible();
  await expect(page.getByTestId('target-line-essential')).toHaveAttribute('data-percentage', '50');

  // Targets section
  await expect(page.getByText('Essential', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Reward', { exact: true }).first()).toBeVisible();
});
