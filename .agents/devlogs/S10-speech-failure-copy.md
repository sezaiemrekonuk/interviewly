---
task: S10
author: Ahmet
sessions: [2026-08-10]
model: claude-opus-4.8
model_recommended: claude-sonnet-5
iterations: 1
tools: [superpowers:test-driven-development, vitest]
---

## Session 1 — 2026-08-10

### What I asked for / what came back
- Ran on **opus, not the sonnet tier `MODELS.md` names for S10.** Recorded, not aligned — the
  frontmatter pair is the honest record. Invocation (`start s10`) named no person; proceeded as
  Ahmet on the `S`-prefix rule plus git identity, stated rather than guessed.
- Read first, and the task's own premise was already half-built: S06 threads the failed request's
  `code` into `session.error`. So step 2 ("read the code, don't collapse to `lost`") was done —
  S10 was component + copy only, no hook change.

### Methodology trace
speech AC-13 → `voice-controls.test.tsx` S10 block (5 scenarios: per-code copy, retry only where
it clears, 403 → no retry + no reconnect, ceiling → no retry, mic-lost names the mic) → red
(`voice.failure.*` / `voice.micLost` absent) → `room.voice.failure` map + `RETRYABLE_CODES` gate
+ `voice.lost`→`voice.micLost` → green 27/27. Grep `voice.lost` empty; lint + typecheck green.

### Friction
- None mechanical. The one real decision was **where the copy lives**: the generic `errors`
  namespace already had the four speech codes, so reusing it was the shortest diff — but it is
  wrong in the room. `FORBIDDEN` there reads "no permission"; `VOICE_SESSION_EXPIRED` reads
  "start it again", the retry the task forbids. Room-honest copy has to be room-scoped.

### What I rejected and rewrote by hand
- **Rejected: reuse `errorMessage(code)` for every failure and just gate the button.** Smallest
  change, and it ships the ceiling telling the candidate to "start it again" next to no button —
  copy and action contradicting. Wrote `room.voice.failure.<code>` with `useErrorMessage` as the
  fallback for unmapped codes, so the room speaks for the codes the failure table names and the
  registry still covers the rest.
- **Rejected: keep `voice.lost` and only reword its string.** The DoD grep wants the key gone
  where it means a dropped connection. A mic loss is not a connection loss, so the key name was
  itself the lie — renamed to `voice.micLost` (key and value) and reworded the `status.lost`
  chip; grep for `voice.lost` is now empty rather than "empty of the bad string only".
- **Rejected: a "Leave"/"Go to report" button for the terminal codes.** The room already
  navigates itself — `VOICE_UNAVAILABLE` refetches into text, `VOICE_SESSION_EXPIRED` refetches
  into the report route — and the rail's Leave is always present. A fourth button would be a
  control that races the navigation it duplicates. Copy alone for those; button only where a
  re-record can actually clear the failure.
