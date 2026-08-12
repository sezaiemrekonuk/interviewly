# Platform — State

Last updated: 2026-08-12
Last session ended: **P05 taken out of order and left `in_progress` (Ahmet, 2026-08-12, opus-5).**
The owner had ~1.5 hours and chose the Fly deploy over the critical path, so **P01 was skipped**
and all four apps build on Fly's remote builder instead of GHCR. The stack is up and serving at
**https://interviewly-edge.fly.dev** — `/api/readyz` returns `{"ready":true}`, the release command
applied 21 migrations, and the worker's abandon sweep completed against both dependencies. Four
Definition-of-done bullets are unverified and named in P05's Notes; the SSE stream through the edge
is the one that matters most, because P06 depends on it and it was never exercised.

Read P05's `## Notes` before touching anything Fly-shaped. Seven configuration traps are recorded
there, two of which produce a green machine serving 502s.

Before this session: the ledger was opened the same day — the spec
(`.agents/specs/2026-08-12-platform.md`), PLAN, ten ADRs and nine task files are in place, and the
ownership row is in `.agents/EXECUTE.md`.

Four things were settled by reading the code rather than by argument, and they shaped every task
here:

- **The api is already horizontally correct.** `sse.ts:87` publishes state changes over Redis
  pub/sub, so a transition applied on one replica reaches a stream held on another. `streamsByUser`
  (`:146`) is per-process but is only local bookkeeping. There is nothing to fix before multi-replica
  is honest.
- **The worker is already replica-safe.** `worker/src/index.ts:87` schedules the abandon sweep
  through a BullMQ `JobScheduler`, whose state lives in Redis. P04 verifies this by observation
  rather than trusting the reasoning.
- **The ceiling is Redis connections, not replicas.** `sse.ts:180` opens one `redis.duplicate()` per
  open stream, and the `:212` comment names the alternative it declined to build. Concurrent
  interviews scale 1:1 with Redis connections, so managed Redis caps them before api CPU
  saturates. ADR-P09 measures and names it rather than fixing it — the fix is a refcounted
  subscriber map, which is where SSE fan-out bugs live, and no number yet says what it buys.
- **The speech seam exists; its boot-time caller does not.** `setSpeechProvider`
  (`SpeechProvider.ts:27`) already swaps the provider wholesale and the acceptance ring uses it, but
  nothing outside tests calls it, so a deployed process always holds `ElevenLabsSpeech`. P02 adds
  the one call — and the guard that makes a half-fake configuration impossible.

This ledger reverses a recorded decision. IDEA.md §11 says "no Kubernetes, no Helm" and "load
balancers, multi-instance and autoscaling are **not built**". ADR-P01 supersedes those exclusions
**for measurement only** — §11's production reasoning stands, its text is unedited, and nothing
already `done` under it is reopened.

## Execution protocol (follow exactly)

Do not start from this file. `.agents/EXECUTE.md` is the prompt, and its §4 decides which task is
yours — not the "Current task" pointer below, which is a human-readable summary and can lag.

Read this file → read `REFERENCE.md` once → read only the task §4 gave you → check `MODELS.md` for
the required tier and stop if it is not yours → do the work, ticking checkboxes → run the task's
`## Verification` command verbatim → fill in the task's `## Notes`, **including the machine every
measurement ran on** → update this file's ledger row, "Current task" pointer, and "Last session
ended" line → write `.agents/devlogs/{ID}-<slug>.md` (EXECUTE.md § Devlog) → **do not commit** →
re-apply EXECUTE.md §4 and continue with what it gives you.

## Current task

**`P02`** — the load-test provider profile — still. The Fly deploy did not move the critical path:
`P02 → P03 → P04 → P06 → P09` is untouched, and P06 cannot run without P04's baseline no matter
how deployed Fly is. P02 remains the smallest task in the ledger and the one everything waits on.

`P02` is where this ledger can do real damage: a fake speech provider that reaches a production boot
transcribes nothing, scores nobody, and looks entirely normal. Its guard has no override flag, on
purpose — read the Non-negotiables before writing the `superRefine`. Note that a live Fly deployment
now exists with `AI_ENABLED=true`, which raises the stakes on that guard rather than lowering them.

Two smaller things are open and can be picked up by anyone:

- **Finish P05.** Four unverified bullets, listed in its Notes. The SSE stream through the edge is
  the one P06 depends on.
- **P01, still worth doing.** Skipping it means Fly and `kind` will not deploy the same bytes, so
  P06's and P08's tables are not comparable (ADR-P06). Doing it later is cheaper than explaining
  the gap in `SCALE.md`.

## Environment

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d   # dep ports published
npm run prisma:generate
npm run lint && npm run typecheck && npm test
```

A session must install for itself, per task: `k6` (P03 onward), `flyctl` + a Fly account with
billing (P05, P06), `kind` + `kubectl` (P07, P08). Nothing in this ledger needs a live
`OPENAI_API_KEY` or `ELEVENLABS_API_KEY` — every measurement runs stubbed by decision (ADR-P07) —
**except** P05's end-to-end walk-through, which exercises the live configuration on purpose.

No migration in this ledger. `prisma migrate deploy` changes where it is invoked from, never what
it applies.

## Open blockers / decisions for the user

- **The `P` prefix is a shared-file change.** `.agents/EXECUTE.md` §1 is the only authority on who
  owns what, and it currently assigns infra (`F03`, compose/CI/deploy shape) to Sezai with no ledger
  owning deployment at all. The row added for this ledger needs the team's agreement, not just a
  commit. Blocks: everything.
- ~~**A Fly account with billing.**~~ **Settled 2026-08-12:** Ahmet's personal org
  (`ahmet-kilic-924`). No ceiling was agreed before spending started. Standing cost is **$38/month**
  for Managed Postgres Basic plus per-command Upstash billing, and it accrues whether or not the
  apps are running. **The team should agree a ceiling now, retroactively** — and decide whether the
  deployment stays warm between sessions or is torn down (`fly/README.md` § Cost).
- **Upstash must move to a fixed-price plan before P06.** Pay-as-you-go bills $0.20 per 100K
  commands, and Fly's own CLI warns that BullMQ polls frequently. A load run on this plan has no
  cost bound. Blocks: P06.
- **The Redis connection limit is still unknown**, and it is ADR-P09's headline number. Not in
  `fly redis status`; read it from the Upstash console. Blocks: P09's ceiling claim, and any
  reading of P06's tables.
- **GHCR package visibility.** P01 publishes under the org; a Fly pull would need the packages
  readable by the deploy token. Not currently blocking — P05 builds on Fly's remote builder — but
  it returns the moment P01 is done properly.

## Task ledger (P01–P09)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| P01 | GHCR: three images, one sha, both targets | | todo | — |
| P02 | The load-test provider profile: fake speech at real latency, and a guard that cannot be quiet | | todo | — |
| P03 | k6 harness: browse, and a room that holds its stream open | | todo | P02 |
| P04 | The single-replica baseline, and the worker-replica check | | todo | P03 |
| P05 | Fly: four apps, managed dependencies, and the three settings that fail silently | | in_progress | P01 (skipped) |
| P07 | kind: kustomize base and overlay, and the ingress annotation that decides whether SSE works | | todo | P01 |
| P06 | Fly scale runs: 1, 2, 4, 8 api machines, and which resource actually stopped each one | | todo | P04, P05 |
| P08 | kind: metrics-server, an HPA on api, and the second table | | todo | P04, P07 |
| P09 | SCALE.md: the ceiling first, the tables second, and what was faked | | todo | P06, P08 |

Rows are listed in the order they can actually be started, not by number. P05 and P07 both need
only P01, so either can follow it; the numbering follows the sequence they were designed in.

## Critical path

`P02 → P03 → P04 → P06 → P09`. P04 gates both measurement tasks, and P02 gates P04 — so the
provider profile, the smallest task in the ledger, is what everything downstream waits on. P01 →
P05/P07 runs in parallel and joins at P06/P08.

## Cross-ledger dependencies

**None in either direction.** No `P` task depends on another ledger, and no other ledger cites a
`P` id. This ledger touches `backend/src/lib/env.ts`, `backend/modules/speech/SpeechProvider.ts`,
`backend/modules/speech/fake-speech.ts` and `packages/ai/src/stub.ts` (all P02) and otherwise adds
only new files. If a `speech` or `speech-latency` task is in flight against those four, sequence
P02 after it — same-file conflict, not a correctness dependency.

## ⚠ Known tech debt

- **[P09] The SSE connection ceiling is documented, not fixed.** ADR-P09. Every deployment of this
  system is bounded by its Redis connection cap, and after P09 that is written down rather than
  discovered. The mitigation is that it is written down.
- **[P08] The worker tier does not autoscale.** ADR-P08 — CPU is the wrong signal for an LLM-bound
  consumer, and the right one needs KEDA. Until then a report backlog needs a human to notice.
- **[P05] Fly Postgres is a single node.** Fine for a demonstration; `SCALE.md` says so, and nothing
  else mitigates it.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **The shared SSE subscriber.** One Redis connection per stream becomes one per process, with an
  in-process channel → response map and refcounted unsubscribe — the design `sse.ts:212` describes
  and declined. **Trigger: P09's measured ceiling**, if it lands below the concurrency the project
  actually wants. Do not promote it before there is a number; it is the riskiest change available
  in this codebase and it fails silently.
- **KEDA on BullMQ queue depth.** The correct worker autoscaler (ADR-P08). Trigger: a run where
  report latency, not turn latency, is the thing that degrades.
- **A scale regression gate in CI.** Nothing currently notices if a change halves concurrency.
  Trigger: two consecutive `SCALE.md` revisions with comparable numbers — before that there is
  nothing stable to regress against.
- **Real-provider calibration run.** ADR-P07 chose stubs only. Trigger: someone disputing the
  stubbed figures, or a provider plan change that makes a small real run cheap.
- **A second region on Fly.** Trigger: a latency complaint from outside the deployed region — not
  before, since it multiplies the Redis connection problem rather than solving anything.
