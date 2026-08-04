---
task: D03
author: Fatih
sessions: [2026-08-04]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 1
tools: []
---

## Session 1 — 2026-08-04

### What I asked for / what came back
- New `backend/modules/interview/adaptive.ts` (`promoteNextQuestion`), wired into
  `advanceWithAnswer` (I06) as a fail-safe try/catch after the transition block.
- Steps `backend/features/step_definitions/adaptive.steps.ts`; feature added to `cucumber.js`.
- `@adaptive-questions` 6/6 green; ATDD red confirmed; full profile 79/79; lint/typecheck/test clean.

### Methodology trace
- EXECUTE.md → dep graph → D03 eligible (D01, D02, I02, I06 done). Opus tier matched.
- Read REFERENCE, the task, D01/D02 modules, `answers.ts`, `state.ts`, `schemas.ts`, and the
  shared steps (`ai-provider`, `answers`, `budget`, `voice-fallback`, `world.ts`).
- Hook: resolve next row via `currentQuestionRow(nextIndex)`; gate on candidates; score via
  injected/`aiClient` client; `selectNextQuestion`; graded → `$transaction(scores, row)`;
  malformed → `chosen_reason:'fallback'` + `LLM_FALLBACK_TRIGGERED`, no score write.

### Friction — the gating decision (brainstormed per instruction)
- First cut generated candidates for **every** submit → would add an `llm_calls` row per turn
  and break `language.steps` (asserts zero new calls/submit) and I08 budget. IDEA §3.7 L357:
  "the K4 ledger cannot break the MVP ledger." Resolution: **gate the hook on pre-generated
  candidates** — `nextRow.candidates` absent → return before any scoring/call/write. MVP
  interviews never pre-generate → the hook is a pure no-op. Removed `prepareNextCandidates`
  from the hook entirely. Verified: full acceptance profile still 79/79.

### What I rejected and rewrote by hand
- The authored `When I submit an answer for the current question` clashed verbatim with I08's
  budget step (HTTP + real client — cannot configure a score). Renamed the adaptive `When` to
  `I submit the current answer for adaptive scoring`; behaviour/Examples/Then unchanged.
- `const world = this` in the log-capture hook tripped `no-this-alias`; refactored to a
  module-level `captureLogs(world)` helper (the voice-fallback pattern).

### Verification (verbatim)
- `npm run test:acceptance -- --tags "@adaptive-questions"` → `6 scenarios (6 passed)`.
- Neutralised hook → `6 scenarios (6 failed)` (ATDD red), then restored → green.
- `npm run test:acceptance` (default) → `79 scenarios (79 passed)`.
- `npm run lint` clean · `npm run typecheck` clean · `npm test` → `229 passed`.
- Logs carry only `traceId/interviewId/questionId/chosenReason` — no content leak.

### Follow-up left for the ledger (non-blocking)
- No trigger wires *automatic* candidate pre-generation into the base turn (D02 runs only on a
  language switch), so adaptive is inert in prod until one exists. It needs a way to tell
  adaptive interviews from MVP ones — no `adaptive` flag/mode in the schema (F02 owns it). D03
  promotes correctly whenever candidates are present. Recorded in STATE.md "Open blockers".

### Environment notes
- Local acceptance needs host-reachable Postgres/Redis: `docker compose -f compose.yaml -f
  compose.dev.yaml up -d db cache`, then export
  `DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly` and
  `REDIS_URL=redis://localhost:6380` (cache is mapped to host 6380).
- Root-owned `~/.npm` cache blocked `npm install`; worked around with `--cache "$TMPDIR/npmcache"`
  (frontend's declared `@tanstack/react-query` was simply not installed — unrelated to D03).
