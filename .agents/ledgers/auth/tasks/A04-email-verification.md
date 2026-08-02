# A04 — Building email verification: tokens, the mail job, the gate, and the two screens
REPO: (this repo) · Depends: A03 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.6** — a new credential-bearing trust boundary (single-use hashed tokens, a
concurrency-guarded consume, an enumeration-safe surface). Get the token semantics wrong and the
defect is a security defect, not a bug.

## Goal
Owner's ask:

> "Email verification exists (K8.6): the mail is always sent and always prompted, enforcement is
> the `EMAIL_VERIFICATION_REQUIRED` flag on exactly one endpoint, and a clean-machine demo must
> never depend on reading an inbox."
> — IDEA.md K8.6, backend spec §8a, `email_verification.feature`

This task ships: the `email_tokens` mint/consume helper, `POST /auth/verify-email/request`,
`POST /auth/verify-email/confirm`, the `email.send` BullMQ job consumed by `worker`, the single
verification gate on `POST /interviews`, and the two frontend screens (`/verify-email` pending with
a resend countdown, `/verify-email/[token]` confirm-on-mount).

## Non-negotiables
- **Only `sha256(token)` is ever stored.** The plaintext token exists in exactly two places: the
  response to the mint (handed to the mail job) and the link in the mail. It is never written to
  `email_tokens`, never logged, never echoed by an endpoint, never put in a metric label.
- **Consume is a guarded update, not read-then-write.**
  `UPDATE email_tokens SET consumed_at = now() WHERE id = $id AND consumed_at IS NULL` —
  `count === 0` means someone else won and the caller gets `EMAIL_TOKEN_INVALID`. A
  double-clicked link must verify exactly once. Read-then-write is a defect even though it passes
  a single-threaded test.
- **Absent, consumed and expired are three conditions but two codes.** Absent/consumed →
  `EMAIL_TOKEN_INVALID`; expired → `EMAIL_TOKEN_EXPIRED`. Do not add a third code and do not
  collapse expiry into invalid — the user needs to know a new link will help.
- **The gate is one line in one place.** `POST /interviews` checks `email_verified_at` when
  `config.EMAIL_VERIFICATION_REQUIRED` is true → `EMAIL_NOT_VERIFIED` (403). No other endpoint
  gains a check. This is *configuration*, not an environment branch (§11.3) — no `NODE_ENV`
  anywhere near it.
- **The API never opens an SMTP socket.** It enqueues `email.send`; `worker` delivers. A mail
  outage must not fail a registration.
- **Never block registration on the mail.** `POST /auth/register` returns `201` with its session
  cookie whether or not the job has run.

## Context (anchors)
- `backend/prisma/schema.prisma` (:F02) — `EmailToken` model and `EmailTokenKind` already exist.
  **Do not migrate anything structural here** (§5.2).
- `backend/modules/auth/tokens.ts` — **create.** `mintEmailToken(userId, kind)` returns the
  plaintext token and inserts the hash; `consumeEmailToken(token, kind)` hashes, looks up by
  `token_hash`, checks `expires_at`, then does the guarded consume. Both are the *only* code that
  touches `email_tokens`.
- `backend/modules/auth/verify-email.ts` — **create.** The two handlers.
- `backend/modules/auth/register.ts` (:A01) — **edit**: after the session is issued, mint a
  `verify` token and enqueue `email.send`. Keep the response shape unchanged.
- `backend/modules/auth/google.ts` (:A02) — **edit**: on a callback with `email_verified: true`,
  set `email_verified_at` if null (K8.6). One statement; do not restructure the linking logic.
- `backend/modules/auth/rate-limit.ts` (:A01) — **edit**: add the resend window (5/hour/user) and
  the 60 s cooldown key. The cooldown response must carry the remaining seconds.
- `backend/modules/interview/create.ts` (:I03) — **edit**: the one gate. If I03 has not landed,
  A04 stops here and records the gate as pending in `## Notes` rather than inventing the endpoint.
- `worker/src/jobs/email-send.ts` — **create.** BullMQ consumer, `nodemailer` transport from
  `SMTP_*`/`MAIL_FROM` (:F03 env). Renders two templates (verify, reset — A05 reuses this job).
  Retries with backoff; a dead-lettered send is logged, never retried forever.
- `frontend/app/(auth)/verify-email/page.tsx` and `.../verify-email/[token]/page.tsx` —
  **create.** `think` mascot, "check your inbox", what-happens-next copy, resend with a countdown
  driven by the response's `cooldownSeconds`, and — while the flag is off — an explicit
  "continue without verifying" link.
- `.agents/features/email_verification.feature` — the acceptance scenarios. They are written; make
  them green without editing them.

## Steps
- [x] **1. `tokens.ts`** — 32 random bytes (`crypto.randomBytes`), base64url for the link,
  `sha256` hex for storage. TTL from `EMAIL_VERIFY_TTL_HOURS`. Guarded consume as above.
- [x] **2. `POST /auth/verify-email/request`** — authenticated. Cooldown check → mint → enqueue.
  `202 { cooldownSeconds: 60 }`. Idempotent for an already-verified user (still `202`, no mail).
- [x] **3. `POST /auth/verify-email/confirm`** — public (the link works in any browser). Consume,
  set `email_verified_at`, return the user. Already-verified with a fresh valid token is `200`.
- [x] **4. Register hook + Google verified-email hook.**
- [x] **5. `email.send` worker job** with both templates and the `PUBLIC_ORIGIN`-based link.
- [~] **6. The single gate** on `POST /interviews` — **deferred to I03**, which has not landed.
  The middleware exists and is exported (`requireVerifiedEmail`); the endpoint to mount it on
  does not. See `## Notes`.
- [x] **7. The two screens**. The `EMAIL_NOT_VERIFIED` route-back is **deferred with the gate**:
  the interview setup form it routes back from is I03/frontend's, and there is no typed listing
  to preserve until it exists.
- [x] **8. Log events** — `AUTH_VERIFY_TOKEN_ISSUED`, `AUTH_EMAIL_VERIFIED`,
  `AUTH_VERIFY_TOKEN_REJECTED` (`reason`), `AUTH_VERIFICATION_REQUIRED_BLOCK`. Assert via the
  `LogSink` seam that no line carries a token or a hash.

## Definition of done
- `email_verification.feature` is green, including the concurrent-confirm scenario.
- No plaintext token or token hash appears in any log line (LogSink assertion).
- With the flag off, an unverified user completes a whole interview; with it on, only
  `POST /interviews` refuses.
- `docker compose up` → register → the mail is visible in the Mailpit inbox, and no
  `email.send` job is dead-lettered.

## Verification
```bash
npx cucumber-js .agents/features/email_verification.feature
```
All scenarios pass. Then, against a booted default stack:
```bash
# register, then confirm the mail arrived at the sink
curl -s -X POST "$PUBLIC_ORIGIN/api/auth/register" -H 'content-type: application/json' \
  -d '{"email":"a04@example.com","password":"1234567890"}' -o /dev/null -w '%{http_code}\n'
curl -s http://localhost:8025/api/v1/messages | head -c 400
```
Expected: `201`, and one message addressed to `a04@example.com`.

## Notes

**Done 2026-07-31.** Everything in A04's own scope shipped. The one deferral is the gate (step 6),
and it is a missing endpoint, not missing work — details below.

### Verification, verbatim

The command in `## Verification` could not run as written: the root `cucumber.js` I01 authored
loads the interview-core step tree, whose `AiWorld` and `the response status is {int}` collide
with this ledger's `AuthWorld` and its identically-worded step. Two rings, one
`setWorldConstructor` per process — so the auth ring now has its own cucumber profile
(ADR-A04-3) and the command is `npx cucumber-js -p auth`:

```
11 scenarios (11 passed)
88 steps (88 passed)
```

That is `auth.feature` (4) + `admin_auth.feature` (1) + `email_verification.feature` (6 of 8).
The interview-core ring is unaffected: `npx cucumber-js` → `20 scenarios (20 passed)`.

Red-first, on the invariant that matters: replacing the guarded consume with a plain
read-then-write `update` makes @AC-23 fail (`1 failed, 2 skipped, 3 passed`) — both concurrent
confirmations return 200. Restored → green. The single-threaded scenarios pass either way, which
is exactly why the race scenario exists.

Booted-stack half, against real BullMQ, real nodemailer and the Mailpit sink (see the caveat
below for why the processes were run directly rather than through `docker compose`):

```
POST /auth/register                       201
GET  http://localhost:8025/api/v1/messages  1 message → a04@example.com,
                                          "Confirm your Interviewly address",
                                          link http://localhost:8081/verify-email/<token>
POST /auth/verify-email/confirm <token>   200 {"user":{…,"emailVerifiedAt":"2026-07-31T12:22:37.630Z"}}
POST /auth/verify-email/confirm <token>   400 {"error":{"code":"EMAIL_TOKEN_INVALID"}}
worker log                                EMAIL_SENT ×1, EMAIL_DEAD_LETTERED ×0
```

Secret-leak grep over both process logs for that run's plaintext token, any 64-hex string and the
recipient address: 0 hits in each.

Gates: `npm run typecheck` clean, `npm run lint` clean, `npm test` → 11 files / 77 tests passed
(30 of them frontend, including this task's 7 new component tests).

### What was deferred, and why

**The gate (step 6) is deferred to I03.** `POST /interviews` does not exist — interview-core I03 is
`todo` — so there is nothing to mount on. What exists instead:

- `requireVerifiedEmail` in `backend/modules/auth/verify-email.ts` — the whole gate, reading
  `config.EMAIL_VERIFICATION_REQUIRED`, emitting `AUTH_VERIFICATION_REQUIRED_BLOCK`, throwing
  `EMAIL_NOT_VERIFIED`. **I03 mounts it on `POST /interviews` and nowhere else.**
- The two @AC-29 scenarios are excluded by the `auth` profile's tag expression
  (`not @wip and not @AC-29`), with the reason written at the exclusion. **I03 deletes
  `and not @AC-29` from `cucumber.js` when it mounts the middleware** — no other change needed,
  and no step definitions were stubbed for an endpoint this ledger does not own.

**The `EMAIL_NOT_VERIFIED` route-back (part of step 7) goes with it.** It routes back *from* the
interview setup form, which is I03/frontend's screen; there is no typed listing to preserve yet.

### Decisions worth carrying

- **TTL: 24 hours**, from `EMAIL_VERIFY_TTL_HOURS` (unchanged F03 default). Reset stays at
  `PASSWORD_RESET_TTL_MINUTES` = 60 for A05.
- **Token: 32 random bytes, base64url** (43 chars) for the link; **sha256 hex** in the table.
- **Two 429s, two codes.** `EMAIL_RESEND_COOLDOWN` carries `cooldownSeconds`; `RATE_LIMITED` does
  not. The cooldown is claimed with `SET NX EX 60` and the hourly budget (5/hour) is only charged
  *after* the cooldown passes, so a client retrying in a loop cannot lock itself out for an hour
  without a single mail having been sent.
- **Both resend limits are keyed by user, not IP** — unlike register/login. The endpoint is
  authenticated, and an IP key would let one account exhaust a shared NAT's budget.
- **`publicUser` gained `emailVerifiedAt`**, so the client renders the prompt from one server
  answer. A06 adds `onboardingCompletedAt` and `interviewCount`.

### Hand-off to A05

`backend/modules/auth/tokens.ts` and the `email.send` job are **shared, and already carry the
reset path**: `mintEmailToken(userId, 'reset')` and `consumeEmailToken(token, 'reset')` work as
written, and `worker/src/jobs/email-send.ts` already has the `reset` template and builds its link
as `${PUBLIC_ORIGIN}/reset-password/<token>`. A05 writes handlers and screens, not plumbing.

Note for A05's enumeration-safe request: `mintEmailToken` is the only place that touches
`email_tokens`, so "always 202" is a matter of not branching in the handler — the token layer
already answers identically for every user id it is handed.

### Two defects found and fixed outside this task's file list

1. **The auth acceptance ring was dead on master.** I01's root `cucumber.js` replaced A01's
   `backend/cucumber.js` without carrying the auth wiring across, and I01 also dropped backend's
   `test:acceptance` script — so `backend/tests/` had been orphaned since `1097dc8` and neither
   `auth.feature` nor `admin_auth.feature` had run since. Restored as the `auth` profile; the stale
   `backend/cucumber.js` was deleted so there is one config again. `harness.ts` also had to stop
   resolving the Prisma schema through `process.cwd()`, which only worked while the runner lived
   in `backend/`.
2. **Every boolean env key was pinned to `true`.** `z.coerce.boolean()` is JS truthiness over a
   string, so `"false"` parses as `true` — and `.env.example` ships both
   `EMAIL_VERIFICATION_REQUIRED=false` and `AI_ENABLED=false`. A default clone therefore got the
   K8.6 gate switched **on** (the opposite of the spec) and a boot that demanded provider keys
   nobody has — reproduced as `BOOT_FAILED / PROVIDER_KEY_MISSING` on a clean start. Replaced with
   a literal-string parser in `backend/src/lib/env.ts` and `worker/src/lib/env.ts`. This is F03's
   file; it is flagged for Sezai in STATE.md.
