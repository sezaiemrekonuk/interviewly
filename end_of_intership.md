# Internship roadmap — 2 weeks (no deployment)

**Constraint: this application will not be deployed.** The entire `platform` ledger
(`P01`–`P09` — GHCR, Fly, kind, scale measurement) is out of scope on that basis; it exists
*only* to produce a deployed, measured scale story. Everything below runs against
`docker compose -f compose.yaml -f compose.dev.yaml up -d` on a laptop, nothing further.

Every feature ledger (auth, admin, interview-core, report, conductor, frontend, voice,
adaptive, foundations) is already `done` — there is no unbuilt feature waiting. What's real
and local is the tech debt and backlog each ledger's own `STATE.md` already named but nobody
picked up. This plan is that list, ordered by value and dependency, ten working days.

## Day 1 — Onboarding + baseline
- Read `.agents/docs/IDEA.md`, `.agents/EXECUTE.md` Part 1, skim every ledger's `STATE.md`.
- `docker compose -f compose.yaml -f compose.dev.yaml up -d`, `npm run prisma:generate`.
- `npm run lint && npm run typecheck && npm test` — confirm what's actually green today, before changing anything.

## Day 2 — Fix the two CI jobs that disagree, and the missing tsconfig
- `backend/tsconfig.json` doesn't exist. `npm run -w backend build` fails silently because nothing in CI runs `build` — `docker compose build` is the only thing exercising it. Write the file so the workspace actually compiles standalone.
- `lint`'s root `tsc --noEmit -p tsconfig.json` (`module: esnext`) disagrees with `build`'s per-workspace tsconfig (`module: commonjs`) — a file can be lint-clean and build-red (this already happened once, I08's top-level `await`). Point `lint` at each workspace's own tsconfig.
- Verify: `npm run build` (root) succeeds; `npm run lint` still passes.

## Day 3 — Kill the false-green `unit` CI job
- `backend`'s `test:unit` is `vitest run --passWithNoTests` because there are zero vitest files — the job has never actually run a test.
- Root cause first: `modules/auth/rate-limit.ts` constructs `new Redis(...)` at module load, so importing anything under `modules/auth/` from a unit test opens a connection that retries forever with no Redis service in the `unit` CI job. Make the client a lazy getter (module-load side effect → first-use side effect).
- Write the first real vitest test against `modules/auth/` now that it's importable in isolation. Drop `--passWithNoTests`.
- Verify: `npm run -w backend test:unit` runs the real test and exits on its result, not on an empty suite.

## Day 4 — Dependency audit: fix what's fixable, document what isn't
- `npm audit` job carries `continue-on-error: true`. `next`'s own advisory has no fixed stable release yet (leave it, note why) — but `postcss` (≤8.5.17→8.5.18+) and `sharp` (<0.35.0→0.35.3) are fixable today via root `overrides`.
- Add the two overrides, confirm `sharp` still renders images correctly (it's used in report/PDF and avatar assets) before dropping `continue-on-error`.
- The eslint 9→10 major bump (needed for the remaining highs) is its own bounded task — do it only if the overrides land clean with time left; otherwise note it as the next trigger.

## Day 5 — Two quick, independent wins
- **Admin cost index**: `llm_calls(interview_id, created_at)` composite index — `N04`/`N05`'s drill-down and `N06`'s `?sort=` both hit the single-column index today and then sort in memory. Safe additive Prisma migration rebased on F02.
- **Cucumber logger-capture helper**: four near-identical copies exist (`report-run.steps.ts`, `voice-webhook.steps.ts`, `voice-fallback.steps.ts`, `voice-reconcile.steps.ts`), each patching the pino singleton and restoring it in a tagged `After`. The ledger's own backlog already says the trigger fired (V04) — extract one shared helper, point all four at it.
- Verify: targeted test files for both areas still pass.

## Day 6 — Admin console's first write
- `POST /admin/interviews/:id/report/requeue` is mounted (`backend/modules/admin/router.ts:37`) and nothing in the frontend calls it. Wire the button into `queue-panel.tsx`'s dead-letter list — the console's first write path (everything else is read-only), so add a confirm step before the mutation.
- Verify: manual pass against a report forced into `failed`/dead-letter state, confirm it requeues and the queue panel reflects it.

## Day 7 — Admin console UX fixes
- **Filter state into the URL**: W13's filter bag (`q`/`sort`/`dir`) is React state per section — not linkable, doesn't survive reload. Move it into `page.tsx`'s query string; do the same for section selection in the same change (they're coupled).
- **Admin nav link**: `/admin` (W11) has no link from `components/chrome` — an admin has to type the URL. One-line nav entry.
- Verify: reload a filtered/sorted console URL, confirm state survives; click through nav to `/admin`.

## Day 8 — Conductor prompt latency, measured for real
- `L04` (speech-latency, unblocked, no hardware needed): the baseline's 1180 ms conductor figure was measured with a toy prompt. Measure real-prompt TTFT (persona brief, job listing, CV, up to 7000 chars of conversation) against a live key, decide whether prefix caching is worth it.
- Verify: `L04`'s own `## Verification` command, before/after numbers written into its task's `## Notes`.

## Day 9 — Correctness tidy: the double-fetch on answer submission
- `V02`'s webhook handler fetches `currentQuestionRow` to get `question.id`, then `advanceWithAnswer` fetches it again internally for its own `QUESTION_NOT_CURRENT` guard — two round trips per answer, no correctness bug, just waste. Make `advanceWithAnswer` accept a pre-fetched row.
- Verify: existing answer-submission tests still pass; confirm via query log (or a quick count) that it's one fetch, not two.

## Day 10 — Wrap-up
- Full `npm run lint && npm run typecheck && npm test` across everything touched this fortnight.
- Update each touched ledger's `STATE.md` (row status, "Last session ended") and write the devlogs, per `EXECUTE.md`'s convention.
- Note what's left undone as backlog with its trigger, same as every other ledger does — don't invent new abstractions to fill time on the last day.

## Explicitly not doing (and why)
- **Everything in the `platform` ledger** — deployment is off the table by the constraint given, and every `P` task is deploy-shaped almost by definition.
- **`L02`/`L03` measurement** — both need someone physically in the room with a live microphone; that's a scheduling fact, not a coding day, and not worsened by "no deploy."
- **`acceptance` CI false green** (real gap: no `cucumber.js`, no `features/`, `0 scenarios` reported as green) — real, local-only, but its own multi-day lift (config + first `.feature` file + step definitions). Flag as the next fortnight's Day 1 if there's a next one, don't half-build it here.
