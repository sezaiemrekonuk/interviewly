# Auth — REFERENCE (read this once, then you don't need to spelunk)

Single orientation doc for any agent executing a task in this ledger. This file reflects
the project layout **as it will exist after foundations tasks F01, F02, F03 are done**. If
a path listed here does not exist, foundations has not landed — check STATE.md blockers
before proceeding. Verified against foundations task files as of 2026-07-30. If reality
diverges, trust the code and patch this file.

## Services, ports, roles

| Service | Package | Port (internal) | DB role | Trust |
|---|---|---|---|---|
| `api` | `backend/` | 3001 | reads/writes all tables | trusted internal; Caddy terminates TLS |
| `db` | Postgres (compose) | 5432 | persistence | not published on host (K14) |
| `cache` | Redis (compose) | 6379 | sessions rate-limit counters, BullMQ | not published on host |
| `web` | `frontend/` | 3000 | none | public via Caddy |
| `edge` | Caddy | 443 (host) | none | single published port (F03) |

The auth module runs inside `api`. The browser calls Caddy → Caddy proxies `/api/*` to
`api:3001`.

## Commands

```bash
# Start all services (from repo root)
docker compose up -d

# Backend development (from backend/)
npm install
npm run dev              # ts-node-dev or tsx watch

# Run migrations
cd backend && npx prisma migrate deploy

# Seed demo data
cd backend && npm run seed

# Run auth acceptance tests
npm run test:acceptance -- --tags "@AC-1 or @AC-2 or @AC-3"   # A01 scope
npm run test:acceptance -- --tags "@AC-4 or @AC-5"             # A02 scope

# Run all auth acceptance tests
npm run test:acceptance -- --tags "@auth or @admin-auth"

# Frontend component tests (set up by A03)
npm run -w frontend test -- --testPathPattern="(sign-in|register)"

# Playwright smoke (set up by A03)
npx playwright test tests/smoke/auth.spec.ts
```

## HTTP contracts (auth surface)

All responses use envelope `{ "error": { "code": "…" } }` for errors.
`user` shape: `{ id, email, role, locale }` — never `password_hash`, never `google_sub`.

| Method + Path | Auth required | Success | Error codes |
|---|---|---|---|
| `POST /auth/register` | — | 201, cookie set, `{ user }` | `PASSWORD_TOO_SHORT`, `EMAIL_TAKEN`, `VALIDATION_ERROR`, `RATE_LIMITED` |
| `POST /auth/login` | — | 200, cookie set, `{ user }` | `INVALID_CREDENTIALS`, `VALIDATION_ERROR`, `RATE_LIMITED` |
| `POST /auth/logout` | `requireAuth` | 204, cookie cleared | `UNAUTHENTICATED` |
| `GET /auth/google` | — | 302 → Google OAuth | — |
| `GET /auth/google/callback` | — | 302 → app (session set) | `ADMIN_MUST_USE_PASSWORD`, `ACCOUNT_LINK_REQUIRES_PASSWORD`, `OAUTH_STATE_MISMATCH` |
| `GET /me` | `requireAuth` | 200, `{ user }` | `UNAUTHENTICATED` |

Session cookie: name `session`, `httpOnly`, `Secure`, `SameSite=Lax`, `Max-Age=604800`
(7 days). Cleared on logout by setting `Max-Age=0`.

## Key code anchors

All paths are relative to repo root. They will exist once the named task lands.

| Path | Task | What it does |
|---|---|---|
| `backend/src/lib/error-codes.ts` | F01 | Error-code registry. Append new codes here via `UPDATE todos`-style step |
| `backend/src/lib/db.ts` | F02 | Prisma singleton, `userInterviews()`, `activeInterview()` |
| `backend/src/lib/logger.ts` | F03 | Pino factory: `logger.<level>({obj}, "EVENT_NAME")` |
| `backend/src/lib/env.ts` | F03 | Zod env config; `config` export has typed env vars |
| `backend/src/lib/session.ts` | A01 | `generateToken()`, `issueCookie(res, token)`, `revokeCookie(res)` |
| `backend/src/app.ts` | A01 | Express app, global middleware, router mounts |
| `backend/src/index.ts` | A01 | `app.listen(config.PORT)` entry point |
| `backend/modules/auth/router.ts` | A01 | Mounts register, login, logout, me; extended by A02 for google routes |
| `backend/modules/auth/middleware.ts` | A01 | `requireAuth`: reads session cookie → sessions row → attaches `req.user` |
| `backend/modules/auth/rate-limit.ts` | A01 | Redis sliding windows; exports `registerLimiter`, `loginLimiter` |
| `backend/modules/auth/register.ts` | A01 | `POST /auth/register` handler |
| `backend/modules/auth/login.ts` | A01 | `POST /auth/login` handler |
| `backend/modules/auth/logout.ts` | A01 | `POST /auth/logout` handler |
| `backend/modules/auth/me.ts` | A01 | `GET /me` handler |
| `backend/modules/auth/google.ts` | A02 | `GET /auth/google` + callback; `arctic` PKCE flow |
| `frontend/app/(auth)/sign-in/page.tsx` | A03 | Login form + Google button |
| `frontend/app/(auth)/register/page.tsx` | A03 | Register form + Google button |
| `frontend/app/(auth)/layout.tsx` | A03 | Unauthenticated shell (no nav) |
| `tests/smoke/auth.spec.ts` | A03 | Playwright smoke: happy-path sign-in + register |

## Schema (tables this ledger reads/writes)

Owned by F02. Auth reads and writes only these two:

```
users
  id            String   @id (cuid)
  email_lower   String   @unique
  password_hash String?
  google_sub    String?  @unique
  role          Role     @default(user)
  locale        String   @default("en")
  created_at    DateTime @default(now())

sessions
  id         String    @id (cuid) ← the opaque token stored in the cookie
  user_id    String    FK → users.id RESTRICT
  expires_at DateTime
  revoked_at DateTime?
  created_at DateTime  @default(now())
```

**Session lookup:** `prisma.session.findUnique({ where: { id: token } })` then check
`revoked_at IS NULL AND expires_at > now()`. Always verify both conditions.

## Conventions

**Error codes** are imported from `backend/src/lib/error-codes.ts`, never inlined as
strings. All auth error codes are already in the F01 registry (PASSWORD_TOO_SHORT,
EMAIL_TAKEN, INVALID_CREDENTIALS, UNAUTHENTICATED, ADMIN_MUST_USE_PASSWORD,
ACCOUNT_LINK_REQUIRES_PASSWORD, OAUTH_STATE_MISMATCH, VALIDATION_ERROR, RATE_LIMITED).
If a new code is needed, add it to the registry file as part of the task steps.

**Log shape**: `logger.info({ userId, traceId }, "AUTH_LOGIN_OK")` — structured object
first, event name second. No display strings. Auth events to emit: `AUTH_REGISTERED`,
`AUTH_LOGIN_OK`, `AUTH_LOGIN_FAILED`, `AUTH_GOOGLE_LINKED`, `AUTH_ADMIN_GOOGLE_BLOCKED`,
`AUTH_LOGOUT`. Never log `password_hash`, tokens, or `google_sub`.

**Validation**: Zod at every trust boundary (`POST /auth/register` body, `/auth/login`
body, Google callback `?code&state` query params). Return `VALIDATION_ERROR` (422) for
any body that fails Zod.

**Rate limiting**: Redis sliding-window counters keyed by IP. Register: 3 req/hr.
Login: 5 req/min. Use the `config.REDIS_URL` from `env.ts`; do not open a separate
connection — reuse the single Redis client.

**Admin restriction** is checked in two places (K8, backend spec §8):
1. In `GET /auth/google/callback` — before any session row is inserted.
2. In the session-issuance helper — so a future code path cannot accidentally bypass it.
Both checks must be present; a single check is insufficient by spec.

**Cookie attributes**: `httpOnly: true`, `secure: process.env.NODE_ENV === 'production'`
(allow plain HTTP in dev; Compose dev profile uses HTTP), `sameSite: 'lax'`,
`maxAge: 7 * 24 * 60 * 60` (seconds).

**Migration rule** (ADR-F02): no structural schema change in this ledger. A new index
(e.g. `sessions(user_id)`) is authored as a new Prisma migration file
(`backend/prisma/migrations/<timestamp>_sessions_user_id_idx/`), rebased on top of the
F02 migration before merge. Never edit an existing migration SQL file.
