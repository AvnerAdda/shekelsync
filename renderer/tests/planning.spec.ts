import { expect, test, type Page } from '@playwright/test';
import { setupRendererTest, type Handler } from './helpers/renderer-app';
import labels from '../src/features/planning/locales/en.json' with { type: 'json' };
import spendLabels from '../src/features/planning/locales/spendability-en.json' with { type: 'json' };
import en from '../src/i18n/locales/en.json' with { type: 'json' };
import type { CashScenario, PlanningData, PlanningProjection, SavingsGoal } from '../src/features/planning/types';

function dateAfter(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function planningFixture(page: Page, fallback = false) {
  const state: PlanningData = {
    goals: [], scenarios: [], settings: {
      cash_buffer: fallback ? 0 : 500, next_income_date: null,
      card_commitments_amount: null, card_commitments_confirmed_at: null,
    },
  };
  const projection = (): PlanningProjection => {
    const reserved = state.goals.filter((goal) => goal.reserve_location === 'included_cash').reduce((sum, goal) => sum + goal.saved_amount, 0);
    const available = 6500 - reserved - state.settings.cash_buffer;
    return {
      status: 'ready', currency: 'ILS', generated_at: new Date().toISOString(), as_of_date: dateAfter(0), horizon_days: 180,
      next_income_date: state.settings.next_income_date || (fallback ? null : dateAfter(15)), available_spend: available, shortfall: 0,
      next_income_source: state.settings.next_income_date ? 'manual' : fallback ? null : 'detected', spending_period_end: dateAfter(fallback ? 30 : 15),
      spending_source: fallback ? 'recent_spending' : 'forecast', spending_history_days: fallback ? 90 : null,
      card_commitments_source: 'imported',
      cash_balance: 7000, cash_buffer: state.settings.cash_buffer, reserved_cash: reserved, planned_contributions: 0,
      card_commitments: 200, card_confirmation_required: false, latest_balance_date: dateAfter(0),
      forecast_expenses_until_income: 300, lowest_balance: available, ending_balance: available + 5000,
      daily: [], monthly: [{ month: dateAfter(30).slice(0, 7), income: 6000, expenses: 1000, contributions: 0, scenario_change: 0, ending_balance: available + 5000 }],
      reasons: [], assumptions: [],
    };
  };
  const json = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  const handlers: Record<string, Handler> = {
    'GET /api/planning': async ({ route }) => { await route.fulfill(json(state)); },
    'GET /api/planning/projection': async ({ route }) => { await route.fulfill(json(projection())); },
    'PUT /api/planning/settings': async ({ route, request }) => {
      state.settings = { ...state.settings, ...request.postDataJSON() };
      await route.fulfill(json(state.settings));
    },
    'POST /api/planning/goals': async ({ route, request }) => {
      const input = request.postDataJSON();
      const goal: SavingsGoal = { ...input, id: 1, remaining_amount: input.target_amount - input.saved_amount,
        required_monthly_contribution: 400, on_track: true, months_until_target: 12,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.goals.push(goal);
      await route.fulfill(json(goal));
    },
    'PUT /api/planning/goals/1': async ({ route, request }) => {
      state.goals[0] = { ...state.goals[0], ...request.postDataJSON() };
      await route.fulfill(json(state.goals[0]));
    },
    'DELETE /api/planning/goals/1': async ({ route }) => {
      state.goals = [];
      await route.fulfill(json({ success: true }));
    },
    'POST /api/planning/scenarios/preview': async ({ route, request }) => {
      const delta = request.postDataJSON().changes.reduce((sum: number, change: { amount: number }) => sum + change.amount, 0);
      const baseline = projection();
      const scenario: PlanningProjection = { ...baseline,
        available_spend: baseline.available_spend! + Math.min(0, delta), lowest_balance: baseline.lowest_balance! + delta,
        ending_balance: baseline.ending_balance! + delta,
        monthly: baseline.monthly.map((row) => ({ ...row, scenario_change: delta, ending_balance: row.ending_balance! + delta })),
      };
      await route.fulfill(json({ baseline, scenario, comparison: { end_balance_delta: delta, lowest_balance_delta: delta, available_spend_delta: Math.min(0, delta) } }));
    },
    'POST /api/planning/scenarios': async ({ route, request }) => {
      const scenario: CashScenario = { ...request.postDataJSON(), id: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.scenarios.push(scenario);
      await route.fulfill(json(scenario));
    },
  };
  await setupRendererTest(page, handlers);
  return state;
}

test('shares planning reads across panels on mount and refresh', async ({ page }) => {
  const state = await planningFixture(page);
  const reads = { planning: 0, projection: 0 };
  page.on('request', (request) => {
    if (request.method() !== 'GET') return;
    const path = new URL(request.url()).pathname;
    if (path === '/api/planning') reads.planning += 1;
    if (path === '/api/planning/projection') reads.projection += 1;
  });
  await page.goto('/#/plan?tab=planning');
  const amount = page.getByTestId('spendability-card');
  await expect(amount.getByText('₪6,000', { exact: true })).toBeVisible();
  await expect(page.getByText(labels.goals.emptyTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(labels.scenarios.emptyTitle, { exact: true })).toBeVisible();
  expect(reads).toEqual({ planning: 1, projection: 1 });
  state.settings.cash_buffer = 700;
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(amount.getByText('₪5,800', { exact: true })).toBeVisible();
  expect(reads).toEqual({ planning: 2, projection: 2 });
  state.settings.cash_buffer = 900;
  await page.evaluate(() => { window.dispatchEvent(new Event('dataRefresh')); });
  await expect(amount.getByText('₪5,600', { exact: true })).toBeVisible();
  expect(reads).toEqual({ planning: 3, projection: 3 });
});

test('shows an automatic recent-spending estimate without entering planning settings', async ({ page }) => {
  const state = await planningFixture(page, true);
  await page.goto('/#/plan?tab=planning');
  const spend = page.getByTestId('spendability-card');
  await expect(spend.getByText('₪6,500', { exact: true })).toBeVisible();
  await expect(spend.getByText(spendLabels.recentSpendingHelp.replace('{{days}}', '90'))).toBeVisible();
  await expect(spend.getByText(spendLabels.incomplete, { exact: true })).toHaveCount(0);
  expect(state.settings.next_income_date).toBeNull();
  expect(state.settings.card_commitments_amount).toBeNull();
  expect(state.settings.cash_buffer).toBe(0);
  expect(state.goals).toEqual([]);
  await page.reload();
  await expect(spend.getByText('₪6,500', { exact: true })).toBeVisible();
  await spend.screenshot({ path: '/tmp/shekelsync-automatic-spending.png', animations: 'disabled' });
});

test('spending uses detected inputs without setup and keeps them automatic after saving a buffer', async ({ page }) => {
  const state = await planningFixture(page);
  await page.goto('/#/plan');
  const tabs = page.getByRole('tablist', { name: 'analysis tabs' }).getByRole('tab');
  await expect(tabs.nth(0)).toHaveText(en.analysisPage.tabs.dashboard);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toHaveText(spendLabels.tabLabel);
  await tabs.nth(1).click();
  await expect(page).toHaveURL(/tab=planning/);
  const spend = page.getByTestId('spendability-card');
  await expect(spend.getByText('₪6,000', { exact: true })).toBeVisible();
  await expect(spend.getByText(spendLabels.detectedIncome, { exact: false })).toBeVisible();
  await spend.getByRole('button', { name: spendLabels.settings, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(spendLabels.nextIncome, { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('switch', { name: spendLabels.overrideCards })).not.toBeChecked();
  await dialog.getByLabel(spendLabels.buffer, { exact: true }).fill('700');
  await dialog.getByRole('button', { name: spendLabels.save, exact: true }).click();
  await expect(spend.getByText('₪5,800', { exact: true })).toBeVisible();
  expect(state.settings.next_income_date).toBeNull();
  expect(state.settings.card_commitments_amount).toBeNull();
  await page.reload();
  await expect(spend.getByText('₪5,800', { exact: true })).toBeVisible();
  await expect(spend.getByText(spendLabels.detectedCards, { exact: false })).toBeVisible();
});

test('goals persist across navigation and update the available-to-spend card', async ({ page }) => {
  const state = await planningFixture(page);
  await page.goto('/#/plan?tab=planning');
  await expect(page.getByRole('tab', { name: spendLabels.tabLabel })).toHaveAttribute('aria-selected', 'true', { timeout: 30000 });
  const spend = page.getByTestId('spendability-card');
  await expect(spend.getByText('₪6,000', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: labels.goals.add, exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(labels.goals.name).fill('Summer holiday');
  await dialog.getByLabel(labels.goals.fields.target_amount).fill('10000');
  await dialog.getByLabel(labels.goals.fields.saved_amount).fill('1000');
  await dialog.getByLabel(labels.goals.fields.monthly_contribution).fill('500');
  await dialog.getByLabel(labels.goals.deadline, { exact: true }).fill(dateAfter(365));
  await dialog.getByRole('button', { name: labels.shared.save, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Summer holiday', exact: true })).toBeVisible();
  await expect(spend.getByText('₪5,000', { exact: true })).toBeVisible();
  expect(state.goals[0].reserve_location).toBe('included_cash');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Summer holiday', exact: true })).toBeVisible();
  await page.getByRole('button', { name: labels.goals.editNamed.replace('{{name}}', 'Summer holiday'), exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(labels.goals.fields.saved_amount).fill('2000');
  await dialog.getByRole('button', { name: labels.shared.save, exact: true }).click();
  await expect(spend.getByText('₪4,000', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: labels.goals.deleteNamed.replace('{{name}}', 'Summer holiday'), exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: labels.shared.delete, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Summer holiday', exact: true })).toHaveCount(0);
  await expect(spend.getByText('₪6,000', { exact: true })).toBeVisible();
});

test('a saved scenario compares an additional purchase without changing the current plan', async ({ page }) => {
  const state = await planningFixture(page);
  const canonicalWrites: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/api\/(financial-truth|transactions|forecast)/.test(request.url())) canonicalWrites.push(request.url());
  });
  await page.goto('/#/plan?tab=planning');
  await page.getByRole('button', { name: labels.scenarios.add, exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(labels.scenarios.name).fill('New laptop');
  await dialog.getByLabel(labels.scenarios.description).fill('Laptop purchase');
  await dialog.getByLabel(labels.scenarios.amount).fill('-600');
  await dialog.getByLabel(labels.scenarios.date).fill(dateAfter(3));
  await dialog.getByRole('button', { name: labels.scenarios.compare, exact: true }).click();
  await expect(dialog.getByRole('table', { name: labels.scenarios.comparisonTable })).toBeVisible();
  await expect(dialog.getByText('-₪600', { exact: true }).first()).toBeVisible();
  await dialog.getByLabel(labels.scenarios.amount).fill('-700');
  await expect(dialog.getByRole('table', { name: labels.scenarios.comparisonTable })).toHaveCount(0);
  await dialog.getByRole('button', { name: labels.scenarios.compare, exact: true }).click();
  await expect(dialog.getByText('-₪700', { exact: true }).first()).toBeVisible();
  await dialog.getByRole('button', { name: labels.scenarios.save, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New laptop', exact: true })).toBeVisible();
  expect(state.scenarios[0].changes[0].amount).toBe(-700);
  await expect(page.getByTestId('spendability-card').getByText('₪6,000', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: labels.scenarios.compareNamed.replace('{{name}}', 'New laptop'), exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('table', { name: labels.scenarios.comparisonTable })).toBeVisible();
  expect(canonicalWrites).toEqual([]);
  await dialog.getByRole('table', { name: labels.scenarios.comparisonTable }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/shekelsync-planning-scenario.png', fullPage: true, animations: 'disabled' });
});
