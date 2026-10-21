import { expect, test } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test('category and rule deletion require confirmation and cancellation makes no request', async ({ page }) => {
  let categories = [
    { id: 1, name: 'Expenses', name_en: 'Expenses', parent_id: null, category_type: 'expense', is_active: true },
    { id: 2, name: 'Weekend dining', name_en: 'Weekend dining', parent_id: 1, category_type: 'expense', is_active: true },
  ];
  let rules = [{ id: 7, name_pattern: 'Coffee shop', category_definition_id: 1, category_type: 'expense', is_active: true }];
  const deletions: string[] = [];
  await setupRendererTest(page, {
    'GET /api/categories/hierarchy': async ({ route }) => route.fulfill({ json: { categories } }),
    'GET /api/categorization_rules': async ({ route }) => route.fulfill({ json: rules }),
    'DELETE /api/categories/hierarchy': async ({ route, url }) => {
      deletions.push(`category:${url.searchParams.get('id')}`);
      categories = categories.filter(item => item.id !== Number(url.searchParams.get('id')));
      await route.fulfill({ json: { success: true } });
    },
    'DELETE /api/categorization_rules': async ({ route, url }) => {
      deletions.push(`rule:${url.searchParams.get('id')}`);
      rules = [];
      await route.fulfill({ json: { success: true } });
    },
  });
  await goHome(page);
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Category Management' }) });
  await manager.getByRole('tab', { name: 'Categories', exact: true }).click();
  await manager.getByRole('listitem').getByText('Expenses', { exact: true }).click();
  const row = manager.getByRole('listitem').filter({ has: page.getByText('Weekend dining', { exact: true }) });
  await row.hover();
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  const categoryConfirmation = page.getByRole('dialog', { name: 'Delete “Weekend dining”?' });
  await expect(categoryConfirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  expect(deletions).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(categoryConfirmation).toBeHidden();
  expect(deletions).toEqual([]);
  await expect(row).toBeVisible();

  await row.hover();
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await categoryConfirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => deletions).toEqual(['category:2']);
  await expect(row).toHaveCount(0);

  await manager.getByRole('tab', { name: 'Pattern Rules' }).click();
  const deleteRule = manager.getByRole('button', { name: 'Delete rule', exact: true });
  await deleteRule.click();
  const ruleConfirmation = page.getByRole('dialog', { name: 'Delete “Coffee shop”?' });
  await ruleConfirmation.getByRole('button', { name: 'Cancel' }).click();
  expect(deletions).toEqual(['category:2']);
  await deleteRule.click();
  await ruleConfirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => deletions).toEqual(['category:2', 'rule:7']);
});

test('account confirmation preserves failed deletions and prevents duplicate requests', async ({ page }) => {
  let deletes = 0;
  let releaseDelete: (() => void) | undefined;
  await setupRendererTest(page, {
    'DELETE /api/credentials/1': async ({ route }) => {
      deletes += 1;
      if (deletes === 1) {
        await route.fulfill({ status: 500, json: { error: 'Unable to delete' } });
      } else {
        await new Promise<void>(resolve => { releaseDelete = resolve; });
        await route.fulfill({ json: { success: true } });
      }
    },
  });
  await goHome(page);
  await page.getByRole('button', { name: 'Add Account', exact: true }).click();
  const accounts = page.getByRole('dialog').filter({ has: page.getByText('Accounts Management', { exact: true }) });
  await accounts.getByRole('button', { name: 'Delete Account', exact: true }).click();
  const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Confirm Account Deletion' }) });
  await expect(confirmation.getByText('Account: Test Card')).toBeVisible();
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmation).toBeHidden();
  expect(deletes).toBe(0);

  await accounts.getByRole('button', { name: 'Delete Account', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Delete Account' }).click();
  await expect(confirmation.getByRole('alert')).toHaveText('Failed to delete account');
  await expect(confirmation).toBeVisible();
  expect(deletes).toBe(1);
  await confirmation.getByRole('button', { name: 'Delete Account' }).click();
  await expect.poll(() => deletes).toBe(2);
  await expect(confirmation.getByRole('button', { name: 'Delete Account' })).toBeDisabled();
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeVisible();
  releaseDelete?.();
  await expect(confirmation).toBeHidden();
  expect(deletes).toBe(2);
});
