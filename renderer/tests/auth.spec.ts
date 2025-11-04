import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('shows authenticated user indicator', async ({ page }) => {
  await goHome(page);

  await expect(page.getByText('Signed in as Demo User')).toBeVisible();
});
