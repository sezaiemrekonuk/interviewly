# A03 — Building the frontend login and register forms
REPO: (this repo) · Depends: A02 · Status: done
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
- [x] **1. Confirm A01 and A02 artefacts exist**
  - `POST /auth/register`, `POST /auth/login` return the expected shapes.
  - `GET /auth/google` redirects (302).
  If any endpoint is missing (A01/A02 not done), set this task to `blocked` and stop.

- [x] **2. Install frontend dependencies (if not already present from F01)**
  ```bash
  cd frontend && npm install react-hook-form @hookform/resolvers zod
  ```
  (next-intl was installed by F01.)

- [x] **3. Add `auth` namespace keys to locale files**
  - Add the `auth` namespace object to `frontend/messages/en.json` (keys listed in
    Context).
  - Add Turkish translations to `frontend/messages/tr.json`.
  Do not remove or rename any existing key — F01 seeded the `errors` namespace and it
  must stay intact.

- [x] **4. Create `frontend/app/(auth)/layout.tsx`**
  - Minimal shell: renders `{children}` inside a centred card using design tokens.
  - No nav, no locale switcher, no dark-mode toggle.
  - Import `../styles/tokens.css` if not already globally imported in the root layout.

- [x] **5. Create `frontend/app/(auth)/register/page.tsx`**
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

- [x] **6. Create `frontend/app/(auth)/sign-in/page.tsx`**
  - Same structure as register but: `POST /auth/login`, success → `router.push(returnPath ?? '/dashboard')`.
  - Read `returnPath` from `?returnPath=` query param (set by the UNAUTHENTICATED redirect
    middleware). Validate it is a relative path (starts with `/`) before using; default
    to `/dashboard` otherwise (open-redirect defence).
  - Read `?error=` query param (set by A02's OAuth callback redirect). If present and a
    known error code, display `t('errors.<CODE>')` as a form-level banner on mount.
  - Error handling same codes as register (omit `EMAIL_TAKEN`; add `INVALID_CREDENTIALS`).
  - Google button links to `/auth/google`.
  - Link to `/register` for new accounts.

- [x] **7. Add UNAUTHENTICATED redirect to Next.js middleware (or a route guard hook)**
  - When any page protected by auth receives `401 UNAUTHENTICATED` (e.g. from a server
    component prefetch or a client query), redirect to `/sign-in?returnPath=<currentPath>`.
  - Implement as a Next.js middleware matcher or a shared `useRequireAuth` hook that calls
    `router.push('/sign-in?returnPath=' + encodeURIComponent(pathname))` on `UNAUTHENTICATED`.
    The frontend spec (error-code table) mandates this behaviour.

- [x] **8. Write component tests (React Testing Library)**
  Create `frontend/src/app/(auth)/register/page.test.tsx` and `sign-in/page.test.tsx`:
  - Mock `fetch` (or use `msw` if already set up by foundations).
  - Test: submitting short password shows inline `PASSWORD_TOO_SHORT` message without a
    network call.
  - Test: `201` response redirects to `/dashboard`.
  - Test: `409 EMAIL_TAKEN` shows the localised error message.
  - Test: `401 INVALID_CREDENTIALS` shows the correct error on the login form.
  These tests are the component-ring verification for a task that has no acceptance-ring
  Cucumber scenarios.

- [x] **9. Create `tests/smoke/auth.spec.ts`**
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

- [x] **10. Run Verification commands.**

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

**Status 2026-08-03: `done`.** BLOCKER-1b is fixed in F03 — `docker compose up -d --build`
brings all 8 containers up, `api` healthy and `edge` serving. Both Verification commands ran
against that stack:

```
npm run -w frontend test -- --testPathPattern="(sign-in|register)"   13 passed
npx playwright test tests/smoke/auth.spec.ts                          2 passed
```

Gates: `npm run lint`, `npm run typecheck`, `npm test` (122) clean; `npx cucumber-js -p auth`
23 scenarios / 195 steps passed (behaviour untouched, run as evidence).

**The smoke's landing assertion moved from `/dashboard` to `/onboarding/1`.** A06 replaced
`DEFAULT_LANDING_PATH` with the K8.7 rule (`lib/first-run.ts`), exactly as this file's
"For A04 / A06" note anticipated, so a brand-new account no longer reaches `/dashboard`.
`/dashboard` is the rule's terminal branch — onboarding complete **and** ≥1 interview — which
no account this smoke creates can reach. **This file's Definition of done still says
`/dashboard`; it is superseded by K8.7, not unmet.** The rule's own branches are covered by
the auth cucumber ring, not here.

**Two environment traps for whoever runs this next (neither is a code defect):**
- **Register limiter is 3/hr/IP.** The smoke spends 2 per run, so a second run inside the
  hour fails in `beforeAll` with 429. Clear with
  `docker compose exec cache redis-cli DEL 'ratelimit:register:::ffff:<ip>'` — not `FLUSHALL`,
  which drops the seeded demo admin's session state too. CI needs an ephemeral Redis.
- **A host-local Postgres on `127.0.0.1:5432` shadows the container's published port** and
  makes `npx cucumber-js -p auth` fail with `P1010: User was denied access` — a connection
  problem wearing a credentials error's clothes. Check with
  `lsof -nP -iTCP:5432 -sTCP:LISTEN`; route around it with a socat container on a free port
  rather than editing `compose.dev.yaml` (F03's file). Also note the harness refuses any
  database not named `*_test`/`*ci`, so `DATABASE_URL` must point at `interviewly_test`.

---

**Historical — status 2026-07-31: `blocked`, not `done`.** The component ring is complete and green;
the Playwright smoke cannot run *from `docker compose up`* because that stack does not
come up. Three F03 defects, all reproduced — see STATE.md → `## Open blockers`.

**Session 2 ran the smoke green against a hand-assembled runtime** (host API + `next dev` +
a Caddy container carrying the committed Caddyfile with the one proposed `handle_path`
change). `2 passed`. That is evidence A03's code is correct and that the proposed fix for
BLOCKER-1 (3) is the right one — it is *not* the Definition of done, which requires the
smoke to pass against `docker compose up`. The row stays `blocked` until F03 lands.

Three defects were found by actually running it, and fixed here:
- **`playwright.config.ts` was self-429ing.** Workers are separate processes and each ran
  the file's `beforeAll`, so two workers spent two of the three hourly registrations on the
  fixture alone. Now `workers: 1`, `fullyParallel: false`, and the fixture's assertion says
  what a 429 means so it does not read as a regression.
- **F01: every route was a 404** — `src/middleware.ts` redirected `/sign-in` → `/en/sign-in`
  and the app has no `[locale]` segment. Removed; see STATE.md defect 4.
- **F01: body copy rendered in fallback serif** — `--font-body` was defined but never
  applied. See STATE.md defect 5.

```
npm run -w frontend test -- --testPathPattern="(sign-in|register)"
  Test Files  2 passed (2)
       Tests  12 passed (12)

npx playwright test tests/smoke/auth.spec.ts --list
  [chromium] › auth.spec.ts:34:7 › auth smoke › register lands on the dashboard
  [chromium] › auth.spec.ts:44:7 › auth smoke › sign-in lands on the dashboard
  Total: 2 tests in 1 file

curl --max-time 5 http://localhost/sign-in   →  000, curl exit 7 (connection refused)
docker compose ps -a
  api    exited   Exited (1)      Cannot find module '/app/backend/dist/index.js'
  worker exited   Exited (1)      (same)
  edge   created  Created         never starts: depends on web+api healthy
  web    running  Up (unhealthy)  healthcheck runs `curl`, absent from the image
```

**Paths differ from this file's Context block.** The frontend is a `src/`-dir Next app, so
everything landed under `frontend/src/app/(auth)/…`, not `frontend/app/(auth)/…`. Same for
the middleware: it is `frontend/src/middleware.ts`, and it needed no change — `next build`
lists the routes as `/sign-in` and `/register` with no locale prefix, so the route map holds.

**What exists now**
- `frontend/src/app/(auth)/layout.tsx` + `layout.module.css` — `--gradient-entry` ground,
  centred card, no nav/toggle/switcher.
- `frontend/src/app/(auth)/{sign-in,register}/page.tsx` — thin page shells; both delegate to
  `components/auth/credentials-form.tsx`.
- `frontend/src/components/auth/` — `credentials-form.tsx` (the shared form),
  `google-button.tsx`, `auth.module.css` (tokens only, no literal hex/radius/duration).
- `frontend/src/lib/api.ts` — `apiGet`/`apiPost`, `API_BASE = '/api'`, `{ error: { code } }`
  extraction. **The only place the edge prefix is written down.**
- `frontend/src/lib/auth-redirect.ts` — `safeReturnPath`, `signInPathFor`,
  `DEFAULT_LANDING_PATH`.
- `frontend/src/lib/use-error-message.ts` — code → `t('errors.<CODE>')`, `UNKNOWN` fallback.
- `frontend/src/lib/use-require-auth.ts` — the `UNAUTHENTICATED` guard.
- `frontend/messages/{en,tr}.json` — `auth` namespace added; `errors` untouched.
- `vitest.config.mts` (root, two projects) + `frontend/vitest.config.mts` + `src/test/`.
- `playwright.config.ts` — **created**, no skeleton existed. `tests/smoke/auth.spec.ts`.

**Decisions worth knowing**
- **`react-hook-form` + `zodResolver`**, as the task specified. Zod messages are error
  *codes* (`'PASSWORD_TOO_SHORT'`), not sentences, so a locally-caught failure renders
  through the same `errors.<CODE>` lookup the server's version of it would.
- **Login does not repeat `min(10)`.** Register enforces it client-side; sign-in only
  requires non-empty. An account whose password predates the rule must still be able to
  sign in, and a client-side length check there would lock it out of its own form.
- **`returnPath` sanitisation**: reject anything not starting with `/`, then reject `//`
  and `/\` as well. `startsWith('/')` alone is not a defence — the browser reads
  `//evil.example/x` as protocol-relative. Six hostile forms are covered in
  `auth-redirect.test.ts`.
- **Mock strategy: manual `fetch` stub** via `vi.stubGlobal`, not msw — foundations never
  set msw up, and one stubbed global is less machinery than a request-interception layer
  for four status codes.
- **Tests never spell out English copy.** They import `messages/en.json` and assert on
  `messages.errors.EMAIL_TAKEN`, so the key is verified without the wording being frozen.
  Each also asserts the raw code is absent from the DOM.
- **`--testPathPattern` is Jest dialect**; this repo runs Vitest, which rejects it
  (`CACError: Unknown option --testPathPattern`). EXECUTE.md § 6.5 fixes the command, so
  `frontend/scripts/vitest-cli.mjs` translates the flag into Vitest file filters.
- **Landing is `/dashboard` unconditionally**, per this file's Steps and Definition of done.
  The Goal prose asks for the K8.7 first-run rule, but `publicUser` still returns
  `{ id, email, role, locale }` — no `onboardingCompletedAt`, no `interviewCount` — and
  neither `/onboarding/*` nor `/interviews/new` exists. `DEFAULT_LANDING_PATH` is the single
  call site A06 replaces with `lib/first-run.ts`.

**Deliberately NOT done**
- No `/dashboard` page. A02's note flagged the dead-end; it is the frontend ledger's shell,
  not an auth screen. The smoke asserts on URL, which is satisfied either way.
- No locale switcher (frontend ledger owns the component; this ledger's Backlog tracks it).
- No Caddyfile, Dockerfile, healthcheck or `tsconfig.json` edits — all F03, another seat.
- `npx playwright install chromium` was not run; the smoke was validated with `--list`.

**For A04 / A06**
- Add screens under `frontend/src/app/(auth)/…`; the layout and `auth.module.css` are shared.
- Widen `publicUser` and swap `DEFAULT_LANDING_PATH` for the K8.7 rule in one place.
- `useRequireAuth` is the guard for every protected page; it returns `{ user, loading }`.

**For the frontend ledger**
Still missing: `/dashboard`, the global nav shell, the dark-mode toggle, the locale
switcher, and the `wave` mascot asset (the layout has the gradient ground, no mascot).
