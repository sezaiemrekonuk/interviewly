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
    // `consent` has been required since issue 61; without it register answers
    // CONSENT_REQUIRED, which is what the register form's own checkbox sends.
    data: { email, password: PASSWORD, consent: true },
  });
  // A 429 here is the register limiter (3/hr/IP), not a broken app: this run spends two
  // registrations and a previous run inside the same hour already spent its own. Say so,
  // because `expected 201, received 429` on its own reads like a regression.
  expect(
    response.status(),
    'register returned ' +
      response.status() +
      ' — if 429, the 3/hr/IP register limiter is still counting an earlier run from this IP',
  ).toBe(201);
}

// Both smokes use accounts that have just been created, so K8.7 (A06) routes them to the
// first unfilled onboarding step rather than to `/dashboard`. `/dashboard` is the terminal
// case of that rule — onboarding done AND at least one interview — which no account this
// file creates can reach. The rule's own branches are the auth cucumber ring's business.
const FIRST_RUN_URL = /\/onboarding\/1$/;

test.describe('auth smoke', () => {
  // The sign-in smoke gets its account from the API, not from the register UI. Driving one
  // browser flow to set up another makes the second test fail whenever the first one does,
  // and the ordering is invisible in the failure output.
  const existing = uniqueEmail('existing');

  test.beforeAll(async ({ playwright, baseURL }) => {
    // `/auth` mounts `requirePublicOrigin` (issue 67) and an API context sends no Origin of
    // its own, unlike the browser the rest of this file drives. Set it to the origin the
    // request is actually going to, which is what a form post from that page would carry.
    const request = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: baseURL ? { origin: baseURL } : {},
    });
    await registerViaApi(request, existing);
    await request.dispose();
  });

  test('register lands on the first-run step', async ({ page }) => {
    await page.goto('/register');

    await page.locator('#email').fill(uniqueEmail('new'));
    await page.locator('#password').fill(PASSWORD);
    // Issue 61: the submit button refuses before it posts unless this is ticked.
    await page.locator('input[type="checkbox"]').check();
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(FIRST_RUN_URL);
  });

  test('sign-in lands on the first-run step', async ({ page }) => {
    await page.goto('/sign-in');

    await page.locator('#email').fill(existing);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(FIRST_RUN_URL);
  });
});
