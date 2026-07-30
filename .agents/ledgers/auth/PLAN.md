# Auth — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-A entry referenced here.
Codebase orientation: `REFERENCE.md` (read that before touching any task).

## Goal

When this ships, an unauthenticated visitor can register with email and password or sign in
with Google, receive a server-issued session cookie, and be recognised on every subsequent
request. The admin-only password restriction, the Google account-linking trust boundary (K8.5
`email_verified` rule), and the opaque session revocation model are all enforced and covered
by acceptance scenarios. `docker compose up` → register → `GET /me` → valid user is the
observable end-to-end result.

## The invariant this initiative must not weaken

> The API is the sole owner of identity. A session cookie is never issued without a verified
> credential path; an admin account is never accessible via Google. (K8, K8.5)

Authentication is a security invariant. A regression here is not a feature gap — it is a
scope-stop. This ledger touches only `backend/modules/auth/`, a thin shared session helper in
`backend/src/lib/`, and `frontend/app/(auth)/`. It deliberately does not touch the interview
state machine, admin endpoints, the report pipeline, or any module that auth middleware
calls into.

## Topology

```
Browser
  │
  │  POST /auth/register    POST /auth/login    POST /auth/logout
  │  GET  /me               GET  /auth/google   GET  /auth/google/callback
  ▼
edge/ (Caddy — single published port, F03)
  │
  ▼
backend/src/app.ts           ← Express app; mounts modules/auth/router.ts (created A01)
  │
  ├── modules/auth/
  │     router.ts            ← binds all handlers to /auth/* and /me
  │     register.ts          ← argon2id hash, INSERT users + sessions, set cookie
  │     login.ts             ← argon2id verify, INSERT sessions, set cookie
  │     logout.ts            ← sessions.revoked_at = now(), clear cookie
  │     me.ts                ← GET /me behind requireAuth
  │     middleware.ts        ← requireAuth: cookie → sessions row → user
  │     rate-limit.ts        ← Redis sliding windows: 5/min sign-in, 3/hr register
  │     google.ts            ← arctic PKCE: /auth/google + /auth/google/callback (A02)
  │
  ├── src/lib/
  │     db.ts                ← Prisma singleton + userInterviews/activeInterview (F02)
  │     error-codes.ts       ← shared registry (F01)
  │     logger.ts            ← pino factory (F03)
  │     env.ts               ← Zod env schema (F03)
  │     session.ts           ← NEW (A01): generateToken(), issueCookie(), revokeCookie()
  │
  ├── Postgres               ← users + sessions tables (F02 schema)
  └── Redis                  ← rate-limit counters, PKCE state/verifier (F03 cache)

frontend/app/(auth)/
  sign-in/page.tsx           ← login form + Google button (A03)
  register/page.tsx          ← register form + Google button (A03)
  layout.tsx                 ← unauthenticated shell (A03)
```

## Decision table (full ADRs in DECISIONS.md)

| # | Decision | Chosen | Reason |
|---|----------|--------|--------|
| ADR-A01 | Session model | DB-backed opaque token, 7-day sliding, `SameSite=Lax` | K8 cut JWT refresh families; opaque token + `revoked_at` is simpler and server-revocable without key rotation |
| ADR-A02 | Google OAuth library | `arctic` (Authorization Code + PKCE) | IDEA.md K8 names arctic; passport.js adds a parallel user model and abstracts away PKCE steps that the spec needs to assert on |
| ADR-A03 | Password hashing | `@node-rs/argon2` (argon2id) | K8 names it explicitly; pre-built musl binaries eliminate `python3`/`make`/`g++` on Alpine, which contradicts the same reasoning that chose `unpdf` (K12) |

## Data model additions

No structural changes. This ledger **consumes** the `users` and `sessions` tables from F02.

| Table | Auth reads | Auth writes |
|---|---|---|
| `users` | `id`, `email_lower`, `password_hash`, `google_sub`, `role`, `locale` | `INSERT` on register; `UPDATE google_sub` on Google link |
| `sessions` | `id`, `user_id`, `expires_at`, `revoked_at` | `INSERT` on sign-in; `UPDATE revoked_at` on logout; `UPDATE expires_at` on sliding renewal |

Deferred to backlog: `sessions(user_id)` index for "revoke all sessions for a user" — no
current scenario requires it and adding it is a safe nullable-column-equivalent migration when
the trigger fires.

## Phasing / task clusters (see STATE.md ledger)

0. Backend auth core (A01) — register, login, logout, session middleware, `/me`
1. Google OAuth + admin restriction (A02) — full callback flow, account linking
2. Frontend auth forms (A03) — login/register screens, error display, Google button

All three tasks form a linear chain: A01 → A02 → A03.

## Out of scope (post-auth)

- Email verification, password reset — explicitly out of scope per K8.5.
- Profile screen, locale switcher, dashboard — `frontend` ledger.
- `/admin/*` endpoints and admin UI — `admin` ledger.
- Rate-limit Cucumber scenarios (`rate_limits.feature`, backend AC-12/AC-13) — those
  scenarios cover interview-start limits alongside auth limits; the `interview-core` ledger
  owns the `rate_limits.feature` green run. Auth implements the rate-limit middleware; it
  does not own the feature file.
- The `sessions(user_id)` bulk-revocation index — backlog.
- Webhook authentication (HMAC + timestamp window) — `voice` ledger (§3.5).

**The entire schema lives in F02. This ledger may add indexes and nullable columns only,
each in its own migration, rebased before merge. Any structural change is a change to
F02's scope and gets discussed, not merged.**
