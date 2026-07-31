# A01 — Creating the backend auth module: register, login, logout, session cookie, and `/me`
REPO: (this repo) · Depends: F01, F02, F03 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — credential verification, argon2id hashing, session-token issuance — auth is a security invariant; a cheaper model has produced subtly wrong argon2 parameter choices and off-by-one session expiry checks on similar tasks.

## Goal
Owner's ask:

> "Register/sign-in (email+password), the DB-backed opaque session token + cookie, logout,
> and the `requireAuth` middleware that every other module's protected routes depend on.
> `GET /me` must return the current user. Acceptance scenarios AC-1, AC-2, AC-3 must be
> green."
> — auth ledger task decomposition

This task creates the Express application entry point, the `backend/modules/auth/` module,
and the session helper in `backend/src/lib/session.ts`. It does **not** implement Google
OAuth (A02 owns that) or the frontend forms (A03). After this task, A02 can extend
`modules/auth/router.ts` with the Google routes, and any other module can `import {
requireAuth } from '../auth/middleware'` to guard its routes.

## Security boundaries
- **No password, token, or `google_sub` in any log line.** `AUTH_LOGIN_FAILED` logs the
  email (for ops) but never the attempted password. Session token IDs are opaque random
  strings — never logged. Violating this leaks the entire session model.
- **`revoked_at IS NULL AND expires_at > now()` must both be checked** on every
  authenticated request. Checking only expiry misses manual revocations; checking only
  revocation misses token reuse after account deletion.
- **`INVALID_CREDENTIALS` is indistinguishable between wrong email and wrong password**
  (K8, §8). Do not return a different code for "user not found" vs "wrong password" — that
  is a user-enumeration vector.
- **argon2id parameters** must not be loosened from `@node-rs/argon2` defaults. The default
  params are deliberately conservative; shortcutting them to speed up tests is a
  vulnerability.

## Context (anchors)
- `backend/src/lib/error-codes.ts` — F01 registry. Import `PASSWORD_TOO_SHORT`,
  `EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `UNAUTHENTICATED`, `VALIDATION_ERROR`, `RATE_LIMITED`.
  All six are already in F01; no new codes needed for this task.
- `backend/src/lib/db.ts` — F02 Prisma singleton. Use `prisma.user` and `prisma.session`
  directly here (no helper wrapper; userInterviews/activeInterview are interview-scoped).
- `backend/src/lib/logger.ts` — F03 pino factory. `const logger = createLogger('auth')`.
- `backend/src/lib/env.ts` — F03 env config. Use `config.DATABASE_URL`, `config.REDIS_URL`,
  `config.PUBLIC_ORIGIN`, `config.NODE_ENV`, `config.PORT`.
- `backend/src/lib/session.ts` — **create this file in this task**. Exports:
  - `generateToken(): string` — `crypto.randomBytes(32).toString('hex')` (64-char hex).
  - `issueCookie(res: Response, token: string): void` — sets the `session` cookie.
  - `revokeCookie(res: Response): void` — clears the `session` cookie (`maxAge: 0`).
  Cookie attrs: `httpOnly: true`, `secure: config.NODE_ENV === 'production'`,
  `sameSite: 'lax'`, `maxAge: 7 * 24 * 60 * 60`.
- `backend/src/app.ts` — **create this file**. Express app; mounts `express.json()`,
  `cookie-parser`, the auth router at `/auth` and the me router at `/`. Express error
  handler that maps error codes to HTTP status from the registry.
- `backend/src/index.ts` — **create this file**. `app.listen(config.PORT)` and the
  `logger.info({port}, 'SERVER_STARTED')` log line. Nothing else.
- `backend/modules/auth/router.ts` — **create this file**. Mounts `register`, `login`,
  `logout`, and `me` handlers. A02 will add `google` routes here; leave a comment marking
  where.
- `backend/modules/auth/rate-limit.ts` — **create this file**. Single Redis connection via
  `ioredis` reusing `config.REDIS_URL`. Two exported middleware functions:
  `registerLimiter` (3 per hour per IP, sliding) and `loginLimiter` (5 per minute per IP,
  sliding). On limit exceeded: `logger.warn({ip, traceId}, 'RATE_LIMIT_HIT')`, return
  `429` with `{ error: { code: 'RATE_LIMITED' } }`.

  **Trap:** do not open multiple Redis connections. Export one shared client and reuse it
  across both limiters (and export it so A02 can reuse it for PKCE state storage).

## Steps
- [x] **1. Install backend dependencies**
  ```bash
  cd backend
  npm install express cookie-parser ioredis zod @node-rs/argon2
  npm install --save-dev @types/express @types/cookie-parser tsx ts-node
  ```

- [x] **2. Confirm F01 / F02 / F03 artefacts exist**
  - `backend/src/lib/error-codes.ts` — must export `ERROR_CODES` with the six auth codes.
  - `backend/src/lib/db.ts` — must export `prisma`.
  - `backend/src/lib/logger.ts` — must export a logger factory.
  - `backend/src/lib/env.ts` — must export `config` with `DATABASE_URL`, `REDIS_URL`,
    `PUBLIC_ORIGIN`, `PORT`, `NODE_ENV`.
  If any is missing, set this task to `blocked` in STATE.md and stop.

- [x] **3. Create `backend/src/lib/session.ts`**
  - `generateToken()`, `issueCookie()`, `revokeCookie()` per REFERENCE.md.
  - Cookie `secure` flag follows `config.NODE_ENV === 'production'`.

- [x] **4. Create `backend/modules/auth/rate-limit.ts`**
  - One `ioredis` client from `config.REDIS_URL`.
  - `registerLimiter`: sliding window 3/hr keyed `ratelimit:register:<ip>`.
  - `loginLimiter`: sliding window 5/min keyed `ratelimit:login:<ip>`.
  - Both export as Express `RequestHandler`.
  - Log `RATE_LIMIT_HIT` on trip; never log the IP beyond this log line.

- [x] **5. Create `backend/modules/auth/middleware.ts`**
  - `requireAuth(req, res, next)`:
    1. Read `req.cookies.session`. If absent: `401 UNAUTHENTICATED`.
    2. `prisma.session.findUnique({ where: { id: token } })`. If null: `401`.
    3. Check `revoked_at === null` and `expires_at > new Date()`. If either fails: `401`.
    4. Fetch `prisma.user.findUnique({ where: { id: session.user_id } })`. If null: `401`.
    5. Slide: `prisma.session.update({ where: { id: token }, data: { expires_at: new Date(Date.now() + 7*24*60*60*1000) } })`.
    6. Attach `req.user = user`, call `next()`.
  - Export type augmentation: `declare global { namespace Express { interface Request { user?: User } } }`.

- [x] **6. Create `backend/modules/auth/register.ts`**
  - Zod schema: `{ email: z.string().email(), password: z.string() }`.
    - If Zod fails: `422 VALIDATION_ERROR`.
    - If `password.length < 10`: `422 PASSWORD_TOO_SHORT`.
  - `email_lower = email.trim().toLowerCase()`.
  - Check `prisma.user.findUnique({ where: { email_lower } })`. If exists: `409 EMAIL_TAKEN`.
  - `password_hash = await hash(password)` (from `@node-rs/argon2`; default params).
  - `user = prisma.user.create({ data: { email_lower, password_hash } })`.
  - Session: `token = generateToken()`, `prisma.session.create({ data: { id: token, user_id: user.id, expires_at: +7d } })`.
  - `issueCookie(res, token)`.
  - `logger.info({ userId: user.id, traceId: req.traceId }, 'AUTH_REGISTERED')`.
  - Return `201 { user: { id, email: user.email_lower, role: user.role, locale: user.locale } }`.

  **Rate limiting**: apply `registerLimiter` before this handler in the router.

- [x] **7. Create `backend/modules/auth/login.ts`**
  - Zod schema: `{ email: z.string().email(), password: z.string() }`.
    - If Zod fails: `422 VALIDATION_ERROR`.
  - `email_lower = email.trim().toLowerCase()`.
  - `user = prisma.user.findUnique({ where: { email_lower } })`.
  - If null or `await verify(user.password_hash, password)` fails: `401 INVALID_CREDENTIALS`.
    — **Do not distinguish** "user not found" from "wrong password" (user-enumeration
    defence). Log `AUTH_LOGIN_FAILED` with `email_lower` but never the password.
  - Issue session same as register. Return `200 { user }`.
  - `logger.info({ userId: user.id, traceId }, 'AUTH_LOGIN_OK')`.

  **Note:** `user.password_hash` may be `null` if this is a Google-only account. A null
  hash means `verify()` will throw or return false — that is the correct behaviour
  (`INVALID_CREDENTIALS`). Do not special-case it.

  **Rate limiting**: apply `loginLimiter` before this handler in the router.

- [x] **8. Create `backend/modules/auth/logout.ts`**
  - `requireAuth` must be applied before this handler.
  - `prisma.session.update({ where: { id: req.cookies.session }, data: { revoked_at: new Date() } })`.
  - `revokeCookie(res)`.
  - `logger.info({ userId: req.user!.id, traceId }, 'AUTH_LOGOUT')`.
  - Return `204`.

- [x] **9. Create `backend/modules/auth/me.ts`**
  - `requireAuth` applied before this handler.
  - Return `200 { user: { id, email: req.user!.email_lower, role: req.user!.role, locale: req.user!.locale } }`.

- [x] **10. Create `backend/modules/auth/router.ts`**
  ```ts
  import { Router } from 'express';
  import { registerLimiter, loginLimiter } from './rate-limit';
  import register from './register';
  import login from './login';
  import { requireAuth } from './middleware';
  import logout from './logout';
  import me from './me';
  // A02 will mount Google routes below this line — do not remove this comment.

  const router = Router();
  router.post('/register', registerLimiter, register);
  router.post('/login', loginLimiter, login);
  router.post('/logout', requireAuth, logout);
  export default router;

  export const meRouter = Router();
  meRouter.get('/me', requireAuth, me);
  ```

- [x] **11. Create `backend/src/app.ts`**
  - `express()`, `express.json()`, `cookieParser()`.
  - Mount `authRouter` at `/auth`, `meRouter` at `/`.
  - Global error handler: reads `err.code` from error-codes registry → looks up `http`
    status → `res.status(http).json({ error: { code } })`. Unknown errors → `500`.
  - Export `app`.

- [x] **12. Create `backend/src/index.ts`**
  - `app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'SERVER_STARTED'))`.
  - Add `scripts.start` and `scripts.dev` to `backend/package.json` pointing at this file.

- [x] **13. Wire `traceId` on requests**
  - Add per-request `traceId` middleware in `app.ts`: `req.traceId = randomUUID()`.
  - Extend the Express `Request` type accordingly.

- [x] **14. Tests — negative and positive cases**
  - Confirm the Cucumber step definitions for `@auth` scenarios are wired (the acceptance
    runner should already have a world and HTTP client from foundations/F03 CI setup).
  - If step definitions are missing, create them in `tests/step-definitions/auth.ts`
    covering the three scenarios. The step definitions use `fetch` (or `axios`) against
    `http://localhost:${PORT}`.

- [x] **15. Run Verification command and confirm all three scenarios green.**

## Definition of done
- `POST /auth/register` with 9-char password returns `422 PASSWORD_TOO_SHORT`; with 10+
  chars returns `201`, sets a session cookie, and `GET /me` returns the user (AC-1).
- `POST /auth/register` with a duplicate email (case-insensitive) returns `409 EMAIL_TAKEN`
  and no second user row exists (AC-2).
- `POST /auth/login` with wrong password returns `401 INVALID_CREDENTIALS` and no cookie;
  with correct credentials returns `200` and a working session cookie (AC-3).
- `POST /auth/logout` with a valid session returns `204` and the cookie is cleared; the
  session row has `revoked_at` set.
- `GET /me` with a valid session returns `200 { user }` containing `id`, `email`, `role`,
  `locale` — never `password_hash`.
- No password, token, or secret appears in any log line (grep `password_hash` and `google_sub`
  in log output — must be zero matches).
- `npm run test:acceptance -- --tags "@AC-1 or @AC-2 or @AC-3"` exits 0.

## Verification
```bash
npm run test:acceptance -- --tags "@AC-1 or @AC-2 or @AC-3"
```

Expected output: three scenarios pass, zero failures, zero pending.

Then confirm no secrets leak in logs:
```bash
docker compose logs api | grep -E "password_hash|google_sub|session.*id"
# Must print nothing
```

## Notes

Done 2026-07-30. All three scenarios green: `3 scenarios (3 passed), 26 steps (26 passed)`.

**What exists now**
- `backend/src/lib/session.ts` — `generateToken()` (32 random bytes → 64-hex), `sessionExpiry()`,
  `issueCookie()`, `revokeCookie()`, `SESSION_COOKIE = 'session'`. Cookie `secure` follows
  `config.NODE_ENV === 'production'`; `maxAge` is in **ms** (Express), 7 days.
- `backend/src/lib/api-error.ts` — `ApiError(code)` + `httpStatusFor(code)`. The app error
  handler maps `.code` → registry `http` → `{ error: { code } }`. Unknown → 500 `INTERNAL_ERROR`.
- `backend/modules/auth/` — `rate-limit.ts` (one shared `ioredis` client, exported `redis`;
  sliding-window sorted-set limiters `registerLimiter` 3/hr, `loginLimiter` 5/min),
  `middleware.ts` (`requireAuth`, checks BOTH `revoked_at IS NULL` and `expires_at > now()`,
  slides expiry, attaches `req.user`), `register.ts`, `login.ts`, `logout.ts`, `me.ts`,
  `user-view.ts` (`publicUser` → `{ id, email, role, locale }`), `router.ts`.
- `backend/src/app.ts` — express.json, cookie-parser, per-request `req.traceId`, `/healthz`,
  mounts auth at `/auth` and me at `/`, error handler last.
- `backend/src/index.ts` — `app.listen(config.API_PORT)` → `SERVER_STARTED`.

**Deviations from the plan (all justified by reality; REFERENCE said "trust the code")**
- Task said `config.PORT`; env exposes **`API_PORT`**. Used `config.API_PORT`.
- Task said `createLogger('auth')`; `logger.ts` exports a **singleton `logger`**, not a factory.
  Imported the singleton directly.
- `Session.id` has `@default(cuid())` in schema; we pass an explicit `id: token` on create so
  the opaque cookie token *is* the row id. REFERENCE's "session token = cookie" holds.
- Added `/healthz` (not in the step list) because `compose.yaml`'s `api` healthcheck curls it —
  without it the container never goes healthy.
- `me` returns `{ id, email, role, locale }` per this task. REFERENCE lists a richer user shape
  (`emailVerifiedAt`, `onboardingCompletedAt`, `interviewCount`); **A03/A06 extend `/me`** when
  first-run routing needs those. Left minimal to stay in scope.

**Test harness (first ATDD wiring for the whole repo — EXECUTE §7)**
- `backend/cucumber.js` — loads `.ts` via `tsx/cjs`; `paths: ['../.agents/features/auth.feature']`;
  default `tags: 'not @wip'`. **`@AC-N` tags are NOT globally unique** (auth, question_generation,
  voice_session all carry `@AC-1`), so paths are scoped per-ledger, not tag-only.
- `backend/tests/support/` — `setup.ts` (fills required env keys via `??=` so `config` validates;
  real env wins), `harness.ts` (boots `app` on an ephemeral port, `migrate deploy` in BeforeAll,
  truncates `sessions,email_tokens,users` + drops `ratelimit:*` between scenarios), `world.ts`
  (fetch client + manual session-cookie jar), `hooks.ts`.
- `backend/tests/step-definitions/auth.ts` — steps for AC-1/2/3 only.
- Ran red first (removed the `PASSWORD_TOO_SHORT` guard → AC-1 failed on the 422 assertion),
  then green.
- **CI**: added Postgres + Redis services, `DATABASE_URL/SHADOW/REDIS_URL` env, and a
  `prisma migrate deploy` step to the `acceptance` job in `.github/workflows/ci.yml` (it
  previously passed on 0 scenarios). `test:unit` still has `--passWithNoTests` — untouched, no
  vitest test was added this task.

**Env/infra gotcha (local only)**: a Homebrew Postgres owns `127.0.0.1:5432` and shadows the
Docker container. For local runs I remapped the Docker db/cache to host `5433/6380` via an
uncommitted `$TMPDIR/compose.localports.yaml` and ran with
`DATABASE_URL=…@localhost:5433 REDIS_URL=redis://localhost:6380`. CI is unaffected (clean
services on 5432/6379). The committed `compose.dev.yaml` still publishes 5432/6379.

**For A02**: extend `modules/auth/router.ts` at the marked comment line for the Google routes.
Reuse the exported `redis` client from `rate-limit.ts` for PKCE state (do **not** open a second
connection) and the session helpers in `src/lib/session.ts` (`generateToken`/`issueCookie`).
The admin-restriction second check belongs in the session-issuance path per REFERENCE. When you
implement AC-5, **remove the `@wip` tag** from that scenario in `.agents/features/auth.feature`
and add its Google step definitions so it joins the green suite.
