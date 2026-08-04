# I14 — Reliability probes: `/healthz`, `/readyz`
REPO: (this repo) · Depends: F02, F03 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — two unauthenticated probes over the existing Postgres and Redis clients. Mechanical; the only care is that liveness must not touch dependencies.

## Goal
Owner's ask:

> "`GET /healthz` (liveness, 200, no dependency checks) and `GET /readyz` (checks Postgres
> and Redis, 200 when both reachable, 503 `NOT_READY` when either is down). Scenario AC-19 in
> `reliability.feature` green."
> — interview-core decomposition (§7.4)

This task adds the two probe routes. No auth, no rate limit.

## Security boundaries
- **Probes expose no internals.** `/readyz` returns `NOT_READY` on failure — never the
  underlying connection error, DSN, or stack. `/healthz` returns only liveness.

## Non-negotiables
- **`GET /healthz`** → 200 `{ ok: true }`, **no dependency checks** (it must stay green even
  when Postgres/Redis are down, so an orchestrator does not kill a live process during a
  transient dependency blip).
- **`GET /readyz`** → pings Postgres **and** Redis; both reachable → 200 `{ ready: true }`;
  either unreachable → 503 `NOT_READY` (`reliability.feature` @AC-19, both `Postgres` and
  `Redis` example rows).
- **Both routes are unauthenticated** and mounted before `requireAuth`.

## Context (anchors)
- `backend/src/lib/probes.ts` — **create.** `liveness()` (pure, returns ok) and `readiness()`
  (runs a cheap Postgres query, e.g. `SELECT 1`, and a Redis `PING`; both succeed → ready,
  any throw/timeout → not ready). Bound each check with a short timeout so a hung dependency
  yields 503, not a hang.
- `backend/src/app.ts` — A01. Mount `GET /healthz` and `GET /readyz` before the auth-guarded
  routers.
- `backend/src/lib/db.ts` — F02 `prisma` (Postgres ping).
- `backend/src/lib/env.ts` — F03 Redis client (`PING`).
- `backend/src/lib/error-codes.ts` — F01. `NOT_READY`.

  **The trap:** `/healthz` must **not** check Postgres or Redis. If liveness depended on the
  database, a dependency outage would make orchestrators restart-loop a healthy API. Keep
  dependency checks in `/readyz` only.

## Steps
- [x] **1. Write `probes.ts`** — `liveness()` and `readiness()` (Postgres `SELECT 1` + Redis
  `PING`, each timeout-bounded).
- [x] **2. Mount** `GET /healthz` and `GET /readyz` in `app.ts` before auth, returning 200 /
  503 `NOT_READY`.
- [x] **3. Wire acceptance step-defs** for `reliability.feature` @AC-19 (`/healthz` → 200;
  both deps reachable → `/readyz` 200; Postgres down → `/readyz` 503 `NOT_READY`; Redis down →
  `/readyz` 503 `NOT_READY`).
- [x] **4. Run the `## Verification` command.**

## Definition of done
- `GET /healthz` returns 200 with no dependency checks.
- `GET /readyz` returns 200 when Postgres and Redis are both reachable and 503 `NOT_READY`
  when either is down, with no internal detail leaked.

## Verification
```bash
npm run test:acceptance -- --tags "@reliability"
```

## Notes
- `probes.ts` pings via existing clients: `prisma` (F02) and `redis` from
  `modules/auth/rate-limit.ts` — no new Redis client.
- Test seam `setProbeOverrides({ pingPostgres?, pingRedis? })`, same shape as
  `setEmailQueue`. `{}` resets both to real pings; wired into `server.ts`'s `Before` hook so
  no scenario leaks a forced-down probe into the next.
- `reliability.feature` was authored (Stage 2) but missing from `cucumber.js`'s `default`
  allow-list — added it there; that's why `--tags @reliability` matched 0 scenarios at first.
- `/healthz` body changed `{status:'ok'}` → `{ok:true}` per this task's spec; nothing else
  asserted on the old shape (grepped).
