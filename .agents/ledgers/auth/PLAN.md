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
  │     tokens.ts            ← NEW (A04): mint/consume email_tokens, sha256 storage (K8.6)
  │     verify-email.ts      ← NEW (A04): request + confirm handlers, resend cooldown
  │     password-reset.ts    ← NEW (A05): request + confirm, revoke-all-sessions
  │
  ├── worker/src/jobs/
  │     email-send.ts        ← NEW (A04): BullMQ `email.send` consumer, nodemailer → SMTP
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
  sign-in/page.tsx           ← login form + Google button + forgot-password link (A03)
  register/page.tsx          ← register form + Google button (A03)
  verify-email/page.tsx      ← pending state, resend countdown (A04)
  verify-email/[token]/      ← confirm-on-mount (A04)
  forgot-password/page.tsx   ← request form, enumeration-safe copy (A05)
  reset-password/[token]/    ← new-password form (A05)
  layout.tsx                 ← unauthenticated shell, gradient ground (A03)
```

## Decision table (full ADRs in DECISIONS.md)

| # | Decision | Chosen | Reason |
|---|----------|--------|--------|
| ADR-A01 | Session model | DB-backed opaque token, 7-day sliding, `SameSite=Lax` | K8 cut JWT refresh families; opaque token + `revoked_at` is simpler and server-revocable without key rotation |
| ADR-A02 | Google OAuth library | `arctic` (Authorization Code + PKCE) | IDEA.md K8 names arctic; passport.js adds a parallel user model and abstracts away PKCE steps that the spec needs to assert on |
| ADR-A03 | Password hashing | `@node-rs/argon2` (argon2id) | K8 names it explicitly; pre-built musl binaries eliminate `python3`/`make`/`g++` on Alpine, which contradicts the same reasoning that chose `unpdf` (K12) |
| ADR-A04 | Verification + reset token storage | One `email_tokens` table, two `kind`s, **sha256 hash only**, single-use via guarded update | K8.6. One mechanism, one table. A stored token is a stored credential; a dump must yield nothing usable, and a double-clicked link must verify once |
| ADR-A05 | Where verification is enforced | A single gate on `POST /interviews`, read from `EMAIL_VERIFICATION_REQUIRED` (ships `false`) | K8.6. Gating sign-in would make `SETUP.md` depend on reading a mailbox — a scored item traded for a feature the brief never asked for. One gate is also one place to test |
| ADR-A06 | Mail delivery path | BullMQ `email.send` job consumed by `worker` (nodemailer → SMTP) | K10/K8.6. The API never waits on SMTP; a mail outage becomes a retried job instead of a failed registration |

## Data model additions

No structural changes. This ledger **consumes** the `users` and `sessions` tables from F02.

| Table | Auth reads | Auth writes |
|---|---|---|
| `users` | `id`, `email_lower`, `password_hash`, `google_sub`, `role`, `locale` | `INSERT` on register; `UPDATE google_sub` on Google link |
| `sessions` | `id`, `user_id`, `expires_at`, `revoked_at` | `INSERT` on sign-in; `UPDATE revoked_at` on logout; **`UPDATE revoked_at` on every session of the user on reset (A05)** |
| `email_tokens` | `id`, `user_id`, `kind`, `token_hash`, `expires_at`, `consumed_at` | `INSERT` on mint (A04/A05); guarded `UPDATE consumed_at` on confirm |
| `users` | + `email_verified_at` | `UPDATE email_verified_at` on verification, on a Google `email_verified: true` sign-in, and on a completed reset |

**`sessions(user_id)` is now required, not backlog.** A05's reset revokes every session of a
user, which is a `user_id` lookup on the hot path of a security action. It is an index-only
migration owned by this ledger (§5.2 permits indexes).

## Phasing / task clusters (see STATE.md ledger)

0. Backend auth core (A01) — register, login, logout, session middleware, `/me`
1. Google OAuth + admin restriction (A02) — full callback flow, account linking
2. Frontend auth forms (A03) — sign-in/register screens, error display, Google button
3. Email verification (A04) — `email_tokens`, mint/consume, resend cooldown, the
   `email.send` worker job, the one enforcement gate, and the two verification screens
4. Password reset (A05) — request/confirm, revoke-all-sessions, the two reset screens
5. Onboarding profile (A06) — `users.profile` API, the three cards, CV upload, first-run routing

A01 → A02 → A03, then two independent lines: A04 → A05, and A06. A04–A06 are **bonus-band** (§12):
if the deadline squeezes, they are cut before anything mandatory, and cutting them leaves A01–A03
green and unchanged.

**Why onboarding lives here and not in its own ledger.** It is account state — `users.profile`,
`users.cv_upload_id`, `users.onboarding_completed_at` — and the routing rule that consumes it fires
on sign-in success, which is this ledger's surface. A separate ledger would duplicate this one's
`REFERENCE.md`, `MODELS.md` and execution protocol to own two tasks against the same table.

## Out of scope (post-auth)

- The `candidate_profile` **merge and snapshot** at `POST /interviews/:id/profile`, and the
  Jotform-shaped setup screen that hosts the per-interview pre-questions — `interview-core`. A06
  supplies the account profile; it never writes to `interviews`.
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
