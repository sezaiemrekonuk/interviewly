# Adaptive — State

Last updated: 2026-08-04
Last session ended: **D03 done (Fatih, 2026-08-04, opus).** Adaptive hook
`promoteNextQuestion` at `backend/modules/interview/adaptive.ts`, wired into `advanceWithAnswer`
(I06) as a fail-safe try/catch. **Gated on pre-generated candidates** so an MVP interview is a
no-op — the full acceptance profile stays 79/79. Steps at
`backend/features/step_definitions/adaptive.steps.ts` (direct call + injected score client);
feature added to `cucumber.js`. Adaptive `When` renamed to avoid a verbatim clash with I08's
budget step. `@adaptive-questions` 6/6, ATDD red confirmed; lint/typecheck/test all clean.
**All three adaptive tasks (D01–D03) are done — the ledger is complete.**

## Execution protocol (follow exactly)

Do not start from this file. `.agents/EXECUTE.md` is the prompt, and its § 4 decides which
task is yours — not the "Current task" pointer below, which is a human-readable summary and
can lag.

Read this file → read `REFERENCE.md` once → read only the task § 4 gave you →
check `MODELS.md` for the required tier and stop if it is not yours → do the work, ticking
checkboxes → run the task's `## Verification` command verbatim → fill in the task's
`## Notes` → update this file's ledger row, "Current task" pointer, and "Last session ended"
line → write `.agents/devlogs/{ID}-<slug>.md` (EXECUTE.md § Devlog) → **do not commit** →
re-apply EXECUTE.md § 4 and continue with what it gives you.

## Current task

**D03 is done (2026-08-04) — the adaptive ledger (D01–D03) is complete.** All three tasks are
`done`; there is no next adaptive task. Per EXECUTE.md § 4, pick up work from another ledger.

D01 (delivered): pure `selectNextQuestion(rawScore, current)` at
`backend/modules/interview/adaptive-select.ts` validates the raw score against `ScoresSchema`
(imported from `@interviewly/ai`), applies the B5 table with clamped difficulty shifts, and
returns `fallback` for any schema-invalid score. Self-check at `adaptive-select.selftest.ts`.

D02 (delivered): `prepareNextCandidates` at `backend/modules/interview/candidate-prep.ts`
generates the three N+1 candidates and persists them to `questions.candidates`.

D03 (delivered): `promoteNextQuestion` at `backend/modules/interview/adaptive.ts` scores the
answer, runs the D01 selector, and promotes the matching D02 candidate into the next row —
gated on pre-generated candidates so the MVP flow is untouched. Greens `@adaptive-questions`.

## Environment

This ledger is **bonus band (§12)** and blocks nothing. Its cross-ledger dependencies
(foundations + interview-core) must be `done` before the dependent task starts (per-task
`Depends on` below):

- **F01** provides `backend/src/lib/error-codes.ts` and `@interviewly/types`.
- **F02** provides `backend/prisma/schema.prisma` with the `questions.candidates`,
  `questions.chosen_reason` (`ChosenReason` enum), `questions.difficulty`/`topic`, and
  `answers.scores` columns; `backend/src/lib/db.ts` (`prisma`).
- **F03** provides `logger.ts`, `env.ts`, `compose.yaml` (Postgres + Redis), CI acceptance
  runner, and the `packages/ai/` workspace entry.
- **I01** provides the `@interviewly/ai` package: the `AiClient` interface (`scoreAnswer`,
  `generateCandidates`), the `Scores` and `Candidate` Zod schemas, and `StubAiClient`.
- **I02** provides real provider execution behind that interface: per-attempt `llm_calls`,
  cost, and the `LLM_FALLBACK_TRIGGERED` emission the malformed-score guard relies on.
- **I04** provides the base round questions (the existing N+1 row adaptive rewrites) and the
  interview module's generation wiring.
- **I06** provides `POST /interviews/:id/answers`: the guarded advance, the transcript write,
  and the marked adaptive-hook slot where D03 attaches.

Set up the environment once the dependencies land:

```bash
docker compose up -d db cache
cd backend && npm install && npx prisma migrate deploy && npm run seed
npm run -w @interviewly/ai build            # I01/I02 package must build
npx tsx backend/modules/interview/adaptive-select.selftest.ts   # D01 self-check
```

Confirm the Cucumber acceptance runner is wired (F03/CI step) before running D03's
Verification command.

## Open blockers / decisions for the user

D03 is complete and blocks nothing. One **non-blocking follow-up** surfaced: nothing wires
*automatic* candidate pre-generation into the base answer turn yet (D02's `prepareNextCandidates`
runs only on a language switch), so adaptive promotion is inert in production until a trigger
exists. Adding one needs a way to distinguish adaptive interviews from MVP ones — there is no
`adaptive` flag or dedicated `mode` in the schema, and F02 owns `schema.prisma`. Whoever picks
this up decides the gating (a flag vs. always-on with the MVP tests updated). D03 itself promotes
correctly whenever candidates are present, which is all `@adaptive-questions` requires.

## Task ledger (D01–D03)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo. Dependency-sorted.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| D01 | Adaptive score→question selector and malformed-score guard (pure module) | | done | F01, F02, F03, I01 |
| D02 | Next-question candidate pre-generation during a turn | | done | F01, F02, F03, I01, I02, I04 |
| D03 | Score-driven promotion and malformed-score fallback (greens `@adaptive-questions`) | | done | D01, D02, I02, I06 |

D01 and D02 are **genuinely independent** of each other — either order is safe. D03 depends on
both. Both D01 and D02 also carry cross-ledger dependencies (below) that must be green first.

## Critical path

D01 and D02 (parallelisable) → **D03** (the acceptance gate that greens `@adaptive-questions`).

## Cross-ledger dependencies (blocks this ledger)

| Ledger task | Provides | Needed by |
|---|---|---|
| F01 | `error-codes.ts`, `@interviewly/types` | D01, D02, D03 |
| F02 | `schema.prisma` `questions.candidates`/`chosen_reason` (`ChosenReason` enum)/`difficulty`/`topic`, `answers.scores`; `db.ts` `prisma` | D01, D02, D03 |
| F03 | `logger.ts`, `env.ts`, `compose.yaml` (Postgres + Redis), CI acceptance runner, `packages/ai/` entry | D01, D02, D03 |
| I01 | `@interviewly/ai`: `AiClient.scoreAnswer`/`generateCandidates` interface, `Scores` + `Candidate` schemas, `StubAiClient` | D01 (Scores schema), D02 (generateCandidates + Candidate + stub), D03 (scoreAnswer + Scores) |
| I02 | Provider execution behind the seam: per-attempt `llm_calls`, cost, `LLM_FALLBACK_TRIGGERED` emission | D02 (candidate calls), D03 (score call + fallback trigger) |
| I04 | Base round question generation (the existing next row adaptive rewrites) | D02, D03 |
| I06 | `POST /interviews/:id/answers`: guarded advance, transcript write, marked adaptive-hook slot | D03 |

**No adaptive task may be merged until its `Depends on` — including the foundations and
interview-core tasks above — are green.** A dependency that crosses into another ledger blocks
on that ledger's *green task*, never on someone's half-done branch. In particular D03 cannot be
written until I06 has landed the answer handler with its adaptive-hook slot, and until I01/I02
expose a working `scoreAnswer` + `generateCandidates`.

## Cross-ledger dependencies (this ledger blocks)

**None. Adaptive blocks no ledger.** It is the bonus band (§12) and is a leaf: no other
ledger — foundations, auth, interview-core, report, admin, or voice — depends on any `D` task.
K4 is explicitly an additive upgrade that "cannot break the MVP ledger" (§3.7), so nothing is
scheduled behind it.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **Admin analysis of the two unpromoted candidates** — D02/D03 leave the non-promoted
  candidates in `questions.candidates`; no surface reads them yet. Promote when the admin
  ledger specs a candidate-inspection view.
- **Language-switch candidate regeneration (`chosen_reason = 'language_switch'`)** — on a
  two-consecutive-turn language switch, pre-generated candidates are in the wrong language and
  must be discarded and regenerated (§3.4). I10 owns the switch counting; promote an adaptive
  regeneration task only once I10's `LANGUAGE_SWITCH_DETECTED` hook is specced to call back
  into candidate-prep.
- **Same-difficulty "different angle" enforcement for `score_mid`** — the `overall = 3` row
  keeps the same topic and difficulty but a "different angle"; today promotion reuses the
  same-difficulty candidate. Promote a distinct-angle check if reviewers find mid-score
  follow-ups too similar to the prior question.
