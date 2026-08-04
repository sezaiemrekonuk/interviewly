---
task: W05
author: Sezai
sessions: [2026-08-04]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 2
tools: [caveman:cavecrew-investigator, ponytail]
---

## Session 1 — 2026-08-04

### What I asked for / what came back
- Asked for screen 9 over `POST /interviews` + the I11 listing upload, mode-routed nav.
- Came back as a working form on the first pass, but with three claims about the API that were
  written as comments rather than checked. Two were right, one was wrong.

### Methodology trace
- Read `backend/modules/interview/setup.ts` before trusting any comment about the contract.
  Confirmed: body has no `occupation`/`language`; 201 is `{interviewId,hrCount,techCount}`.
  Refuted: the client guard `!jobText && !uploadId` — `setup.ts:55` throws `VALIDATION_ERROR`
  for an `uploadId` with no `jobText`, so an upload-only submit was a guaranteed server refusal.
- task AC → `page.test.tsx` 7 specs → **all green on the first run.** Per EXECUTE.md §6.5 a
  suite that is green before implementation proves nothing; here implementation already existed,
  so instead of accepting it I added the spec for the defect above → red → fixed → 9 green.
- Red evidence: `findByRole('alert')` timed out against a form that had submitted anyway.

### Friction
- The inherited `page.test.tsx` was `describe.todo`/`it.todo` stubs. The task's `## Verification`
  command **passed against it** — the exact false-green shape EXECUTE.md §7 warns about for the
  `unit`/`acceptance` jobs, reproduced at task level. A todo-only suite should not be able to
  satisfy a verification gate.
- Wrote `--on-primary`, `--radius-lg`, `--radius-sm` into the stylesheet from habit; none are in
  F01's `tokens.css`. Grepped the registry and moved to `--surface`, `--radius-card`,
  `--radius-input`, `--radius-button`. Invented tokens fail silently in CSS — no build error.
- `test:acceptance` hangs without a composed Postgres/Redis. Not run; diff is frontend-only.

### What I rejected and rewrote by hand
- **The `LISTING_REQUIRED` guard.** Rejected `!jobText && !uploadId`; rewrote as `!jobText.trim()`
  so a clean PDF upload with an empty textarea refuses locally with the message that names the
  real problem, instead of spending a round trip to earn `VALIDATION_ERROR`. Marked for deletion
  once I11 returns extracted text.
- **The dead occupation/language selects.** Kept the controls (the task asks for them) but
  rejected letting them look load-bearing — they send nothing. Added `setup.choiceNotSent` in both
  locales saying so, rather than leaving two inputs that silently discard what the user types.
- **The redundant `aria-label` duplicating its own text node** on the pending affordance — deleted,
  it doubled the string for a screen reader.
- Kept the client-side split preview against my instinct: it duplicates I03's formula, but setup
  navigates away before the 201 can render, so there is no other place the split can appear.
  Flagged as drift risk in the task Notes rather than hidden.
