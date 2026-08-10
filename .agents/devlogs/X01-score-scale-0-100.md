---
task: X01
author: Sezai
sessions: [2026-08-09]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 1
tools: [ponytail, caveman]
---

<!-- No ledger row: this is a cross-ledger product change (ai + adaptive + report + frontend),
     directed in-session rather than picked off a STATE table. `ci/check-devlogs.sh` walks
     done→devlog, never the reverse, so an ID no STATE claims is inert. The reasoning lives in
     ADR-I39 (interview-core) and is not repeated here. -->

## Session 1 — 2026-08-09 — every score becomes an integer 0..100

### What changed, in the order it had to change
`packages/ai/src/schemas.ts` first (`SCORE_MAX = 100`, exported), because every other edit is
downstream of the gate: prompts, selector cuts, stored rows, six frontend surfaces, the PDF.
Working outward from the schema is what kept the sweep finite — `grep 0\.\.5` after each layer
named the next one.

### Methodology trace
Not ATDD: no new behaviour, one unit change to existing behaviour. The equivalent discipline
was **×20 on every existing cut point** — B5's 2/3 → 40/60, `WEAKNESS_CEILING` 3 → 60, the
demo's 4 → 82. Under that mapping every acceptance scenario and every unit test stays a
statement about the same behaviour, so a red test means the rescale is wrong, not that the
product changed. 730/731 unit green (the failure, `env-drift`, is red on a clean tree too —
local `.env` drift, not this work). Acceptance ran against a scratch `interviewly_acceptance`
database rather than the dev one; `prisma migrate deploy` on it is also what proved the new
migration applies.

### Friction
- Two sentinel values were load-bearing and silently stopped being sentinels: `overall 9` in
  `adaptive_questions.feature` and `overall_score 7` in `schema_validation.feature` are both
  *valid* on a 0..100 scale. Left alone, two scenarios about rejecting malformed model output
  would have passed while asserting nothing. Now 101.
- The frontend cannot import `@interviewly/ai` (no workspace dependency, and adding one drags
  zod and the prompt registry into the browser bundle), so `SCORE_MAX` is deliberately two
  constants. `frontend/src/lib/score.ts` exists to make that exactly two, not seven — it
  replaced four `const SCORE_MAX = 5` and three `max={5}` literals.
- `report.scoreMax` / `scoreValue` carried the ceiling **inside the copy** in both locales
  (`"/ 5"`). Changing the literal would have reproduced the drift one layer down, so they take
  a `{max}` parameter now.
- The jsonb halves of the migration (`answers.scores`, `reports.payload`) were checked as a
  read-only `SELECT` against the dev database before being written as an `UPDATE` — key order
  and every untouched key survive, which is the part a rewrite of a jsonb array gets wrong.

### What I rejected
- **Editing the three prompts in place.** `prompt_version` is what says which scale a stored
  number was produced on; a v2 file per lineage (same uuid, `registry.resolve()` takes the
  highest) is the mechanism the registry already has for exactly this.
- **Re-deriving the bands** ("0–100 deserves a real rubric"). That is a second change wearing
  the first one's clothes — do it after the rescale lands, against data on the new scale.
- **Leaving stored rows on the old scale.** A 4 rendered as `4 / 100` is a bug report, not a
  historical record.
