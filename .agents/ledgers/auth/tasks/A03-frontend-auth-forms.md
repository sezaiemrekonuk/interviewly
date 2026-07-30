# A03 — Building the frontend login and register forms
REPO: (this repo) · Depends: A02 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — pure UI form wiring over an existing API; no new trust boundary; moderate reasoning is sufficient.

## Goal
Owner's ask:

> "The `/sign-in` and `/register` screens with the email+password forms and the Google
> sign-in button. Error codes rendered as localised messages. On success run the first-run
> routing rule (K8.7). `UNAUTHENTICATED` on any protected route redirects back here preserving
> the return path."
> — auth ledger task decomposition, frontend spec route map

**Changed 2026-07-30:** success no longer redirects unconditionally to `/dashboard`. It runs the
K8.7 rule from `GET /me`: onboarding incomplete → `/onboarding/[first unfilled step]`; onboarding
done with zero interviews → `/interviews/new`; otherwise → `/dashboard`. `/sign-in` also carries a
**Forgot password?** link to `/forgot-password` (A05). Both screens sit on the
`--gradient-entry` ground with the `wave` mascot (`ui` §4.2, §4.2.1).

This task produces the two auth screens in `frontend/app/(auth)/`, the error-display
wiring (error code → `next-intl` `errors.<CODE>` key), the Google button, and a Playwright
smoke that confirms the happy-path flows are reachable end-to-end. It does not touch the
API, the session middleware, or any other page. The frontend component test ring (RTL)
covers the form validation locally; the Playwright smoke covers the round-trip against
the running app.

## Non-negotiables
- **The frontend never constructs display strings from error codes.** It reads the code
  from `{ error: { code } }` and looks up `t('errors.<CODE>')` from `next-intl`. An
  unknown code falls back to `t('errors.UNKNOWN')`. Never interpolate the raw code into
  the UI.
- **No new error codes.** This task is a pure consumer of the F01 registry. If the API
  returns a code not in the registry, it falls back to `errors.UNKNOWN` — do not invent
  a display string.
- **The Google button links to `/auth/google`.** It is an `<a>` tag (or `window.location`
  navigation), not a client-side API call. The browser must follow the redirect chain
  that A02 sets up. Do not call `POST /auth/login` with a Google token.
- **No layout work beyond the unauthenticated shell** (`(auth)/layout.tsx`). The global
  nav, dark mode toggle, and locale switcher are the `frontend` ledger's job.

## Context (anchors)
- `frontend/app/(auth)/sign-in/page.tsx` — **create this file**. Login form + Google button.
  Route is `/sign-in` (frontend spec route map — not `/login`).
- `frontend/app/(auth)/register/page.tsx` — **create this file**. Register form + Google button.
- `frontend/app/(auth)/layout.tsx` — **create this file**. Minimal unauthenticated shell:
  no nav bar, centred card, logo, `{children}`.
- `frontend/styles/tokens.css` (:F01) — design tokens. Use `var(--primary)`,
  `var(--radius-input)`, etc. No literal hex values in component styles.
- `frontend/messages/en.json` (:F01) — all `errors.*` keys already seeded by F01.
  Add UI-surface keys needed for these forms under a `auth` namespace, e.g.:
  ```json
  {
    "auth": {
      "signIn": "Sign in",
      "register": "Create account",
      "emailLabel": "Email",
      "passwordLabel": "Password",
      "googleButton": "Continue with Google",
      "alreadyHaveAccount": "Already have an account?",
      "noAccount": "Don't have an account?",
      "forgotPassword": "Forgot password?"
    }
  }
  ```
  Add matching Turkish translations to `frontend/messages/tr.json`.
- `frontend/src/i18n.ts` (:F01) — `next-intl` config. Use `useTranslations('auth')` and
  `useTranslations('errors')` in the form components.
- `frontend/app/middleware.ts` (:F01) — next-intl locale middleware already wires the
  `(auth)` routes. No changes needed here unless the matcher misses `/sign-in` or
  `/register`.
- `tests/smoke/auth.spec.ts` — **create this file**. Playwright smoke test.
  Two scenarios: (1) register a new account and land on dashboard, (2) sign in with an
  existing account and land on dashboard. Use `test.use({ baseURL: process.env.BASE_URL ?? 'http://localhost' })`.

  **Trap:** The smoke test must create its own user (via the API directly, not via the UI
  register flow, for the login smoke) to avoid order dependency. Use `request.post('/auth/register')`
  in the `test.beforeAll` fixture.

## Steps
- [ ] **1. Confirm A01 and A02 artefacts exist**
  - `POST /auth/register`, `POST /auth/login` return the expected shapes.
  - `GET /auth/google` redirects (302).
  If any endpoint is missing (A01/A02 not done), set this task to `blocked` and stop.

- [ ] **2. Install frontend dependencies (if not already present from F01)**
  ```bash
  cd frontend && npm install react-hook-form @hookform/resolvers zod
  ```
  (next-intl was installed by F01.)

- [ ] **3. Add `auth` namespace keys to locale files**
  - Add the `auth` namespace object to `frontend/messages/en.json` (keys listed in
    Context).
  - Add Turkish translations to `frontend/messages/tr.json`.
  Do not remove or rename any existing key — F01 seeded the `errors` namespace and it
  must stay intact.

- [ ] **4. Create `frontend/app/(auth)/layout.tsx`**
  - Minimal shell: renders `{children}` inside a centred card using design tokens.
  - No nav, no locale switcher, no dark-mode toggle.
  - Import `../styles/tokens.css` if not already globally imported in the root layout.

- [ ] **5. Create `frontend/app/(auth)/register/page.tsx`**
  - Form fields: `email` (type=email), `password` (type=password).
  - Client-side Zod schema: `{ email: z.string().email(), password: z.string().min(10) }`.
    Show inline field error for `password < 10` before submission (UX only — the API also
    enforces it; duplicating it client-side prevents a round-trip for the obvious case).
  - On submit: `POST /auth/register` with `{ email, password }`.
    - `201` → `router.push('/dashboard')` (or `router.replace` to avoid back-button loop).
    - `422 PASSWORD_TOO_SHORT` → display `t('errors.PASSWORD_TOO_SHORT')` below the
      password field.
    - `409 EMAIL_TAKEN` → display `t('errors.EMAIL_TAKEN')` below the email field.
    - `429 RATE_LIMITED` → display `t('errors.RATE_LIMITED')` as a form-level banner.
    - Any other code → display `t('errors.UNKNOWN')` as a form-level banner.
  - Google button: `<a href="/auth/google">{t('auth.googleButton')}</a>`.
  - Link to `/sign-in` for existing accounts.
  - Loading state: disable submit button while the fetch is in flight.

- [ ] **6. Create `frontend/app/(auth)/sign-in/page.tsx`**
  - Same structure as register but: `POST /auth/login`, success → `router.push(returnPath ?? '/dashboard')`.
  - Read `returnPath` from `?returnPath=` query param (set by the UNAUTHENTICATED redirect
    middleware). Validate it is a relative path (starts with `/`) before using; default
    to `/dashboard` otherwise (open-redirect defence).
  - Read `?error=` query param (set by A02's OAuth callback redirect). If present and a
    known error code, display `t('errors.<CODE>')` as a form-level banner on mount.
  - Error handling same codes as register (omit `EMAIL_TAKEN`; add `INVALID_CREDENTIALS`).
  - Google button links to `/auth/google`.
  - Link to `/register` for new accounts.

- [ ] **7. Add UNAUTHENTICATED redirect to Next.js middleware (or a route guard hook)**
  - When any page protected by auth receives `401 UNAUTHENTICATED` (e.g. from a server
    component prefetch or a client query), redirect to `/sign-in?returnPath=<currentPath>`.
  - Implement as a Next.js middleware matcher or a shared `useRequireAuth` hook that calls
    `router.push('/sign-in?returnPath=' + encodeURIComponent(pathname))` on `UNAUTHENTICATED`.
    The frontend spec (error-code table) mandates this behaviour.

- [ ] **8. Write component tests (React Testing Library)**
  Create `frontend/src/app/(auth)/register/page.test.tsx` and `sign-in/page.test.tsx`:
  - Mock `fetch` (or use `msw` if already set up by foundations).
  - Test: submitting short password shows inline `PASSWORD_TOO_SHORT` message without a
    network call.
  - Test: `201` response redirects to `/dashboard`.
  - Test: `409 EMAIL_TAKEN` shows the localised error message.
  - Test: `401 INVALID_CREDENTIALS` shows the correct error on the login form.
  These tests are the component-ring verification for a task that has no acceptance-ring
  Cucumber scenarios.

- [ ] **9. Create `tests/smoke/auth.spec.ts`**
  - `test.beforeAll`: create a known user via `request.post('/auth/register')` for the
    login smoke.
  - Smoke 1 (register): visit `/register`, fill fields (unique email, 10-char password),
    submit, assert URL is `/dashboard`.
  - Smoke 2 (sign-in): visit `/sign-in`, use the pre-created user, submit, assert URL is
    `/dashboard`.
  - No assertions on page copy — any assertion on English text fails under the Turkish
    locale (frontend spec §4.5 note). Assert only on URL and HTTP status.
  - Add a `playwright.config.ts` at repo root if it does not exist (F03 may have
    created a skeleton; extend it, do not overwrite).

- [ ] **10. Run Verification commands.**

## Definition of done
- `/register` form submits with a 10-char password and redirects to `/dashboard`; short
  password shows inline `errors.PASSWORD_TOO_SHORT` localised message without a network
  call.
- `/sign-in` form with correct credentials redirects to `/dashboard`; wrong password shows
  `errors.INVALID_CREDENTIALS`.
- `?error=ADMIN_MUST_USE_PASSWORD` on `/sign-in` displays the localised message on mount.
- `UNAUTHENTICATED` on a protected route redirects to `/sign-in?returnPath=<path>` and
  after sign-in, `/dashboard` (or the preserved path) is shown.
- No literal English copy is asserted in tests — only URL and response status.
- Component tests for both forms exit 0.
- Playwright smoke passes against the running `docker compose up` stack.

## Verification

**Component tests (RTL):**
```bash
npm run -w frontend test -- --testPathPattern="(sign-in|register)"
```
Expected: all component tests pass, zero failures.

**Playwright smoke (requires running app):**
```bash
npx playwright test tests/smoke/auth.spec.ts
```
Expected: two smoke scenarios pass.

Smoke is browser-only and is **not** an acceptance-ring Cucumber scenario. It confirms the
round-trip is wired, not that the business rules are correct (those are AC-1 through AC-5).

## Notes

(Empty until the task is done. Fill with: what actually happened, whether `react-hook-form`
was used or native form handling, the `returnPath` sanitisation approach, whether
`playwright.config.ts` was extended or created from scratch, the component test mock
strategy (msw or manual fetch mock), the Playwright smoke output verbatim, what was
deliberately NOT done, and a "For frontend ledger" hand-off noting what remains: locale
switcher, full nav shell, dashboard screen.)
