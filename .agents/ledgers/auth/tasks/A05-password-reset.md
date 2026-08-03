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
- [x] **1. `POST /auth/password-reset/request`** — Zod-validate the email, respond `202` with an
  empty body, then (only if the account exists) mint and enqueue.
- [x] **2. `POST /auth/password-reset/confirm`** — validate password length → guarded consume →
  argon2id rehash + revoke-all-sessions + set `email_verified_at` if null, all in one transaction.
- [x] **3. The `sessions(user_id)` index migration.**
- [x] **4. The IP-keyed rate limit.**
- [x] **5. The two screens.** The `/sign-in` **Forgot password?** link was already wired by A03.
- [x] **6. Log events** — `AUTH_RESET_TOKEN_ISSUED`, `AUTH_RESET_COMPLETED` (with the count of
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

**Done 2026-08-03.** Whole scope shipped; nothing deferred.

### Verification, verbatim

`## Verification`'s bare `npx cucumber-js <file>` still cannot run, for the reason A04 recorded
as ADR-A04-3 — it selects the `default` profile, which has no auth harness. Command is
`npx cucumber-js -p auth`; `password_reset.feature` is now in that profile's `paths`.

```
red (no handlers):   18 scenarios (7 failed, 11 passed)
green:               18 scenarios (18 passed) / 155 steps (155 passed)
```

Mutation on the invariant: narrowing the revoke to `id: 'MUTANT'` keeps the password write and
makes @AC-26 fail on `GET /me` → 401 (`1 failed, 2 passed`). Restored.

Identical-response half ran against the API booted by hand — BLOCKER-1b still leaves
`$PUBLIC_ORIGIN/api/...` with no `api` behind it — five samples per address:

```
known@example.com       202 x5   0.0025 0.0017 0.0015 0.0016 0.0012 s
googleonly@example.com  202 x5   0.0018 0.0014 0.0014 0.0011 0.0012 s
unknown@example.com     202 x5   0.0016 0.0012 0.0014 0.0011 0.0012 s
bodies 0 bytes, byte-identical; headers identical except Date
```

Bands overlap completely: the lookup happens after `res.end()`. Real BullMQ held `reset` jobs for
known x5 and googleonly x5, unknown absent. Log grep: 0 hits for 64-hex, base64url-43 or either
address. `AUTH_RESET_COMPLETED` counts 1 signed-in, 0 where no login happened. Gates green
(`npm test` 105 tests; interview-core ring 33/33).

### Decisions worth carrying

- **`res.end()` before the account lookup**, not after — a `findUnique` first puts the difference
  back into the latency, which an identical body does not close.
- **`resetMailSettled()`** is the exported join point for that fire-and-forget work; without it
  every "no job for the unknown address" assertion is a race. Promise tracker, no env branch.
- **Length checked before the consume**, so a typo cannot burn the link. **`revokeCookie(res)` on
  confirm** — the caller's own row is one of the revoked ones.
- **`PASSWORDS_MISMATCH` is client-only**, rendered from `auth.passwordsMismatch`: the API has
  no code for it and no second field to compare.
- **`AuthWorld.passwords`** (filled by `auth.ts`'s fixture Givens) lets `I am signed in as` use
  `/auth/login` instead of inserting a `sessions` row login never issued.

### For A06

- `MODELS.md` had no A04–A06 rows; added from each task file's `**Model:**` line. A06 is
  sonnet-tier — § 5 will stop an opus session on it.
- Migration is index-only (`*_sessions_user_id_idx`) plus one `@@index([user_id])` on `Session`.
