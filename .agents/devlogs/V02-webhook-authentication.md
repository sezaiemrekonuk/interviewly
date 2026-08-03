---
task: V02
author: Fatih
sessions: [2026-08-03]
model: claude-opus-5
model_recommended: claude-opus-4.8
iterations: 3
tools: [cucumber, vitest]
---

## Session 1 — 2026-08-03

### What I asked for / what came back
- Asked for the four gates + the three actions. Got a `runGates` that ran all four inline,
  including the K2 legality check — wrong shape: legality is per-action, so gate 4 had to split
  (clock half in the auth module, legality half in each `case`).
- `model` is `claude-opus-5`, MODELS.md recommends `claude-opus-4.8`. Same tier (EXECUTE §5 checks
  the tier, not the point release); not aligned quietly, per the devlog contract.

### Methodology trace
- feature wired → red (6 undefined) → step defs → red (4 failed, 1 ambiguous, 1 undefined) → green
- spec §7.1 item 4 → `voice_webhook.feature:56` @AC-5 → red (premature `end_round` returned 200,
  the round *was* exhausted at target 4) → fixed the fixture, not the assertion → 409
- `.feature` @AC-4 → red (`VOICE_SESSION_INVALID` where `VOICE_SESSION_EXPIRED` was asserted) →
  ADR-V02-2

### Friction
- **The spec contradicted its own feature file.** ADR-V02 and REFERENCE.md both put `expires_at`
  inside gate 3's lookup; @AC-4 requires expiry to be distinguishable from a nonexistent nonce and
  to end the interview `time_exhausted`. Wrote ADR-V02-2 and patched REFERENCE.md rather than
  editing the past ADR (EXECUTE §8, append-only).
- **`target_question_count: 4` made @AC-5 pass for the wrong reason.** hr split is
  `max(2, round(0.4·target))` → 2, so `end_round` at index 3 was a *legal* handover and the 409
  never fired on merit. Raised the fixture to 8 (hr 3). A green assertion I did not believe was
  the whole finding.
- Three steps I wrote were already in the global registry (`the response status is {int}`,
  `the interview state is {string}`, `the fixed clock is {string}`, …) — ambiguous-step failures
  across the suite. ADR-I21 is one registry; deleted mine and left a comment naming the owners.
- Cucumber expressions read `(` as an optional group: `(interviewId, nonce)` in @AC-4's step text
  silently matched nothing until escaped `\(`.
- `ELEVENLABS_WEBHOOK_SECRET` is optional in `env.ts` and **empty** in the `.env.example` CI
  copies — without a seam the gate-1 scenarios would have been green in CI for no reason. Added
  `webhookSeam.secret`, and made an unset secret reject rather than accept.

### What I rejected and rewrote by hand
- **Self-calling `POST /interviews/:id/answers` over HTTP from the webhook** — first approach.
  Needs a cookie the webhook does not have and re-runs `requireAuth`/CSRF against a request that
  legitimately has neither. Rewrote as `advanceWithAnswer(interview, body, ctx)` extracted from
  `answers.ts`, with `submitAnswer` as a wrapper: one copy of the `updateMany` guard, no fake auth.
- **A second `authorizeSession` query filtering `expires_at` "for safety"** on top of gate 4 —
  deleted. It reintroduces exactly the collapse ADR-V02-2 exists to prevent.
- **`JSON.stringify(req.body)` for the HMAC** — deleted before it ran. Key order and unicode
  escaping do not survive a parse/serialise round trip; the signature is over bytes or it is over
  nothing. Replaced with the `verify` hook on a `/webhooks`-scoped parser.
- **A `crypto.timingSafeEqual` call with no length pre-check** — throws on mismatched lengths, so
  a truncated digest would have been a 500 instead of a 401. Unit-tested that path explicitly.
- Logging `nonce` alongside `interviewId` in `VOICE_WEBHOOK_RECEIVED` (habit, and it would have
  been genuinely useful for correlation) — removed; K6 §7.2 makes the nonce a session secret and
  @AC-10 asserts it.
