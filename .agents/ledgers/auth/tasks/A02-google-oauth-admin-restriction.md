# A02 — Adding Google OAuth (arctic PKCE), account linking, and admin password restriction
REPO: (this repo) · Depends: A01 · Status: todo
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
- [ ] **1. Install `arctic`**
  ```bash
  cd backend && npm install arctic
  ```

- [ ] **2. Confirm A01 artefacts exist**
  - `backend/modules/auth/router.ts` exports a Router with the comment marking where to
    add Google routes.
  - `backend/src/lib/session.ts` exports `generateToken`, `issueCookie`, `revokeCookie`.
  - `backend/modules/auth/rate-limit.ts` exports a Redis client.
  If any is missing, set this task to `blocked` and stop.

- [ ] **3. Extend `backend/src/lib/session.ts` with `issueSessionForUser`**
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

- [ ] **4. Create `backend/modules/auth/google.ts`**

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

- [ ] **5. Mount Google routes in `backend/modules/auth/router.ts`**
  ```ts
  import { startGoogle, googleCallback } from './google';
  router.get('/google', startGoogle);
  router.get('/google/callback', googleCallback);
  ```

- [ ] **6. Ensure env keys are present**
  - If `config.GOOGLE_CLIENT_ID` and `config.GOOGLE_CLIENT_SECRET` are not in F03's
    `env.ts` Zod schema, add them as `z.string().optional()` (optional so
    `AI_ENABLED=false`-style dev runs without Google credentials still boot).

- [ ] **7. Tests — Cucumber step definitions for AC-4 and AC-5**
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

- [ ] **8. Run Verification command and confirm AC-4 and AC-5 green.**

- [ ] **9. Re-run AC-1/2/3 to confirm A01 is not regressed by the `issueSessionForUser` refactor.**
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

(Empty until the task is done. Fill with: what actually happened, whether the test seam
was needed and how it was implemented, the exact arctic API used (it may differ between
versions — record the version pinned), whether `email_verified` arrived as a boolean or
string from the mock and how it was normalised, the Cucumber output verbatim, what was
deliberately NOT done, and a "For A03" hand-off noting the `?error=<CODE>` query param
convention for the frontend forms.)
