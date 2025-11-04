import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('smart notifications popover surfaces critical alerts', async ({ page }) => {
  await goHome(page);

  const alertsButton = page.getByRole('button', { name: 'Smart Alerts' });
  await expect(alertsButton).toBeVisible();
  await alertsButton.click();

  await expect(page.getByRole('heading', { name: 'Smart Alerts' })).toBeVisible();
  await expect(page.getByText('Budget exceeded')).toBeVisible();
  await expect(page.getByText('Unusual transaction')).toBeVisible();

});
