import { expect, test } from '@playwright/test';
import { goHome, setupRendererTest, type Handler } from './helpers/renderer-app';

const jsonResponse = (data: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data),
});

const baseProfile = {
  profile: {
    id: 42,
    username: 'Alex Rivers',
    marital_status: 'Married',
    age: 38,
    birth_date: '1987-05-10',
    occupation: 'Product Manager',
    monthly_income: 22000,
    family_status: 'Married',
    location: 'Haifa',
    industry: 'Tech',
    children_count: 1,
    household_size: 3,
    home_ownership: 'own',
    education_level: 'master',
    employment_status: 'employed',
  },
  spouse: {
    name: 'Jordan',
    birth_date: '1988-08-20',
    occupation: 'Designer',
    industry: 'Creative',
    monthly_income: 15000,
    employment_status: 'employed',
    education_level: 'bachelor',
  },
  children: [
    {
      id: 7,
      name: 'Noa',
      birth_date: '2016-03-15',
      gender: 'female',
      education_stage: 'elementary',
      special_needs: false,
    },
  ],
};

test('child add/edit/delete flows update payload', async ({ page }) => {
  const payloads: any[] = [];

  const overrides: Record<string, Handler> = {
    'GET /api/profile': async ({ route }) => {
      await route.fulfill(jsonResponse(baseProfile));
    },
    'PUT /api/profile': async ({ route, request }) => {
      const payload = JSON.parse(request.postData() ?? '{}');
      payloads.push(payload);
      await route.fulfill(jsonResponse(payload));
    },
  };

  await setupRendererTest(page, overrides);
  await goHome(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: /profile information/i })).toBeVisible();

  await page.getByRole('button', { name: 'Children Information' }).click();

  await page.getByRole('button', { name: 'Edit child' }).click();
  const editDialog = page.getByRole('dialog', { name: /Edit Child Information/i });
  const childName = editDialog.getByLabel('Child Name');
  await childName.fill('Noa Updated');
  await editDialog.getByRole('button', { name: 'Update Child' }).click();

  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText(/updated successfully/i)).toBeVisible();
  expect(payloads.at(-1)?.children?.[0]?.name).toBe('Noa Updated');

  await page.getByRole('button', { name: 'Add child' }).click();
  const addDialog = page.getByRole('dialog', { name: /Add Child Information/i });
  await addDialog.getByLabel('Child Name').fill('Omer');
  await addDialog.getByLabel(/Birth Date/i).fill('2020-11-05');
  await addDialog.getByRole('button', { name: 'Add Child' }).click();
  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText(/updated successfully/i)).toBeVisible();

  const latest = payloads.at(-1);
  expect(latest?.children?.length).toBeGreaterThan(1);
  expect(latest?.children?.some((child: any) => child.name === 'Omer')).toBe(true);

  await page.getByRole('button', { name: 'Delete child' }).first().click();
  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText(/updated successfully/i)).toBeVisible();

  const finalPayload = payloads.at(-1);
  expect(finalPayload.children.some((child: any) => child.name === 'Noa Updated')).toBe(false);
});
