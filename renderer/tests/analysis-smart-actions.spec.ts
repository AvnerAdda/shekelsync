import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('Analysis Actions tab shows quests panel', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Analysis' }).click();

  // Actions tab
  await page.getByRole('tab', { name: 'Actions' }).click();
  await expect(page.getByText('Financial Quests')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find Quests' })).toBeVisible();
  await expect(page.getByText('No quests available')).toBeVisible();
  await page.getByRole('tab', { name: /In Progress/i }).click();
  await expect(page.getByText('No active quests')).toBeVisible();
});
