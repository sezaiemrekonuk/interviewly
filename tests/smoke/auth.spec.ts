import { expect, test, type APIRequestContext } from '@playwright/test';

// Assertions here are on URLs, status codes and form controls only — never on page copy.
// The stack serves English or Turkish depending on `Accept-Language`, so any assertion on
// a rendered sentence fails for the wrong reason under the other locale (frontend spec
// §4.5). The localised strings are the component ring's business.

const PASSWORD = 'correct-horse-battery';

/** Unique per run so the two smokes never collide with each other or a previous run. */
function uniqueEmail(label: string): string {
  return `smoke-${label}-${process.pid}-${Date.now()}@example.test`;
}

async function registerViaApi(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post('/api/auth/register', {
    data: { email, password: PASSWORD },
  });
  expect(response.status()).toBe(201);
}

test.describe('auth smoke', () => {
  // The sign-in smoke gets its account from the API, not from the register UI. Driving one
  // browser flow to set up another makes the second test fail whenever the first one does,
  // and the ordering is invisible in the failure output.
  const existing = uniqueEmail('existing');

  test.beforeAll(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    await registerViaApi(request, existing);
    await request.dispose();
  });

  test('register lands on the dashboard', async ({ page }) => {
    await page.goto('/register');

    await page.locator('#email').fill(uniqueEmail('new'));
    await page.locator('#password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('sign-in lands on the dashboard', async ({ page }) => {
    await page.goto('/sign-in');

    await page.locator('#email').fill(existing);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
