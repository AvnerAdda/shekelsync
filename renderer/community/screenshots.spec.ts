import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { goHome, openAnalysisPage, setupRendererTest } from '../tests/helpers/renderer-app';
import { communityDemoHandlers } from './demo-data';

test('capture the merged app for Show and tell using only demo data', async ({ page }) => {
  // Fixed fixture date keeps the demo data visible regardless of the merge date.
  await page.clock.setFixedTime(new Date('2025-09-21T12:00:00+03:00'));
  // Block external services and local APIs before installing the fixture routes.
  // The fixture handler fulfills every /api/ request without contacting a server.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setupRendererTest(page, communityDemoHandlers);
  const output = path.resolve('community-screenshots');
  await fs.mkdir(output, { recursive: true });
  const capture = async (name: string) => {
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.locator('.MuiSkeleton-root')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(output, `${name}.png`),
      animations: 'disabled',
      fullPage: false,
    });
  };

  await goHome(page);
  await capture('home');
  await openAnalysisPage(page);
  await expect(page.getByText('₪11,200', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.recharts-line-curve').first()).toBeVisible();
  await capture('plan');
  await page.getByRole('button', { name: 'Wealth', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Investments Dashboard' })).toBeVisible();
  await expect(page.getByText('Portfolio Value', { exact: true })).toBeVisible();
  await expect(page.getByText('No history data available', { exact: true })).toHaveCount(0);
  await expect(page.locator('.recharts-area-area').first()).toBeVisible();
  await capture('wealth');
  expect(errors).toEqual([]);
});
