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

# Run auth acceptance tests. The auth ring has its own cucumber PROFILE (ADR-A09) — the
# bare `cucumber-js` / `npm run test:acceptance` runs interview-core's rings, not these.
npx cucumber-js -p auth                                  # the whole auth ring
npx cucumber-js -p auth --tags "@AC-1 or @AC-2 or @AC-3" # A01 scope
npx cucumber-js -p auth --tags "@AC-4 or @AC-5"          # A02 scope
npx cucumber-js -p auth --tags "@AC-21 or @AC-22 or @AC-23 or @AC-24"  # A04 scope

# Frontend component tests (set up by A03)
npm run -w frontend test -- --testPathPattern="(sign-in|register)"

# Playwright smoke (set up by A03)
npx playwright test tests/smoke/auth.spec.ts
```

## HTTP contracts (auth surface)

All responses use envelope `{ "error": { "code": "…" } }` for errors.
`user` shape: `{ id, email, role, locale, emailVerifiedAt, onboardingCompletedAt,
interviewCount }` — never `password_hash`, never `google_sub`, never a token. The last three
fields exist so first-run routing is one server answer (K8.7).

| Method + Path | Auth required | Success | Error codes |
|---|---|---|---|
| `POST /auth/register` | — | 201, cookie set, `{ user }` | `PASSWORD_TOO_SHORT`, `EMAIL_TAKEN`, `VALIDATION_ERROR`, `RATE_LIMITED` |
| `POST /auth/login` | — | 200, cookie set, `{ user }` | `INVALID_CREDENTIALS`, `VALIDATION_ERROR`, `RATE_LIMITED` |
| `POST /auth/logout` | `requireAuth` | 204, cookie cleared | `UNAUTHENTICATED` |
| `GET /auth/google` | — | 302 → Google OAuth | `NOT_READY` (no client credentials configured) |
| `GET /auth/google/callback` | — | 302 → `/dashboard` (session set) | `OAUTH_STATE_MISMATCH` (400 JSON); `ADMIN_MUST_USE_PASSWORD` / `ACCOUNT_LINK_REQUIRES_PASSWORD` as `302 → /sign-in?error=<CODE>` |
| `GET /me` | `requireAuth` | 200, `{ user }` | `UNAUTHENTICATED` |
| `POST /auth/verify-email/request` (A04) | `requireAuth` | 202, `{ cooldownSeconds }` | `EMAIL_RESEND_COOLDOWN`, `RATE_LIMITED`, `UNAUTHENTICATED` |
| `POST /auth/verify-email/confirm` (A04) | — | 200, `{ user }` | `EMAIL_TOKEN_INVALID`, `EMAIL_TOKEN_EXPIRED`, `VALIDATION_ERROR` |
| `POST /auth/password-reset/request` (A05) | — | **always** 202, empty body | `RATE_LIMITED`, `VALIDATION_ERROR` |
| `POST /auth/password-reset/confirm` (A05) | — | 200, `{}` | `EMAIL_TOKEN_INVALID`, `EMAIL_TOKEN_EXPIRED`, `PASSWORD_TOO_SHORT`, `VALIDATION_ERROR` |
| `GET /me/profile` (A06) | `requireAuth` | 200, `{ profile, onboardingCompletedAt, cvUploadId }` | `UNAUTHENTICATED` |
| `PATCH /me/profile` (A06) | `requireAuth` | 200, `{ profile }` | `VALIDATION_ERROR`, `RATE_LIMITED`, `UNAUTHENTICATED` |
| `POST /me/profile/complete` (A06) | `requireAuth` | 200, `{ onboardingCompletedAt }` | `UNAUTHENTICATED` |

`POST /auth/password-reset/request` answers identically for a registered, a Google-only and an
unknown address — status, body and headers (K8.6, no enumeration). Its rate limit is keyed by **IP**,
because a per-user limiter would leak existence through its own 429.

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
| `backend/src/lib/session.ts` | A01, A02 | `generateToken()`, `issueCookie(res, token)`, `revokeCookie(res)`, `issueSessionForUser(user, res, source)` — the only place a `sessions` row is created, and the second K8 admin check |
| `backend/src/app.ts` | A01 | Express app, global middleware, router mounts |
| `backend/src/index.ts` | A01 | `app.listen(config.PORT)` entry point |
| `backend/modules/auth/router.ts` | A01 | Mounts register, login, logout, me; extended by A02 for google routes |
| `backend/modules/auth/middleware.ts` | A01 | `requireAuth`: reads session cookie → sessions row → attaches `req.user` |
| `backend/modules/auth/rate-limit.ts` | A01 | Redis sliding windows; exports `registerLimiter`, `loginLimiter` |
| `backend/modules/auth/register.ts` | A01 | `POST /auth/register` handler |
| `backend/modules/auth/login.ts` | A01 | `POST /auth/login` handler |
| `backend/modules/auth/logout.ts` | A01 | `POST /auth/logout` handler |
| `backend/modules/auth/me.ts` | A01 | `GET /me` handler |
| `backend/modules/auth/google.ts` | A02 | `GET /auth/google` + callback; `arctic` PKCE flow. `resolveGoogleIdentity()` is the shared trust boundary (admin check, link rule, create) |
| `backend/modules/auth/test-seam.ts` | A02 | `POST /test/auth/simulate-google-callback`, mounted **only** under `NODE_ENV=test`; `mountTestSeam()` throws at startup anywhere else |
| `frontend/app/(auth)/sign-in/page.tsx` | A03 | Login form + Google button + forgot-password link |
| `frontend/app/(auth)/register/page.tsx` | A03 | Register form + Google button |
| `frontend/app/(auth)/layout.tsx` | A03 | Unauthenticated shell (no nav), gradient ground |
| `tests/smoke/auth.spec.ts` | A03 | Playwright smoke: happy-path sign-in + register |
| `backend/modules/auth/tokens.ts` | A04 | `mintEmailToken`/`consumeEmailToken` — sha256 storage, guarded consume. The **only** code touching `email_tokens`. A05's `reset` kind already works |
| `backend/modules/auth/verify-email.ts` | A04 | Request + confirm handlers, resend cooldown, and `requireVerifiedEmail` — the gate middleware **I03 mounts on `POST /interviews`** |
| `backend/modules/auth/mail-queue.ts` | A04 | `EmailQueue` seam + lazy BullMQ producer; `enqueueEmail` never fails its caller (ADR-A10) |
| `worker/src/index.ts` | A04 | The worker process. R01 adds the report queue beside the mail one |
| `worker/src/jobs/email-send.ts` | A04 | BullMQ `email.send` consumer (nodemailer → SMTP); both templates |
| `backend/tests/support/{harness,world,hooks,setup,log-sink,mail-recorder}.ts` | A01, A04 | The auth acceptance harness: booted app, `AuthWorld`, log capture, queue recorder |
| `backend/modules/auth/password-reset.ts` | A05 | Request (enumeration-safe) + confirm (revoke-all-sessions) |
| `backend/modules/auth/profile.ts` | A06 | `GET/PATCH /me/profile`, `POST /me/profile/complete`; per-step Zod |
| `frontend/src/lib/first-run.ts` | A06 | The K8.7 routing rule, called by every sign-in success path |
| `frontend/app/(auth)/verify-email/…` | A04 | Pending state + resend countdown; confirm-on-mount |
| `frontend/app/(auth)/forgot-password/…`, `reset-password/[token]/…` | A05 | The two reset screens |
| `frontend/app/(onboarding)/onboarding/[step]/page.tsx` | A06 | The three cards, per-card save, server-driven resume |

## Schema (tables this ledger reads/writes)

Owned by F02. Auth reads and writes these three (plus `uploads.kind` for the A06 CV path):

```
users
  id                      String   @id (cuid)
  email_lower             String   @unique
  password_hash           String?
  google_sub              String?  @unique
  role                    Role     @default(user)
  locale                  String   @default("en")
  email_verified_at       DateTime?          ← A04/A05 write; K8.6
  profile                 Json?              ← A06 writes; §3.3 layer 1, partial is normal
  cv_upload_id            String?            ← A06 writes; FK → uploads.id RESTRICT
  onboarding_completed_at DateTime?          ← A06 writes; K8.7
  created_at              DateTime @default(now())

sessions
  id         String    @id (cuid) ← the opaque token stored in the cookie
  user_id    String    FK → users.id RESTRICT
  expires_at DateTime
  revoked_at DateTime?             ← A05 sets this on EVERY row of the user
  created_at DateTime  @default(now())

email_tokens                       ← A04/A05 only, through modules/auth/tokens.ts
  id          String    @id (cuid)
  user_id     String    FK → users.id RESTRICT
  kind        EmailTokenKind        ← verify | reset
  token_hash  String    @unique     ← sha256(token). NEVER the token itself
  expires_at  DateTime
  consumed_at DateTime?             ← guarded update; count 0 ⇒ EMAIL_TOKEN_INVALID
  created_at  DateTime  @default(now())
```

**`users.profile` shape** (§3.3): `{ fullName?, jobTitle?, dateOfBirth?, education?: [{ school,
degree, field, graduationYear }] (max 5), hobbies?: string[], interestsText?, cvText? }`.
**`dateOfBirth` never leaves toward `ai` and never enters a log line** — interview-core strips it
when building `candidate_profile`, and the prompt builder drops it again defensively.

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
`AUTH_LOGOUT`. A02 added `AUTH_GOOGLE_STARTED`, `AUTH_GOOGLE_EXCHANGE_FAILED` and the boot
warning `AUTH_GOOGLE_NOT_CONFIGURED`. Never log `password_hash`, tokens, `google_sub`, the
OAuth authorization code, the PKCE verifier, or the token-endpoint response.

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
