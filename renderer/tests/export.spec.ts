import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test.describe('Data export flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupRendererTest(page);
  });

  const openDataExport = async (page: Parameters<typeof goHome>[0]) => {
    await goHome(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 30000 });
    const exportPanel = page.getByTestId('data-export-panel');
    await expect(exportPanel).toBeVisible({ timeout: 30000 });
    await exportPanel.scrollIntoViewIfNeeded();
  };

  test('allows user to trigger export via browser fallback when electron bridge is unavailable', async ({ page }) => {
    await openDataExport(page);

    await page.getByTestId('data-export-submit').click();

    await expect(page.getByTestId('data-export-success')).toBeVisible();
  });

  test('saves exports via the Electron file bridge when available', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__fileWrites = [];
      (window as any).electronAPI = {
        file: {
          showSaveDialog: async () => ({ canceled: false, filePath: '/tmp/mock-export.csv' }),
          writeFile: async (filePath: string, contents: string) => {
            (window as any).__fileWrites.push({
              filePath,
              contentsLength: contents.length,
            });
            return { success: true };
          },
        },
      };
    });

    await openDataExport(page);
    await page.getByTestId('data-export-submit').click();

    await expect(page.getByTestId('data-export-success')).toBeVisible();

    const writes = await page.evaluate(() => (window as any).__fileWrites as Array<{ filePath: string; contentsLength: number }>);
    expect(writes).toHaveLength(1);
    expect(writes[0].filePath).toContain('mock-export.csv');
    expect(writes[0].contentsLength).toBeGreaterThan(0);
  });
});
