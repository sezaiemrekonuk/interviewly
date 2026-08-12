# P03 — k6 harness: browse, and a room that holds its stream open
REPO: (this repo) · Depends: P02 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — new files, no production code touched. A wrong scenario produces an
obviously wrong number rather than a plausible one.

## Goal
Owner's ask:

> If I want to deploy my system in fly and use also kuberneets and with fake routing show my
> scale level and note it in docs what would i need

The fake traffic. Two k6 scenarios that every later task points at whatever target it just brought
up: `http-browse` for req/s and p95 on the ordinary path, and `live-interview` for the number this
product actually cares about — how many rooms are open at once before turns get slow.

P04 runs these against compose, P06 against Fly, P08 against kind. This task is done when they run
and produce a result file, not when they produce a good number.

## Non-negotiables
- **Lowercase `k6`, always.** This repo already uses `K6`, `K9`, `K13` as constraint ids from
  IDEA.md — one of them, `K6`, appears in a sentence about observability. Uppercase here is
  genuinely ambiguous.
- **`live-interview` holds the SSE stream open for the life of the interview.** A scenario that
  opens, reads one frame and closes is measuring connection churn, not concurrency. The held
  streams *are* the load.
- **Every VU refetches `/state` after each event.** `frontend/src/lib/use-interview-events.ts` is
  the contract: the SSE frame says only *that* something changed, and the client always refetches
  for *what*. A VU that skips the refetch generates a fraction of the real request load and
  overstates every number that follows.
- **Results go to a file, never to a terminal.** `loadtest/results/{target}-{replicas}.json`, so
  P09 transcribes from files. A number quoted from a closed terminal is not reproducible.
- **The harness never seeds through the database.** VUs register through the public API like a real
  user, so signup, verification bypass and session issue are all in the measured path.
- **No production code changes.** If a scenario cannot be written without one, that is a finding
  for `## Notes`.

## Context (anchors)
- `.env.example` → `EMAIL_VERIFICATION_REQUIRED` — set it false for load runs, or every VU blocks
  on a Mailpit inbox. Note it in the harness README rather than assuming a future session knows.
- `frontend/src/lib/use-interview-events.ts` — the event → refetch contract the VU imitates.
- `backend/modules/interview/sse.ts:180` — one Redis connection per stream. This is what the
  scenario is really exercising; ADR-P09.
- `backend/src/app.ts:63,66` — `/healthz` and `/readyz`, useful as a warm-up ping before a ramp.
- `tests/smoke/auth.spec.ts` — the existing smoke test, for the auth request shapes.
- `backend/AGENTS.md` — route layout, so the scenario calls real paths rather than guessed ones.
- `Caddyfile` — everything goes through `:80`, `/api/*` prefix stripped. VUs hit the edge, never a
  service port.

## Steps
- [ ] `loadtest/README.md`: how to run each scenario, the env it needs (`LOADTEST=1`,
      `AI_ENABLED=false`, `SPEECH_PROVIDER=fake`, `EMAIL_VERIFICATION_REQUIRED=false`), and the
      warning that a generator on a laptop measures the laptop.
- [ ] `loadtest/http-browse.js` — ramping VUs, anonymous landing → register → login → listing.
      Threshold on `http_req_duration p(95)`.
- [ ] `loadtest/live-interview.js` — per VU: register, log in, create an interview, open the SSE
      stream and **keep it open**, refetch `/state` on each event, submit an answer on a timer
      until the interview ends, then close.
- [ ] Tag the turn request separately (`tags: { op: 'turn' }`) so p95 turn latency is extractable
      from the summary rather than averaged into every other request.
- [ ] Write `handleSummary` to `loadtest/results/${__ENV.RESULT_NAME}.json`, and fail the run
      loudly if `RESULT_NAME` is unset — an unnamed result file is a result nobody can attribute.
- [ ] **Both scripts take their ceiling from `MAX_VUS` and build their own `stages` from it** —
      ramp up over 1 minute, hold, ramp down. Do not rely on `--vus`: a script that declares
      `stages` ignores it, and a later task passing `--vus 100` to a script pinned at 10 would
      produce a confidently mislabelled result file. Fail the run if `MAX_VUS` is unset.
- [ ] Add `loadtest/results/` to `.gitignore`? **No** — commit the result files. They are the
      evidence behind `SCALE.md` and belong in review.
- [ ] Run both against a local compose stack at low VU counts (5 and 10) purely to prove the
      scenarios work end to end. The real baseline is P04's job, not this one's.

## Definition of done
- Both scripts run to completion against a local stack and write a JSON summary naming the
  scenario, VU count and thresholds.
- `live-interview` at 10 VUs shows 10 concurrent open streams on the server for the duration —
  confirm on the Redis side, not by trusting k6 (see Verification).
- A run started without `RESULT_NAME` fails immediately with a named message.
- No file outside `loadtest/` changed.

## Verification
```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d
MAX_VUS=10 RESULT_NAME=p03-selftest-browse k6 run loadtest/http-browse.js
MAX_VUS=10 RESULT_NAME=p03-selftest-room   k6 run loadtest/live-interview.js
MAX_VUS=10                                 k6 run loadtest/live-interview.js   # must fail: no RESULT_NAME
```

Both must exit 0 and leave a file in `loadtest/results/`. While the room run is going, in a second
shell:

```bash
redis-cli -p 6380 -n 0 info clients | grep connected_clients
```

Expect roughly 10 above the idle baseline — that is the per-stream `duplicate()` from
`sse.ts:180`, and seeing it here is what makes P09's ceiling claim a measurement rather than a
reading of the source. Record the idle baseline and the loaded figure in `## Notes`.

Cleanup: `docker compose down -v`.

## Notes
