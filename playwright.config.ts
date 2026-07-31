import { defineConfig, devices } from '@playwright/test';

// Browser smoke ring only (A03). This is not the acceptance ring — business rules live in
// Cucumber scenarios against the API. These specs confirm the round-trip is wired: a form
// in a real browser reaches the API through the edge and the session cookie comes back.
//
// No `webServer` block: the target is the composed stack (`docker compose up`), edge
// included, not a bare `next dev`. Point BASE_URL elsewhere to run against a deployment.
export default defineConfig({
  testDir: './tests/smoke',
  // Serial, single worker, deliberately. `POST /auth/register` is rate-limited to 3 per
  // hour per IP (A01), and Playwright workers are separate processes that each run the
  // file's `beforeAll` — so two workers spend two registrations on the fixture alone and
  // the run 429s on itself. One worker spends two per run, which fits inside the window.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
