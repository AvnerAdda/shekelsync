import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('Analysis Budget tab allows activating a suggested budget', async ({ page }) => {
  await goHome(page);

  await page.getByRole('button', { name: 'Analysis' }).click();
  await page.getByRole('tab', { name: 'Budget' }).click();

  const activateButtons = page.getByRole('button', { name: 'Activate Budget' });
  await expect(activateButtons).toHaveCount(2);
  await activateButtons.first().click();

  // After activation, the list should re-render (buttons may disappear when active)
  await expect(activateButtons).toHaveCount(0);
});
