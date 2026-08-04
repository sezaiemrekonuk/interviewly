# V03 — Voice → text downgrade on a fatal voice failure
REPO: (this repo) · Depends: V01, I06, I07 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — the fallback is the mandatory-requirement invariant (§3.2/§3.8). Losing an answer, rewinding the index, or leaving `mode` able to return to `voice` is a data-integrity defect the stub cannot surface; it is exactly what `voice_fallback.feature` exists to prove.
Independent of V02 — both depend on V01/I06/I07 but not on each other; either order is safe.

## Goal
Owner's ask:

> "Any fatal voice failure downgrades the **same** interview to text — same `interviewId`, same
> `current_index`, earlier voice answers preserved with `input_mode='voice'`, later answers
> `input_mode='text'` — and emits `VOICE_DOWNGRADED_TO_TEXT`. `interviews.mode` goes `voice → text`
> only, never the reverse; a mint attempted after the downgrade is `409 INVALID_STATE_TRANSITION`.
> Scenarios in `voice_fallback.feature` green, driven by `FakeVoiceSession`."
> — voice ledger decomposition (§3.2, §3.8, §5.5, ADR-V03)

This task creates `downgrade.ts` and wires the `FakeVoiceSession` fatal-error path to it. It
**consumes** I07 (`applyTransition` writes `interviews.mode`/state) and I06 (the answer path is
unchanged after downgrade). It does **not** touch the webhook gates (V02) or reconciliation (V04).

## Security boundaries
- **Downgrade is one-directional** (ADR-V03). `interviews.mode` goes `voice → text` only; nothing
  in this task, or reachable from it, sets `mode` back to `voice`. A post-downgrade mint is refused
  `409 INVALID_STATE_TRANSITION` (via V01's state-legality check).
- **No work is lost.** The downgrade preserves every recorded answer and the `current_index`; it
  changes only `mode`. Earlier voice answers keep `input_mode='voice'`; answers submitted after the
  downgrade are `input_mode='text'`. The `current_index` is never rewound.
- **`VOICE_DOWNGRADED_TO_TEXT` is the audit line** that explains why a "voice" interview has text
  answers — emit it with `{ traceId, interviewId }`, never a transcript or the failure's raw error.

## Context (anchors)
- `backend/modules/voice/downgrade.ts` — **create.** `downgradeToText(interviewId, ctx)`: set
  `interviews.mode = 'text'` through the I07 machine's write path (not a raw `mode:` update if the
  machine mediates mode; if `mode` is a plain column write, keep it a single guarded update that
  is a no-op when `mode` is already `text` — idempotent), preserve `current_index` and all answers,
  log `VOICE_DOWNGRADED_TO_TEXT`. Return the new room state. The function must be **idempotent** —
  a second fatal signal after the first downgrade changes nothing.
- `backend/modules/voice/fake-session.ts` — V01. `FakeVoiceSession.failNext()` / a fatal-turn
  signal is the trigger; route that fatal error into `downgradeToText`. A **healthy** turn must
  **not** downgrade (`voice_fallback.feature`'s second scenario asserts the mode stays `voice` and
  no event is emitted).
- `backend/modules/voice/session.ts` — V01. After a downgrade, the mint's state-legality check must
  reject with `409 INVALID_STATE_TRANSITION` — confirm a `text`-mode interview is not a
  voice-capable state.
- `backend/modules/interview/machine.ts` — I07. The downgrade is **not** a new K2 state edge — it
  changes `mode`, not `state`. Do not add a transition; if the machine owns `mode` writes, go
  through it, otherwise keep the guarded single-column update.
- `backend/modules/interview/answers.ts` — I06. Unchanged. After downgrade, a `POST /answers`
  stores `input_mode='text'` exactly as the text path already does — confirm, do not modify.
- `backend/src/lib/error-codes.ts` — F01. `INVALID_STATE_TRANSITION`.

  **The trap:** the downgrade must not rewind `current_index` or re-open answered questions.
  `voice_fallback.feature` @AC-6 downgrades on question 3 with questions 1–2 already answered by
  voice, then submits question 3 as text and asserts `currentIndex` stayed 3 and the two earlier
  answers still read `input_mode='voice'`. Touch only `mode`.

## Steps
- [x] **1. Create `downgrade.ts`** — `downgradeToText(interviewId, ctx)`: idempotent `mode → text`,
  preserve index + answers, log `VOICE_DOWNGRADED_TO_TEXT`, return room state.
- [x] **2. Wire the fatal-error path** — a `FakeVoiceSession` fatal turn routes into
  `downgradeToText`; a healthy turn does not.
- [x] **3. Confirm the post-downgrade mint rejection** — V01's mint returns `409
  INVALID_STATE_TRANSITION` once `mode = 'text'`.
- [x] **4. Confirm the text answer path** — after downgrade, `POST /answers` stores
  `input_mode='text'`, index unchanged (I06, unmodified).
- [x] **5. Wire acceptance step-defs** for `voice_fallback.feature` @AC-6: fatal error → `mode`
  becomes `text`, questions 1–2 preserved `input_mode='voice'`, `currentIndex` 3, event emitted;
  then submit question 3 → 200, stored `input_mode='text'`, mode still `text`; then post-downgrade
  mint → 409 `INVALID_STATE_TRANSITION`, mode still `text`. Second scenario: a healthy turn keeps
  `mode='voice'` and emits no event. Drive `FakeVoiceSession`; no network.
- [x] **6. Run the `## Verification` command.**

## Definition of done
- A `FakeVoiceSession` fatal error sets `interviews.mode = 'text'`, preserves every prior answer
  (earlier ones `input_mode='voice'`) and the `current_index`, and emits `VOICE_DOWNGRADED_TO_TEXT`.
- After downgrade, a submitted answer stores `input_mode='text'` with the index unchanged, and a
  new mint is `409 INVALID_STATE_TRANSITION`; `mode` never returns to `voice`.
- A healthy turn leaves `mode='voice'` and emits no downgrade event; `downgradeToText` is idempotent.

## Verification
```bash
npm run test:acceptance -- --tags "@voice-fallback"
```

Expected: both `voice_fallback.feature` scenarios pass, zero failures, zero pending.

## Notes

**Files.** New: `backend/modules/voice/downgrade.ts`,
`backend/features/step_definitions/voice-fallback.steps.ts`. Changed:
`backend/modules/voice/session.ts`, `cucumber.js` (`voice_fallback.feature` added to `default`
`paths`), `DECISIONS.md` (ADR-V03-2), `REFERENCE.md` (two rows).

**`mode` is a guarded column write, NOT `applyTransition` (ADR-V03-2).** `applyTransition` writes
`interviews.state` only — no `mode` parameter, and `mode` is not a K2 edge, so ADR-V03's "routed
through the I07 transition" describes a path that does not exist. `downgradeToText` is
`updateMany({ where: { id, mode: 'voice' }, data: { mode: 'text' } })`.

**Idempotency = the `mode: 'voice'` predicate.** A second fatal signal matches no row → `count 0`
→ returns `false`, rewrites nothing, emits no second `VOICE_DOWNGRADED_TO_TEXT`. Same predicate is
the one-directional rule. No separate read-then-write, so no TOCTOU.

**Only the driver call downgrades.** `_session.mint()` is wrapped in `session.ts`; the four
pre-checks above it (owner, `AI_ENABLED`, `mode`, voice-capable state) are not. A kill-switch-off
mint still returns 503 with `mode = 'voice'` — `voice_session.feature` @AC-2 unaffected (verified,
59/59 default). No `voice_sessions` row is written on the failing path (the mint throws first).

**Deviation — mint error code.** `mode !== 'voice'` was `VOICE_UNAVAILABLE` (503); now
`INVALID_STATE_TRANSITION` (409), which is what @AC-6's post-downgrade mint asserts. No existing
scenario covered the non-voice-mode mint, so nothing regressed.

**Deviation — no room state returned.** Task asked `downgradeToText` to return room state. It
returns `boolean` (did this call downgrade). Room state is produced by I03's `getInterviewState`
handler, which needs a request; no V03 caller consumes one — the mint rethrows `VOICE_UNAVAILABLE`.

**Deviation — no HTTP endpoint.** The client-signalled degradations (mic denied, WSS drop) are not
in @AC-6 or the DoD. `downgradeToText` is exported for **V05** to call from `/pre-join` — that is
"V05 uses V03's downgrade path" (STATE.md), one function, not a second mechanism.

**Verification** — `npm run test:acceptance -- --tags "@voice-fallback"`:
`2 scenarios (2 passed) / 19 steps (19 passed)`. Red first: 2 undefined, 12 undefined steps.
Regression: default 59/59, auth 23/23, vitest 144/144, lint + typecheck clean.

**Local run needs env overrides** (unchanged from V01/V02): `.env` carries compose hostnames.
`DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly_test`
`REDIS_URL=redis://localhost:6380`, with `docker compose -f compose.yaml -f compose.dev.yaml up -d db cache`.

**For V04: no interaction.** Reconciliation writes `llm_calls` + `spent_usd` and never reads or
writes `mode`; a downgraded interview still reconciles the seconds its session actually spent.
V04's `post_call` gates are 1–2 only and do not consult `mode`.
