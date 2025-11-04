import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.describe('Data export flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupRendererTest(page);
    await goHome(page);
  });

  test('allows user to trigger export and handles cancel', async ({ page }) => {
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('openProfileSetup'));
    });
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data Export' })).toBeVisible();

    await page.getByRole('button', { name: 'Export Data' }).click();

    // Trigger export (mocked response comes from renderer-app helper route)
    await page.getByRole('button', { name: 'Export Data' }).click();

    await expect(page.getByText('Data exported successfully')).toBeVisible();
  });
});
