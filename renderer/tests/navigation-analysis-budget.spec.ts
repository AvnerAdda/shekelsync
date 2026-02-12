import { test, expect } from '@playwright/test';
import { goHome, openAnalysisPage, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test.setTimeout(120_000);

test('Sidebar navigation reaches Analysis and shows Budget health statuses', async ({ page }) => {
  await goHome(page);

  // Navigate to Analysis via sidebar
  await openAnalysisPage(page);
  const budgetTab = page.getByRole('tab', { name: 'Budget', exact: true });

  // Budget tab should surface health statuses
  await budgetTab.click();
  await expect(page.getByRole('heading', { name: /Budget risk outlook/i })).toBeVisible();
  await expect(page.getByText('Groceries').first()).toBeVisible();
  await expect(page.getByText('Transport').first()).toBeVisible();
  await expect(page.getByText(/At risk/i)).toBeVisible();
  await expect(page.getByText(/Over Budget/i)).toBeVisible();
});
