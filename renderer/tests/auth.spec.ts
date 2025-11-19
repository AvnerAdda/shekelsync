import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  await setupRendererTest(page);
});

test('shows authenticated user indicator', async ({ page }) => {
  await goHome(page);

  await expect(page.getByText('Signed in as Demo User')).toBeVisible();
});

test('updates auth indicator when the session lifecycle changes', async ({ page }) => {
  await goHome(page);

  await expect(page.getByText('Signed in as Demo User')).toBeVisible();

  await page.evaluate(() => {
    window.localStorage.removeItem('clarify.auth.session');
    window.dispatchEvent(new CustomEvent('authSessionChanged', { detail: null }));
  });

  await expect(page.getByText('Offline mode')).toBeVisible();

  await page.evaluate(() => {
    const session = {
      accessToken: 'restored-token',
      tokenType: 'Bearer',
      user: { name: 'QA Bot' },
    };
    window.localStorage.setItem('clarify.auth.session', JSON.stringify(session));
    window.dispatchEvent(new CustomEvent('authSessionChanged', { detail: session }));
  });

  await expect(page.getByText('Signed in as QA Bot')).toBeVisible();
});
