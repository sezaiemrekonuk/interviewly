---
task: I10
author: Sezai
sessions: [2026-08-03]
model: claude-opus-5
model_recommended: claude-sonnet-4.6
iterations: 1
tools: [caveman:cavecrew, ponytail]
---

## Session 1 — 2026-08-03

### What I asked for / what came back
- Ran on opus against a sonnet-tier row (EXECUTE.md §5 would have stopped the run). Human
  directed it: the session's job was to finish a half-written sketch a previous run left
  uncommitted, not to start the row. Recorded here rather than aligning the frontmatter.
- Inherited: `language.ts` sketch + a 4-line `answers.ts` call, both uncommitted, with two
  `TODO(sonnet, finish)` markers and no step definitions and no feature file wired.

### Methodology trace
spec §3.4 AC-13 → `.agents/features/language_detection.feature` (already authored) →
`language.steps.ts` + `cucumber.js` `default.paths` → red (`'en' !== 'tr'` on the
below-margin scenario) → `trackLanguage` → green, 4 scenarios / 25 steps.

### Friction
- Only 1 of 4 scenarios could go red: the outline's three rows assert the classifier's own
  output and an absent `llm_calls` row, both true before any of I10 existed. The switch rule
  is carried by the second scenario alone. Left as is — inventing a `LANGUAGE_CLASSIFIED`
  event to make classification observable over HTTP is scope the spec does not name.
- Acceptance needs `DATABASE_URL`/`REDIS_URL` on published host ports, and the auth profile
  refuses any database not named `*_test`/`*ci`. Both already noted in the ledger; cost two
  failed runs to rediscover.

### What I rejected and rewrote by hand
- **The sketch's switch target.** It flipped `interviews.language` to whatever
  `detectLanguage` returned. That function classifies by script ratio and answers `ru`, `ja`,
  `ar`, … for non-Latin text, so two Cyrillic turns would have written `language = 'ru'` — a
  value no prompt, no UI locale and no report renders. Replaced with a `SUPPORTED = {en, tr}`
  guard that resets the streak instead (ADR-I35).
- **The sketch's stale-object bug.** `trackLanguage` returned `{ language, switched }` and
  `answers.ts` discarded it, so `ensureTechBatch` — running later in the same request —
  generated the technical batch in the pre-switch language. Now the handler reassigns
  `interview.language` from the return.
- **The `logger.debug` stand-in** for the K4 regeneration hook: replaced with a real
  fire-and-forget `prepareNextCandidates` call, guarded on the N+1 row actually holding
  candidates so a switch cannot spend an LLM call on a row D02 never pre-generated.
- **`import { detectLanguage } from '@interviewly/ai'`** → `aiClient().detectLanguage(...)`.
  The owner's ask names `AiClient.detectLanguage`, and going through the seam is what makes
  "no `llm_calls` row" a property of the client the app uses rather than of one call site.
