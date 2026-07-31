# A02 — Adding Google OAuth (arctic PKCE), account linking, and admin password restriction
REPO: (this repo) · Depends: A01 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — OAuth trust boundary (PKCE state validation, `email_verified` link rule, admin restriction) — a subtle bug here creates an account-takeover vector or silently hands an admin session to a Google-only flow.

## Goal
Owner's ask:

> "Google OAuth linking (K8.5), the admin-must-use-password rule checked both in the
> callback and at session creation, and `OAUTH_STATE_MISMATCH` / `ACCOUNT_LINK_REQUIRES_PASSWORD`
> / `ADMIN_MUST_USE_PASSWORD` wired to the correct HTTP codes. Scenarios AC-4 and AC-5 must
> be green."
> — auth ledger task decomposition

This task extends `backend/modules/auth/router.ts` (created in A01) with the two Google
routes and adds the admin restriction enforcement. It does not modify any of A01's
existing handlers beyond the session-issuance helper (where the admin check is also
embedded, per K8). The frontend Google button wiring is A03.

## Security boundaries
- **The admin restriction is a K8 hard requirement checked twice.** Once in
  `GET /auth/google/callback` (before session issuance) and once in the session-issuance
  helper. Checking it only in the callback allows a future code path to bypass it. Both
  checks must remain after this task. The `admin_auth.feature` scenario asserts no cookie
  is set — the test will catch a single-point bypass, but the double-check is the
  defence-in-depth requirement, not just a test artefact.
- **The PKCE state and verifier must be consumed exactly once.** Store them in separate
  short-lived `httpOnly` cookies (e.g. `oauth_state` and `oauth_verifier`). In the
  callback, read both, verify, then clear both cookies regardless of outcome. A replay
  attack is only possible if the verifier cookie persists after a failed callback.
- **`email_verified: true` from Google is the only acceptable link trigger.** Any value
  that is not the boolean `true` (including a truthy string `"true"`) must be treated as
  unverified. Use strict equality (`=== true`).
- **Never log `google_sub`, the authorization code, or the token endpoint response body.**
  Log `AUTH_GOOGLE_LINKED` with `userId` and `traceId` only.

## Context (anchors)
- `backend/modules/auth/router.ts` (:A01) — the router to extend. The comment
  `// A02 will mount Google routes below this line` marks where to add:
  `router.get('/google', startGoogle); router.get('/google/callback', googleCallback);`
- `backend/modules/auth/google.ts` — **create this file**. Two exported handlers:
  `startGoogle` and `googleCallback`.
- `backend/src/lib/session.ts` (:A01) — `generateToken()`, `issueCookie()`. Add an
  **admin check** guard to `issueCookie` or create a thin `issueSessionForUser(user, res)`
  wrapper that enforces `if (user.role === 'admin' && !user.password_hash)` →
  throw `ADMIN_MUST_USE_PASSWORD`. This is the second check required by K8.

  **Trap:** the admin restriction is: `role === 'admin'` + the sign-in path is Google
  (i.e. we are in this callback or in a hypothetical future OAuth flow). The cleanest
  model is: the session-issuance wrapper checks whether the user has `role === 'admin'`
  AND the calling context is not a password-verified login. Add a parameter
  `source: 'password' | 'google'` to `issueSessionForUser` and reject when
  `source === 'google' && user.role === 'admin'`.

- `backend/src/lib/env.ts` (:F03) — `config.GOOGLE_CLIENT_ID`, `config.GOOGLE_CLIENT_SECRET`,
  `config.PUBLIC_ORIGIN` (used as the OAuth redirect URI:
  `${config.PUBLIC_ORIGIN}/auth/google/callback`). If these env keys are not in F03's Zod
  schema, add them with `z.string().optional()` (optional because `AI_ENABLED=false` is
  a valid dev-only run; K8.5 says no Google flow is exercised then). Log a startup warning
  if `GOOGLE_CLIENT_ID` is absent and `NODE_ENV !== 'test'`.
- `backend/modules/auth/rate-limit.ts` (:A01) — exposes the shared Redis client. Reuse it
  to store/read PKCE state and verifier: keys `oauth:state:<state>` and `oauth:verifier:<state>`,
  TTL 10 minutes. This avoids an extra `httpOnly` cookie for the verifier (PKCE verifier
  in a cookie is equally valid; pick one approach and be consistent).

  **Note on implementation choice:** Storing state+verifier in Redis (keyed by state value)
  is slightly cleaner than two separate cookies because it survives a browser crash without
  a dangling cookie. Either approach is correct; use Redis if the shared client is already
  available from A01 (it is).

- `backend/src/lib/db.ts` (:F02) — `prisma.user.findUnique`, `prisma.user.create`,
  `prisma.user.update` (to set `google_sub`).

## Steps
- [x] **1. Install `arctic`**
  ```bash
  cd backend && npm install arctic
  ```

- [x] **2. Confirm A01 artefacts exist**
  - `backend/modules/auth/router.ts` exports a Router with the comment marking where to
    add Google routes.
  - `backend/src/lib/session.ts` exports `generateToken`, `issueCookie`, `revokeCookie`.
  - `backend/modules/auth/rate-limit.ts` exports a Redis client.
  If any is missing, set this task to `blocked` and stop.

- [x] **3. Extend `backend/src/lib/session.ts` with `issueSessionForUser`**
  ```ts
  export async function issueSessionForUser(
    user: User,
    res: Response,
    source: 'password' | 'google'
  ): Promise<void> {
    if (source === 'google' && user.role === 'admin') {
      throw Object.assign(new Error('ADMIN_MUST_USE_PASSWORD'), { code: 'ADMIN_MUST_USE_PASSWORD' });
    }
    const token = generateToken();
    await prisma.session.create({
      data: { id: token, user_id: user.id, expires_at: new Date(Date.now() + 7*24*60*60*1000) },
    });
    issueCookie(res, token);
  }
  ```
  Update A01's `register.ts` and `login.ts` to call `issueSessionForUser(user, res, 'password')`
  instead of the inline session creation. This centralises the admin check at the issuance
  point (the second K8 check location).

- [x] **4. Create `backend/modules/auth/google.ts`**

  **`startGoogle` handler:**
  1. Instantiate `arctic.Google(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, redirectUri)`.
  2. Generate state: `const state = arctic.generateState()`.
  3. Generate PKCE verifier: `const verifier = arctic.generateCodeVerifier()`.
  4. Build auth URL: `const url = await google.createAuthorizationURL(state, verifier, { scopes: ['openid', 'email', 'profile'] })`.
  5. Store `state` → `verifier` in Redis: `redis.set(`oauth:verifier:${state}`, verifier, 'EX', 600)`.
  6. Set `oauth_state` cookie (same attributes as session cookie, `maxAge: 600`) to `state`.
  7. `res.redirect(302, url.toString())`.

  **`googleCallback` handler:**
  1. Read `req.query.code` (string) and `req.query.state` (string). Validate both are
     non-empty strings; if not: clear `oauth_state` cookie, return `400 OAUTH_STATE_MISMATCH`.
  2. Read `req.cookies.oauth_state`. If absent or ≠ `req.query.state`: clear cookies,
     return `400 OAUTH_STATE_MISMATCH`.
  3. Look up `verifier = await redis.get(`oauth:verifier:${req.query.state}`)`. If null
     (expired or replayed): clear cookies, return `400 OAUTH_STATE_MISMATCH`.
  4. Delete the Redis key and clear `oauth_state` cookie (consume once).
  5. Exchange tokens: `const tokens = await google.validateAuthorizationCode(code, verifier)`.
     Wrap in try/catch; any error → `400 OAUTH_STATE_MISMATCH`.
  6. Fetch Google user info: `GET https://openidconnect.googleapis.com/v1/userinfo` with
     the access token. Parse: `{ sub, email, email_verified }`.
  7. Normalise: `email_lower = email.trim().toLowerCase()`.
  8. **Admin check (first occurrence):** look up user by `email_lower`. If found and
     `user.role === 'admin'`:
     - `logger.warn({ traceId }, 'AUTH_ADMIN_GOOGLE_BLOCKED')`.
     - Redirect to `${config.PUBLIC_ORIGIN}/sign-in?error=ADMIN_MUST_USE_PASSWORD`.
     - **Do not issue a session.** Return here.
  9. **Account linking / creation:**
     - If user found and `email_verified === true` (strict boolean): link —
       `prisma.user.update({ where: { id: user.id }, data: { google_sub: sub } })`.
       `logger.info({ userId: user.id, traceId }, 'AUTH_GOOGLE_LINKED')`.
     - If user found and `email_verified !== true`: redirect to
       `${config.PUBLIC_ORIGIN}/sign-in?error=ACCOUNT_LINK_REQUIRES_PASSWORD`. Return.
     - If user not found: create —
       `prisma.user.create({ data: { email_lower, google_sub: sub, password_hash: null } })`.
  10. **Session issuance (second admin check via `issueSessionForUser`):**
      `await issueSessionForUser(resolvedUser, res, 'google')`.
      The function throws if somehow an admin slips through step 8 (defence in depth).
      Catch that error: redirect to `/sign-in?error=ADMIN_MUST_USE_PASSWORD`.
  11. `res.redirect(302, `${config.PUBLIC_ORIGIN}/dashboard`)`.

  **`error` query param handling note:** The frontend `/sign-in` page must read
  `?error=` and display the corresponding `errors.<CODE>` message. This is A03's job;
  A02 only sets the redirect URL.

- [x] **5. Mount Google routes in `backend/modules/auth/router.ts`**
  ```ts
  import { startGoogle, googleCallback } from './google';
  router.get('/google', startGoogle);
  router.get('/google/callback', googleCallback);
  ```

- [x] **6. Ensure env keys are present**
  - If `config.GOOGLE_CLIENT_ID` and `config.GOOGLE_CLIENT_SECRET` are not in F03's
    `env.ts` Zod schema, add them as `z.string().optional()` (optional so
    `AI_ENABLED=false`-style dev runs without Google credentials still boot).

- [x] **7. Tests — Cucumber step definitions for AC-4 and AC-5**
  The Cucumber scenarios use `When Google sign-in completes for "<email>" with
  email_verified <bool>`. This step must bypass the real Google OAuth redirect and directly
  exercise the linking/restriction logic. Implement it by having the test world call an
  internal test helper endpoint (`POST /test/auth/simulate-google-callback`) that is
  **only mounted when `NODE_ENV === 'test'`**. The endpoint accepts
  `{ email, email_verified, sub? }` and triggers the same resolution logic as the real
  callback (minus the token exchange). Mark this endpoint's presence with a comment:
  `// TEST SEAM — remove if this endpoint ever appears in production routes`.

  **Trap:** The test seam must not be reachable in production. Guard it with
  `if (config.NODE_ENV !== 'test') throw new Error('test route in production')` at mount
  time, not just at call time — so a misconfigured deploy fails loudly at startup.

- [x] **8. Run Verification command and confirm AC-4 and AC-5 green.**

- [x] **9. Re-run AC-1/2/3 to confirm A01 is not regressed by the `issueSessionForUser` refactor.**
  ```bash
  npm run test:acceptance -- --tags "@AC-1 or @AC-2 or @AC-3"
  ```

## Definition of done
- Admin account completing Google sign-in is rejected `403 ADMIN_MUST_USE_PASSWORD` and no
  session cookie is set; same admin signs in with email + password successfully (AC-4).
- Google sign-in for an existing password account with `email_verified: false` returns `403
  ACCOUNT_LINK_REQUIRES_PASSWORD` and no session is set; same flow with `email_verified:
  true` issues a session and links `google_sub` on the `users` row (AC-5).
- `OAUTH_STATE_MISMATCH` (400) is returned when state cookie is absent, mismatched, or
  Redis key is expired/consumed.
- `GET /auth/google` redirects to a Google-shaped URL (contains `accounts.google.com`);
  the redirect URI and `state` parameter are present.
- No `google_sub`, auth code, or token appears in any log line.
- `npm run test:acceptance -- --tags "@AC-4 or @AC-5"` exits 0.
- `npm run test:acceptance -- --tags "@AC-1 or @AC-2 or @AC-3"` still exits 0 (no regression).

## Verification
```bash
npm run test:acceptance -- --tags "@AC-4 or @AC-5"
```

Expected output: two scenarios pass, zero failures, zero pending.

Regression check (run immediately after):
```bash
npm run test:acceptance -- --tags "@AC-1 or @AC-2 or @AC-3"
```

Both commands must exit 0.

## Notes

Done 2026-07-31. `2 scenarios (2 passed) / 17 steps (17 passed)` for AC-4+AC-5;
`3 scenarios (3 passed) / 26 steps (26 passed)` for the AC-1/2/3 regression;
`5 scenarios (5 passed) / 43 steps (43 passed)` for the whole default suite.

**What exists now**
- `backend/src/lib/session.ts` — added `issueSessionForUser(user, res, source)` and the
  `SessionSource = 'password' | 'google'` type. It is now the **only** place a `sessions`
  row is created; `register.ts` and `login.ts` call it with `'password'` and no longer
  build the row inline. This is K8's second admin check.
- `backend/modules/auth/google.ts` — `startGoogle`, `googleCallback`, and the exported
  `resolveGoogleIdentity(identity, traceId)` which holds the whole trust boundary.
  Resolution order: `findUnique({ google_sub })` → else `findUnique({ email_lower })` →
  admin check on whichever matched → already-linked short-circuit → strict
  `email_verified === true` gate → link or create.
- `backend/modules/auth/test-seam.ts` — `POST /test/auth/simulate-google-callback`,
  mounted from `app.ts` only when `config.NODE_ENV === 'test'`.
- `backend/modules/auth/router.ts` — `GET /google`, `GET /google/callback` under `/auth`.
- `backend/cucumber.js` — `admin_auth.feature` added to `paths`; AC-5 lost its `@wip` tag
  in `.agents/features/auth.feature`.
- `arctic@3.7.0` added to `backend` dependencies.

**arctic 3.7.0 API (differs from the task file's sketch)**
- `new Google(clientId, clientSecret, redirectURI)` — as written.
- `createAuthorizationURL(state, codeVerifier, scopes: string[])` is **synchronous** and
  takes a bare `string[]`, not `{ scopes }`. The task file's `await …, { scopes: [...] }`
  does not compile against v3.
- `generateState()` / `generateCodeVerifier()` are top-level exports of `arctic`.
- `validateAuthorizationCode(code, verifier)` returns an `OAuth2Tokens` whose access token
  is read via the method `tokens.accessToken()`, not a property.
- arctic 3.x is ESM-only (`"type": "module"`). It imports fine from the CJS-transpiled
  acceptance run because `tsx/cjs` on Node 20.20 supports `require(esm)`. Worth knowing if
  the runtime ever moves below Node 20.19.

**Deviations from the plan (all deliberate)**
- **PKCE storage.** Redis holds only the verifier (`oauth:verifier:<state>`, 600 s TTL) and
  the `oauth_state` cookie holds the state, as the task's step 4 describes. Consumption is
  a single `GETDEL`, so a replayed callback finds nothing — a `GET` + later `DEL` would
  leave a window.
- **`OAUTH_STATE_MISMATCH` is a 400 JSON body, not a redirect.** The Definition of Done
  says "returned", and step 1–3 of the callback say `return 400`; only the admin and
  link-refusal paths redirect to `/sign-in?error=<CODE>`. The task file's step 8/9 prose
  and its DoD disagree on nothing else.
- **Missing Google credentials → `NOT_READY` (503).** The task file did not specify a code
  and no new registry entry was needed; `NOT_READY` already exists and is honest ("the
  provider isn't configured"). No new error code was added to F01's registry.
- **Resolution starts from `google_sub`, not from the email.** The task file looks up by
  email only, which would send an already-linked Google-only account through the
  `email_verified` gate on every subsequent sign-in and 403 it if Google ever omitted the
  claim. Looking up by `sub` first makes re-sign-in idempotent without weakening anything:
  a row only *gets* a `google_sub` by passing the strict gate once.
- **`email_verified` is typed `unknown` end to end.** The Zod userinfo schema uses
  `z.unknown()` and `resolveGoogleIdentity` does `=== true`, so a truthy `"true"` string,
  a `1`, or an absent claim all read as unverified. Normalising to a boolean anywhere
  earlier would have destroyed exactly the distinction the rule needs. The Cucumber step
  sends a real JSON boolean.

**Test seam**
Needed — a Cucumber scenario cannot survive a redirect to `accounts.google.com`. The seam
calls the same `resolveGoogleIdentity` + `issueSessionForUser` the real callback calls;
only the redirect and the token exchange are skipped, so a bug in the rules fails the
suite. `mountTestSeam()` throws `test route in production` at **mount** time, verified:
under `NODE_ENV=production` the call throws and `POST /test/auth/simulate-google-callback`
is a 404 on the real app.

**Verification not covered by the feature files** (no scenario exists for it; run against a
booted app on an ephemeral port, script kept out of the repo):
```
start status      : 302
start host        : accounts.google.com
redirect_uri      : https://interviewly.example/auth/google/callback
code_challenge_m  : S256
scope             : openid email profile
oauth_state cookie: matches state; Max-Age=600; Path=/; HttpOnly; SameSite=Lax
no cookie          : 400 {"error":{"code":"OAUTH_STATE_MISMATCH"}}
cookie mismatch    : 400 {"error":{"code":"OAUTH_STATE_MISMATCH"}}
missing code       : 400 {"error":{"code":"OAUTH_STATE_MISMATCH"}}
bad code (exchange): 400 {"error":{"code":"OAUTH_STATE_MISMATCH"}}
replayed           : 400 {"error":{"code":"OAUTH_STATE_MISMATCH"}}
```

**Deliberately NOT done**
- No vitest unit test, so `--passWithNoTests` stays in `backend/package.json` → `test:unit`
  and the `unit` CI job is still a false green. It is not a free change: `google.ts`
  transitively imports `rate-limit.ts`, which opens an `ioredis` client at module load with
  `maxRetriesPerRequest: null`, and the `unit` CI job has no Redis service — the test would
  hang. Recorded in this ledger's Backlog as a lazy-client change.
- No frontend work: the Google button, the `?error=<CODE>` rendering and the `/dashboard`
  landing are A03's.
- `publicUser` was left as `{ id, email, role, locale }` — still no `google_sub`, by design.

**Env**
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` were already `z.string().optional()` in F03's
`env.ts` and already present (blank) in `.env.example`. Nothing to add. A boot with neither
set logs `AUTH_GOOGLE_NOT_CONFIGURED` once, unless `NODE_ENV=test`.

**Local infra gotcha (unchanged from A01)**: a Homebrew Postgres owns `127.0.0.1:5432`, and
`5433` is taken by another Docker project on this machine. Ran db/cache on host `5434/6380`
via an uncommitted override file, with `DATABASE_URL=…@localhost:5434` and
`REDIS_URL=redis://localhost:6380`. CI is unaffected.

**For A03**
- The Google button is a plain link to `GET /auth/google` — no `fetch`, it must be a real
  navigation so the 302 chain and the `oauth_state` cookie work.
- Success lands on `${PUBLIC_ORIGIN}/dashboard`. That route does not exist yet; A03 (or A06
  first-run routing) has to provide it or the happy path dead-ends.
- Failure lands on `${PUBLIC_ORIGIN}/sign-in?error=<CODE>` where `<CODE>` is
  `ADMIN_MUST_USE_PASSWORD` or `ACCOUNT_LINK_REQUIRES_PASSWORD`. Read the query param and
  render `errors.<CODE>`; never render the raw code.
- `OAUTH_STATE_MISMATCH` never reaches `/sign-in` — it is a 400 JSON body on the callback
  URL itself, which only happens on a tampered or stale callback.
