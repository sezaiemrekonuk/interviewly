# A05 — Building password reset: enumeration-safe request, session-revoking confirm, two screens
REPO: (this repo) · Depends: A04 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.6** — account-takeover surface. The two rules that matter (no enumeration,
revoke every session) are both easy to implement in a way that looks correct and isn't.

## Goal
Owner's ask:

> "Password reset (K8.6): a hashed single-use token with a 1-hour TTL, a request endpoint that
> never reveals whether an account exists, and a confirm that revokes every session of that user.
> A Google-only account can set its first password this way."
> — IDEA.md K8.6, backend spec §8a, `password_reset.feature`

Ships `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`, the
`sessions(user_id)` index, and the two screens (`/forgot-password`, `/reset-password/[token]`).
Reuses A04's `tokens.ts` and `email.send` job unchanged.

## Non-negotiables
- **`request` always answers `202` with an empty body.** Registered, Google-only, unknown — byte-
  identical responses, and the same latency profile (do the work that differs *after* responding,
  i.e. enqueue only when the account exists). Copy on the screen is identical too; the client must
  not branch (frontend AC-20).
- **Rate limit the request by IP, not by user.** A per-user limiter leaks existence through its own
  429: an attacker learns which addresses have accounts by watching who gets limited.
- **Confirm revokes every session of that user, in the same transaction as the password write.**
  `UPDATE sessions SET revoked_at = now() WHERE user_id = $id AND revoked_at IS NULL`. A reset that
  leaves an attacker's session alive is not a reset. The caller's own cookie dies too — the screen
  says so and routes to `/sign-in`.
- **A rejected password must not consume the token.** Validate length (≥ 10, `PASSWORD_TOO_SHORT`)
  **before** the guarded consume, or a typo burns the link and the user needs a new mail.
- **Confirm also sets `email_verified_at` when null.** Control of the mailbox was just proven; and
  this is the path that lets a Google-only account (`password_hash = null`) gain its first password
  without tripping the K8 admin restriction.
- **Reuse A04's token helper.** Do not write a second mint/consume. The `kind` discriminator is
  exactly why `email_tokens` has one.

## Context (anchors)
- `backend/modules/auth/tokens.ts` (:A04) — reuse. `kind: 'reset'`, TTL from
  `PASSWORD_RESET_TTL_MINUTES`.
- `backend/modules/auth/password-reset.ts` — **create.** The two handlers.
- `backend/modules/auth/rate-limit.ts` (:A01) — **edit**: 5/hour/IP window for the request.
- `worker/src/jobs/email-send.ts` (:A04) — reuse; the `reset` template already exists there.
- `backend/prisma/migrations/` — **one index-only migration**: `sessions(user_id)`. Permitted by
  §5.2 (indexes only); rebase before merge.
- `frontend/app/(auth)/forgot-password/page.tsx` — **create.** One email field, `think` mascot,
  enumeration-safe success copy.
- `frontend/app/(auth)/reset-password/[token]/page.tsx` — **create.** New password + confirm,
  length-only strength hint (the server has exactly one rule — a complexity meter would invent a
  requirement the API does not enforce), then "you have been signed out everywhere" → `/sign-in`.
- `.agents/features/password_reset.feature` — the acceptance scenarios; make them green without
  editing them.

## Steps
- [ ] **1. `POST /auth/password-reset/request`** — Zod-validate the email, respond `202` with an
  empty body, then (only if the account exists) mint and enqueue.
- [ ] **2. `POST /auth/password-reset/confirm`** — validate password length → guarded consume →
  argon2id rehash + revoke-all-sessions + set `email_verified_at` if null, all in one transaction.
- [ ] **3. The `sessions(user_id)` index migration.**
- [ ] **4. The IP-keyed rate limit.**
- [ ] **5. The two screens**, plus the `/sign-in` **Forgot password?** link if A03 left it unwired.
- [ ] **6. Log events** — `AUTH_RESET_TOKEN_ISSUED`, `AUTH_RESET_COMPLETED` (with the count of
  sessions revoked; the count is the useful half of the line). No token, no hash, no email body.

## Definition of done
- `password_reset.feature` is green, including the Google-only-account scenario and the
  "rejected password leaves the token usable" scenario.
- A pre-reset session cookie returns `401 UNAUTHENTICATED` after a completed reset.
- Requests for a known, a Google-only and an unknown email are indistinguishable in status,
  body and headers.
- No token or hash in any log line (LogSink assertion).

## Verification
```bash
npx cucumber-js .agents/features/password_reset.feature
```
All scenarios pass. Then confirm the responses really are identical:
```bash
for e in known@example.com unknown@example.com; do
  curl -s -o /tmp/a05-$e.body -w "%{http_code}\n" -X POST \
    "$PUBLIC_ORIGIN/api/auth/password-reset/request" \
    -H 'content-type: application/json' -d "{\"email\":\"$e\"}"
done
diff /tmp/a05-known@example.com.body /tmp/a05-unknown@example.com.body && echo "IDENTICAL"
```
Expected: two `202`s and `IDENTICAL`.

## Notes

(Empty until the task is done. Fill with: what actually happened, the cucumber output verbatim,
the revoked-session counts observed, whether the timing of the two request paths is
indistinguishable in practice, and anything deliberately left out.)
