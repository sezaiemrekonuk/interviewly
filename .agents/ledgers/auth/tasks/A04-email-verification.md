# A04 — Building email verification: tokens, the mail job, the gate, and the two screens
REPO: (this repo) · Depends: A03 · Status: todo
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
- [ ] **1. `tokens.ts`** — 32 random bytes (`crypto.randomBytes`), base64url for the link,
  `sha256` hex for storage. TTL from `EMAIL_VERIFY_TTL_HOURS`. Guarded consume as above.
- [ ] **2. `POST /auth/verify-email/request`** — authenticated. Cooldown check → mint → enqueue.
  `202 { cooldownSeconds: 60 }`. Idempotent for an already-verified user (still `202`, no mail).
- [ ] **3. `POST /auth/verify-email/confirm`** — public (the link works in any browser). Consume,
  set `email_verified_at`, return the user. Already-verified with a fresh valid token is `200`.
- [ ] **4. Register hook + Google verified-email hook.**
- [ ] **5. `email.send` worker job** with both templates and the `PUBLIC_ORIGIN`-based link.
- [ ] **6. The single gate** on `POST /interviews`.
- [ ] **7. The two screens**, including the `EMAIL_NOT_VERIFIED` route-back that **preserves the
  typed listing** (frontend AC-21 — the setup form's state is not the router's business, so keep
  it in the client store rather than the URL).
- [ ] **8. Log events** — `AUTH_VERIFY_TOKEN_ISSUED`, `AUTH_EMAIL_VERIFIED`,
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

(Empty until the task is done. Fill with: what actually happened, the cucumber output verbatim,
whether the `POST /interviews` gate landed or was deferred to I03, the token TTLs used, and a
hand-off line for A05 noting that `tokens.ts` and the `email.send` job are shared.)
