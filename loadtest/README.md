# loadtest

Three questions, one harness: does an extra `api` replica carry more traffic (**scaling**), where
does a request spend its milliseconds (**latency**), and what does one replica hold before it
stops answering in time (**performance**).

Everything printed in the PDF comes from a JSON file in `results/`. Nothing is transcribed from a
terminal, and nothing is typed in by hand.

## What is in here

| File | What it is |
|---|---|
| `lib.mjs` | The scenarios, the closed-loop generator, the percentile maths, the docker/psql/redis readers |
| `scale.mjs` | The run: scales `api` to each replica count, drives every scenario, collects the evidence, writes one JSON |
| `report.mjs` | JSON → `report.pdf`. Reads the newest `results/scale-*.json` unless given a path |
| `results/*.json` | The evidence. Committed on purpose — a number nobody can re-read is not a result |

## Prerequisites

- Docker with at least 4 CPUs given to the VM; the numbers scale with what Docker was given, not
  with what the laptop has.
- A `.env` at the repo root (`cp .env.example .env`) and a seeded database
  (`npm run seed` — the run signs in as `admin@demo.com` and reads that account's interviews).

## Running it

```bash
docker compose -f compose.yaml -f compose.scale.yaml up -d --wait
node loadtest/scale.mjs --replicas=1,2,4 --connections=8,64 --duration=12000 --warmup=3000 \
  --out=loadtest/results/compose-scale.json
node loadtest/report.mjs loadtest/results/compose-scale.json --out=loadtest/report.pdf
```

Every flag has a default; `node loadtest/scale.mjs` alone runs the matrix above. `--scenarios` takes
a comma-separated subset (`healthz,readyz,me,my-interviews,interview-state,web-home`).

`compose.scale.yaml` is what makes the stack scalable: it publishes Postgres and Redis so the
harness can read `pg_stat_database` and `INFO clients`, pins the Prisma pool per process
(`SCALE_DB_POOL`, default 10) so N replicas cannot exhaust `max_connections`, and forces
`AI_ENABLED=false` and `LOG_TRANSPORT=stdout` so a run bills nobody and does not depend on
Elasticsearch being up. It deliberately does **not** publish `api:4000` — a published port is what
stops `--scale api=N` from starting a second replica.

Credentials come from `LOADTEST_EMAIL` / `LOADTEST_PASSWORD`, defaulting to the seeded demo admin.

## The profiler

`backend/src/lib/profiler.ts` times every request in the API process and keeps a bounded sample per
route pattern (`GET /interviews/:id/state`, never the concrete id). Two admin routes read it:

```
GET  /admin/perf         the snapshot for the replica that answered
POST /admin/perf/reset   returns that snapshot and starts a new window
```

Each replica answers for itself, so the harness calls through the edge until it has seen every
instance id — `X-Instance` on every response is how a reply is attributed to a replica. The id is
the first 8 hex of the SHA-256 of the container hostname: stable for the life of the container,
and it discloses nothing about the host.

The snapshot carries per-route count, status classes, p50/p75/p90/p95/p99/max, event-loop delay
percentiles, CPU time and RSS for the window. Client-side latency minus server-side latency is the
edge and the network; the report prints both.

## What the numbers are not

- **Closed loop.** Each connection holds one request in flight and starts the next when the last
  one lands. A slow server therefore receives less traffic, which understates queueing delay
  compared with an open-model generator. No coordinated-omission correction is applied.
- **Same machine.** The generator, the edge, the replicas, Postgres and Redis all share one Docker
  host. `runs[].generator.coreUtilisationPct` is in the JSON so a run where the generator itself
  was the ceiling is visible rather than assumed.
- **One account.** Every authenticated request carries one session for one user, so the session and
  user rows are always hot in Postgres' cache. A real population would be colder.
- **Providers stubbed.** `AI_ENABLED=false`. Nothing here measures a model, a voice provider, or
  the conductor loop that calls them.
- **The web tier is not scaled.** `web-home` is the control: scaling `api` should not move it.
- **One run per cell.** No repeats, no confidence intervals.

Live SSE rooms are not exercised here. The per-stream `redis.duplicate()` in
`backend/modules/interview/sse.ts` is the documented concurrency ceiling and belongs to the
`platform` ledger's own tasks (P03/P04), which own that scenario.
