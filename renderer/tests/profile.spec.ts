import { expect, test } from '@playwright/test';
import { goHome, setupRendererTest, type Handler } from './helpers/renderer-app';

const jsonResponse = (data: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data),
});

const profilePayload = {
  profile: {
    id: 1,
    username: 'Jane Doe',
    marital_status: 'Single',
    age: 32,
    birth_date: '1993-06-15',
    occupation: 'Engineer',
    monthly_income: 15000,
    family_status: 'Single',
    location: 'Tel Aviv',
    industry: 'Tech',
    children_count: 0,
    household_size: 1,
    home_ownership: 'rent',
    education_level: 'bachelor',
    employment_status: 'employed',
  },
  spouse: null,
  children: [],
};

test('profile section loads data and saves changes', async ({ page }) => {
  const bodies: any[] = [];

  const overrides: Record<string, Handler> = {
    'GET /api/profile': async ({ route }) => {
      await route.fulfill(jsonResponse(profilePayload));
    },
    'PUT /api/profile': async ({ route, request }) => {
      const payload = JSON.parse(request.postData() ?? '{}');
      bodies.push(payload);
      await route.fulfill(jsonResponse({ ...payload }));
    },
  };

  await setupRendererTest(page, overrides);
  await goHome(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: /profile information/i })).toBeVisible();

  const nameInput = page.getByLabel('Username');
  await expect(nameInput).toHaveValue('Jane Doe');

  await nameInput.fill('Janet Doe');
  await page.getByRole('button', { name: 'Save Profile' }).click();

  await expect(page.getByText(/updated successfully/i)).toBeVisible();
  expect(bodies[0]?.profile?.username).toBe('Janet Doe');
});

test('shows session expiry message when profile fetch returns 401', async ({ page }) => {
  await setupRendererTest(page, {
    'GET /api/profile': async ({ route }) => {
      await route.fulfill(jsonResponse({ error: 'expired' }, 401));
    },
  });

  await goHome(page);
  await page.getByRole('button', { name: 'Settings' }).click();

  await expect(page.getByText(/session expired/i)).toBeVisible();
});

test('allows adding and editing a child profile', async ({ page }) => {
  const savedPayloads: any[] = [];

  const overrides: Record<string, Handler> = {
    'GET /api/profile': async ({ route }) => {
      await route.fulfill(jsonResponse(profilePayload));
    },
    'PUT /api/profile': async ({ route, request }) => {
      const payload = JSON.parse(request.postData() ?? '{}');
      savedPayloads.push(payload);
      await route.fulfill(jsonResponse(payload));
    },
  };

  await setupRendererTest(page, overrides);
  await goHome(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: /profile information/i })).toBeVisible();

  await page.getByRole('button', { name: 'Children Information' }).click();
  await page.getByRole('button', { name: 'Add child' }).click();
  const addDialog = page.getByRole('dialog', { name: /Add Child Information/i });
  await addDialog.getByLabel('Child Name').fill('Luna');
  await addDialog.getByLabel(/Birth Date/i).fill('2018-04-02');
  await addDialog.getByRole('button', { name: /^Add Child$/i }).click();

  await expect(page.getByText('Luna')).toBeVisible();

  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText(/updated successfully/i)).toBeVisible();
  expect(savedPayloads.at(-1)?.children?.[0]?.name).toBe('Luna');

  await page.getByRole('button', { name: 'Edit child' }).click();
  const editDialog = page.getByRole('dialog', { name: /Edit Child Information/i });
  const childName = editDialog.getByLabel('Child Name');
  await childName.fill('Luna Updated');
  await editDialog.getByRole('button', { name: /^Update Child$/i }).click();
  await expect(page.getByText('Luna Updated')).toBeVisible();

  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText(/updated successfully/i)).toBeVisible();
  expect(savedPayloads.at(-1)?.children?.[0]?.name).toBe('Luna Updated');
});
