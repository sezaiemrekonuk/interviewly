import { defineConfig, devices } from '@playwright/test';

// Browser smoke ring only (A03). This is not the acceptance ring — business rules live in
// Cucumber scenarios against the API. These specs confirm the round-trip is wired: a form
// in a real browser reaches the API through the edge and the session cookie comes back.
//
// No `webServer` block: the target is the composed stack (`docker compose up`), edge
// included, not a bare `next dev`. Point BASE_URL elsewhere to run against a deployment.
export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
