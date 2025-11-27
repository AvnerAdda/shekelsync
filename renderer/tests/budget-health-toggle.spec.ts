import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest, setBudgetHealthMock } from './helpers/renderer-app';

test.beforeEach(async ({ page }) => {
  setBudgetHealthMock({
    success: true,
    budgets: [
      {
        category_id: 1,
        category_name: 'Groceries',
        budget_limit: 2000,
        current_spent: 1800,
        percentage_used: 90,
        days_remaining: 10,
        projected_total: 2200,
        daily_limit: 20,
        status: 'warning',
        daily_avg: 60,
        overrun_risk: 'high',
      },
      {
        category_id: 2,
        category_name: 'Transport',
        budget_limit: 800,
        current_spent: 400,
        percentage_used: 50,
        days_remaining: 10,
        projected_total: 550,
        daily_limit: 40,
        status: 'on_track',
        daily_avg: 20,
        overrun_risk: 'none',
      },
    ],
    overall_status: 'warning',
    summary: {
      total_budgets: 2,
      on_track: 1,
      warning: 1,
      exceeded: 0,
      total_budget: 2800,
      total_spent: 2200,
    },
  });
  await setupRendererTest(page);
});

test('Budget Health chips reflect warning vs on-track', async ({ page }) => {
  await goHome(page);
  await page.goto('/#/analysis');
  await page.getByRole('tab', { name: 'Budget' }).click();

  const groceriesCard = page.getByRole('heading', { name: 'Groceries' }).first().locator('xpath=ancestor::div[contains(@class,\"MuiCard-root\")]');
  const transportCard = page.getByRole('heading', { name: 'Transport' }).first().locator('xpath=ancestor::div[contains(@class,\"MuiCard-root\")]');

  await expect(groceriesCard.getByText('Warning', { exact: true })).toBeVisible();
  await expect(transportCard.getByText('On Track', { exact: true })).toBeVisible();
});
