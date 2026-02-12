import { test, expect } from '@playwright/test';
import { goHome, openAnalysisPage, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test.setTimeout(120_000);

test('Analysis Actions tab shows quests panel', async ({ page }) => {
  await goHome(page);
  await openAnalysisPage(page);

  // Actions tab
  await page.getByRole('tab', { name: 'Actions' }).click();
  await expect(page.getByText('Financial Quests')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find Quests' })).toBeVisible();
  await expect(page.getByText('No quests available')).toBeVisible();
  await page.getByRole('tab', { name: /In Progress/i }).click();
  await expect(page.getByText('No active quests')).toBeVisible();
});
