# P06 — Fly scale runs: 1, 2, 4, 8 api machines, and which resource actually stopped each one
REPO: (this repo) · Depends: P04, P05 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — `fly scale count`, run the harness, transcribe JSON. The one
judgement has a mechanical check written into the steps.

## Goal
Owner's ask:

> If I want to deploy my system in fly and use also kuberneets and with fake routing show my
> scale level and note it in docs what would i need

The first real scale table. Real Fly Proxy balancing across real machines, driven by P03's
scenarios with P02's stubbed providers, at four api machine counts.

The result this task most needs to get right is not the concurrency figure. It is **which resource
ended each run** — because ADR-P09 predicts that above some level the answer stops being api
machines and becomes Upstash connections, and a table that does not notice the switch implies a
knob that has stopped working.

## Non-negotiables
- **Run the generator from a Fly machine in the same region as the app.** From a laptop the numbers
  measure a home uplink, and thousands of long-lived SSE connections from one host hit local
  ephemeral-port and file-descriptor limits well before the server notices anything.
- **The load-test profile is set per run and removed after.** `LOADTEST=1`, `AI_ENABLED=false`,
  `SPEECH_PROVIDER=fake` on the api and worker apps for the duration; unset when the runs finish.
  P02's guard means a half-applied profile refuses to boot rather than half-running — check the
  boot log names the fake provider before trusting a run.
- **Record the Upstash connection count at every level.** If it plateaus at the plan cap, that is
  the ceiling and the api machine count is no longer the variable being measured. Say so in the
  row rather than reporting a flat concurrency curve as if the app stopped scaling.
- **Same sha as P05.** `fly deploy --image` with P01's tag, never a rebuild between levels.
- **Only the api count changes.** web, worker and edge stay at their P05 counts across all four
  levels, so the table has one variable. Note their fixed values in `## Notes`.
- **Do not tune.** No machine size changes, no Postgres plan changes, no `REPORT_CONCURRENCY`. A
  tuned run is a different experiment, and it belongs in the Backlog with its own trigger.

## Context (anchors)
- `loadtest/` — P03's scripts; `RESULT_NAME` names the output file.
- P04's `## Notes` — the compose baseline and the resource that ended it. If Fly at 1 machine is
  wildly different from compose at 1 replica, something in the deploy differs from the local stack
  and finding out is part of this task.
- `backend/modules/interview/sse.ts:180` — the per-stream `redis.duplicate()`; ADR-P09.
- `compose.yaml` → `cache` comment — `noeviction` is deliberate, and under memory pressure Redis
  refuses writes rather than degrading. On Upstash the equivalent failure is a refused connection.
  Both look like an application error from the client side; check the store before blaming the app.
- ADR-P08 — the worker does not autoscale, by decision. Do not add an autoscaler to make the table
  look better.

## Steps
- [ ] Bring up a small Fly machine in the app's region as the load generator; install k6 and clone
      the repo (or copy `loadtest/`).
- [ ] Apply the load-test profile to the api and worker apps; confirm both boot logs name the fake
      speech provider.
- [ ] Set `BASE` = twice the concurrency at which P04's compose baseline degraded, so the n=1 run
      is guaranteed to reach a ceiling rather than idle below one. Record the value; every level
      uses `MAX_VUS = BASE × n`.
- [ ] For each api machine count in 1, 2, 4, 8: `fly scale count api=N`, wait for all machines
      healthy, run `live-interview`, then `http-browse`. Two result files per level, named
      `fly-{N}x-room` and `fly-{N}x-browse`.
- [ ] At each level record: sustained concurrent streams, p95 turn latency, req/s, p95 HTTP,
      Upstash connection count at steady state, and api machine CPU.
- [ ] For each level, name the resource that ended the run and the observation that identified it.
      The mechanical check: if Upstash connections plateaued while api CPU still had headroom, the
      ceiling is Redis, and the row says so.
- [ ] Remove the load-test profile from both apps and confirm they boot back into the live
      configuration.
- [ ] Scale down to the idle configuration (or `count 0`) so the runs stop billing. Record the run
      cost in `## Notes`.

## Definition of done
- Eight result files in `loadtest/results/` named `fly-{1,2,4,8}x-{room,browse}`, at P05's sha.
- Every level has a named binding resource, not a description of slowness.
- The api and worker apps are back on the live configuration, verified by a boot log naming the
  real speech provider.
- `SCALE.md` does **not** exist yet — P09 writes it.

## Verification
```bash
fly status -a interviewly-api                        # machine count and health
fly logs -a interviewly-api | grep -i "speech provider"

# MAX_VUS per level: start at 2× P04's compose ceiling for n=1 and double with n.
for n in 1 2 4 8; do
  fly scale count api=$n -a interviewly-api
  MAX_VUS=$(( BASE * n )) RESULT_NAME=fly-${n}x-room   k6 run loadtest/live-interview.js
  MAX_VUS=$(( BASE * n )) RESULT_NAME=fly-${n}x-browse k6 run loadtest/http-browse.js
done

ls loadtest/results/fly-*                            # expect 8 files
```

Expect eight files and a per-level note. Then confirm the profile is off:

```bash
fly logs -a interviewly-api | grep -i "speech provider" | tail -1
```

Must name `ElevenLabsSpeech`, not the fake. A run that ends with the fake provider still active on
the live app is not finished, whatever the table says.

## Notes
