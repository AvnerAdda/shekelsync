import { expect, test } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

test('edits a category from Activity, refreshes the row, and preserves notes in transaction details', async ({ page }) => {
  let transaction = {
    identifier: 'activity-1', vendor: 'demo-market', name: 'Neighborhood market', price: -245,
    category_definition_id: 3, category_name: 'Groceries', parent_name: 'Expenses', category_type: 'expense',
    memo: 'Existing note', tags: [], date: '2025-09-19T16:30:00.000Z', processed_date: null, status: 'completed',
  };
  const writes: Record<string, unknown>[] = [];
  let rules = 0;
  const categories = [
    { id: 1, name: 'Expenses', parent_id: null, category_type: 'expense' },
    { id: 2, name: 'Rent', parent_id: 1, category_type: 'expense' },
    { id: 3, name: 'Groceries', parent_id: 1, category_type: 'expense' },
  ];
  await setupRendererTest(page, {
    'GET /api/transactions/search': async ({ route }) => route.fulfill({ json: { transactions: [transaction], count: 1 } }),
    'GET /api/categories/hierarchy': async ({ route }) => route.fulfill({ json: { categories } }),
    'GET /api/transactions/tags': async ({ route }) => route.fulfill({ json: [] }),
    'GET /api/transactions/activity-1%7Cdemo-market': async ({ route }) => route.fulfill({ json: transaction }),
    'PUT /api/transactions/activity-1%7Cdemo-market': async ({ route, request }) => {
      const body = request.postDataJSON();
      writes.push(body);
      transaction = { ...transaction, ...body, category_name: categories.find(item => item.id === body.category_definition_id)?.name || transaction.category_name };
      await route.fulfill({ json: { success: true } });
    },
    'POST /api/categorization_rules/auto-create': async ({ route }) => {
      rules += 1;
      await route.fulfill({ json: { success: true } });
    },
  });

  await goHome(page);
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Neighborhood market' });
  await row.getByRole('button', { name: 'Edit category' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit category', exact: true });
  await expect(editor.getByRole('checkbox')).not.toBeChecked();
  await editor.getByRole('combobox', { name: 'Category', exact: true }).fill('Rent');
  await page.getByRole('option', { name: 'Expenses › Rent' }).click();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(row.getByText('Rent', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ category_definition_id: 2, category_type: 'expense', auto_categorized: false });
  expect(rules).toBe(0);

  await row.getByText('Neighborhood market').click();
  const detail = page.getByRole('dialog');
  await detail.getByPlaceholder('Add notes about this transaction...').fill('Unsaved note');
  await detail.getByRole('button', { name: 'Edit category' }).click();
  await editor.getByRole('combobox', { name: 'Category', exact: true }).fill('Groceries');
  await page.getByRole('option', { name: 'Expenses › Groceries' }).click();
  await editor.getByRole('checkbox').check();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('dialog').getByText('Expenses › Groceries')).toBeVisible();
  await expect(page.getByPlaceholder('Add notes about this transaction...')).toHaveValue('Unsaved note');
  expect(rules).toBe(1);
});

test('deletes a transaction with confirmation from the shared actions and refreshes Activity', async ({ page }) => {
  const transaction = {
    identifier: 'delete-1', vendor: 'demo-market', name: 'Duplicate market charge', price: -245,
    category_definition_id: 3, category_name: 'Groceries', parent_name: 'Expenses', category_type: 'expense',
    memo: '', tags: [], date: '2025-09-19T16:30:00.000Z', processed_date: null, status: 'completed',
  };
  let deleted = false;
  let attempts = 0;
  await setupRendererTest(page, {
    'GET /api/transactions/search': async ({ route }) => route.fulfill({ json: { transactions: deleted ? [] : [transaction], count: deleted ? 0 : 1 } }),
    'GET /api/transactions/tags': async ({ route }) => route.fulfill({ json: [] }),
    'GET /api/transactions/delete-1%7Cdemo-market': async ({ route }) => route.fulfill({ json: transaction }),
    'DELETE /api/transactions/delete-1%7Cdemo-market': async ({ route }) => {
      attempts += 1;
      if (attempts === 1) return route.fulfill({ status: 500, json: { error: 'Temporary failure' } });
      deleted = true;
      return route.fulfill({ json: { success: true } });
    },
  });
  await goHome(page);
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const row = page.getByRole('listitem').filter({ hasText: transaction.name });
  await row.getByRole('button', { name: 'Delete transaction' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete transaction', exact: true });
  await expect(confirmation.getByText(transaction.name)).toBeVisible();
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmation).toBeHidden();
  await expect(row).toBeVisible();
  expect(attempts).toBe(0);

  await row.getByText(transaction.name).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete transaction' }).click();
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toContainText('Could not delete');
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row).toHaveCount(0);
  expect(attempts).toBe(2);
});
