import { test, expect } from '@playwright/test';
import { goHome, setupRendererTest, type Handler } from './helpers/renderer-app';

const jsonResponse = (data: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data),
});

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

test('snapshot alert opens progress modal', async ({ page }) => {
  await goHome(page);

  const alertsButton = page.getByRole('button', { name: 'Smart Alerts' });
  await alertsButton.click();

  await expect(page.getByText('Progress Snapshot')).toBeVisible();
  await page.getByRole('button', { name: 'View Snapshot' }).click();

  await expect(page.getByRole('heading', { name: 'Progress Snapshot', exact: true })).toBeVisible();
  await expect(page.getByText('Since ShekelSync Started')).toBeVisible();
});

test('monthly donation reminder can be dismissed without blocking smart alerts', async ({ page }) => {
  const uiWarnings: string[] = [];
  const warningPatterns = [
    "The Select component doesn't accept a Fragment as a child.",
    "The Menu component doesn't accept a Fragment as a child.",
    'cannot contain a nested',
    'cannot be a child of',
  ];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (warningPatterns.some((pattern) => text.includes(pattern))) {
      uiWarnings.push(text);
    }
  });

  const reminderStatus = {
    success: true,
    data: {
      hasDonated: false,
      tier: 'none',
      supportStatus: 'none',
      totalAmountUsd: 0,
      currentMonthKey: '2025-09',
      reminderShownThisMonth: false,
      shouldShowMonthlyReminder: true,
      hasPendingVerification: false,
      canAccessAiAgent: false,
      aiAgentAccessLevel: 'none',
      plans: [],
      donationUrl: 'https://buymeacoffee.com/shekelsync',
    },
  };

  const dismissedStatus = {
    ...reminderStatus,
    data: {
      ...reminderStatus.data,
      reminderShownThisMonth: true,
      shouldShowMonthlyReminder: false,
    },
  };
  let currentStatus = reminderStatus;

  const overrides: Record<string, Handler> = {
    'GET /api/donations/status': async ({ route }) => {
      await route.fulfill(jsonResponse(currentStatus));
    },
    'POST /api/donations/reminder-shown': async ({ route, request }) => {
      const payload = JSON.parse(request.postData() ?? '{}');
      expect(typeof payload.monthKey).toBe('string');
      currentStatus = {
        ...dismissedStatus,
        data: {
          ...dismissedStatus.data,
          currentMonthKey: payload.monthKey,
        },
      };
      await route.fulfill(jsonResponse(currentStatus));
    },
  };

  await setupRendererTest(page, overrides);
  await goHome(page);

  const reminderDialog = page.getByRole('dialog', { name: 'Support ShekelSync' });
  await expect(reminderDialog).toBeVisible();
  await reminderDialog.getByRole('button', { name: 'Maybe later' }).click();

  await expect(reminderDialog).toBeHidden();

  const alertsButton = page.getByRole('button', { name: 'Smart Alerts' });
  await alertsButton.click();
  await expect(page.getByRole('heading', { name: 'Smart Alerts' })).toBeVisible();
  expect(uiWarnings).toEqual([]);
});
