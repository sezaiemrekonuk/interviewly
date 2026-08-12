# P04 — The single-replica baseline, and the worker-replica check
REPO: (this repo) · Depends: P03 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — running an existing harness and writing down what it printed. The one
judgement is checked by observation, not decided.

## Goal
Owner's ask:

> If I want to deploy my system in fly and use also kuberneets and with fake routing show my
> scale level and note it in docs what would i need

Every number P06 and P08 produce needs something to be a number *against*. This task measures one
replica of everything under `docker compose`, on one machine, and records it — including the
Redis connection count at each VU level, which is where ADR-P09's ceiling stops being a claim about
source code.

It also settles the one open question about worker replicas: whether the abandon sweep really does
fire once per interval across N workers, or N times.

## Non-negotiables
- **One machine, and name it.** CPU, RAM and Docker resource limits go in `## Notes`. A baseline
  without a machine attached to it cannot be compared to anything, including itself next month.
- **Providers stubbed** (`LOADTEST=1`, `AI_ENABLED=false`, `SPEECH_PROVIDER=fake`) with P02's
  injected latencies at their defaults. Record the three values used — if a later task changes
  them, every table before the change is void.
- **Record the Redis connection count at every VU level**, not just the peak. The shape of that
  curve against the concurrency curve is P09's headline.
- **Do not tune anything.** Not Postgres, not Redis `maxmemory`, not `REPORT_CONCURRENCY`. A tuned
  baseline measures the tuning. Tuning ideas go in `## Notes` and, if they survive, the Backlog.
- **A failed run is a result.** If the stack falls over at 40 VUs, that is the baseline — record
  what broke and how, do not lower the ramp until it looks good.

## Context (anchors)
- `loadtest/` — P03's scripts and README. Do not modify them here; if a scenario is wrong, that is
  a P03 defect and this task stops.
- `compose.yaml` → `cache` — `--maxmemory 512mb --maxmemory-policy noeviction`, with the comment
  explaining why eviction is off. Under load this is a thing that can fail, and it fails as a
  refused write rather than a slowdown.
- `compose.yaml` → `worker` — no `deploy.replicas` today. `docker compose up -d --scale worker=N`
  is how this task gets more.
- `worker/src/index.ts:87` — the abandon sweep `JobScheduler`, `{ every: ABANDON_SWEEP_EVERY_MS,
  immediately: true }`. Scheduler state lives in Redis, so N replicas *should* produce one sweep
  per interval. Verify; do not assume.
- `worker/src/index.ts:60` — `concurrency: REPORT_CONCURRENCY`, deliberately low (K10).
- `backend/modules/interview/sse.ts:180` — the per-stream `redis.duplicate()`.
- `compose.dev.yaml` — publishes db 5432, cache 6380, bucket 9000, mailpit 8025, api 4000.

## Steps
- [ ] Bring up the stack with `compose.dev.yaml` and the load-test env; confirm the boot log names
      the fake speech provider (P02 logs it unconditionally).
- [ ] Run `http-browse` at a ramp to saturation. Record req/s and p95 at each step and where p95
      crosses its threshold.
- [ ] Run `live-interview` at 10 / 25 / 50 / 100 VUs, one run per level, recording concurrent
      streams sustained, p95 turn latency, and `connected_clients` at steady state for each.
- [ ] Identify which resource ended the run at the highest level — Redis connections, api CPU,
      Postgres connections, or the machine. Name it explicitly; "it got slow" is not a finding.
- [ ] Scale workers: `docker compose up -d --scale worker=3`, then watch one full
      `ABANDON_SWEEP_EVERY_MS` window and count the sweep executions in the logs. Expect **one**.
      Record the count either way — an N-times result is a real bug and goes straight to STATE.md's
      Open blockers.
- [ ] Write every figure into `loadtest/results/` (already the k6 output path) and summarise the
      table in `## Notes`. `SCALE.md` is P09's file — do not create it here.

## Definition of done
- A `compose-1x` row exists for every VU level, with concurrent streams, p95 turn latency, req/s,
  and Redis `connected_clients`.
- The binding constraint at the top level is named, with the observation that identified it.
- The abandon-sweep-across-3-workers count is recorded as an observed number.
- No file outside `loadtest/results/` and this task's `## Notes` changed.

## Verification
```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d
docker compose logs api | grep -i "speech provider"     # must name the fake one

for n in 10 25 50 100; do
  MAX_VUS=$n RESULT_NAME=compose-1x-room-$n k6 run loadtest/live-interview.js
  redis-cli -p 6380 info clients | grep connected_clients
done
MAX_VUS=200 RESULT_NAME=compose-1x-browse k6 run loadtest/http-browse.js

docker compose up -d --scale worker=3
docker compose logs -f worker | grep -ci "abandon"      # over one full sweep interval
```

Expect: five JSON files in `loadtest/results/`, a `connected_clients` figure that tracks VU count
roughly 1:1, and an abandon-sweep count of 1 per interval regardless of the three replicas.

Cleanup: `docker compose down -v`.

## Notes
