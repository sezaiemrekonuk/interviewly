# I14 — Reliability probes: `/healthz`, `/readyz`

Date: 2026-08-04 · Session: Sezai (Sonnet)

## What changed
- `backend/src/lib/probes.ts` (new): `liveness()` (pure, `{ok:true}`), `readiness()`
  (Postgres `SELECT 1` + Redis `PING`, each timeout-bounded at 2s, both must resolve).
  Pings go through the existing clients (`prisma` from `db.ts`, `redis` from
  `modules/auth/rate-limit.ts`) — no new connections.
- `backend/src/app.ts`: `/healthz` → 200 `{ok:true}`, no dependency checks. `/readyz` → 200
  `{ready:true}` or 503 `{error:{code:'NOT_READY'}}`. Both mounted before `requireAuth`.
- Test seam `setProbeOverrides({pingPostgres?, pingRedis?})` (mirrors `setEmailQueue`).
  `{}` resets to real pings; wired into `server.ts`'s per-scenario `Before` hook so a forced
  outage never leaks into the next scenario.
- `backend/features/step_definitions/reliability.steps.ts` (new): `Given('{word} is
  unreachable', ...)` flips one ping to a rejecting stub; `Given('Postgres and Redis are
  reachable', ...)` is a no-op reset (the `Before` hook already guarantees it).
- `cucumber.js`: `reliability.feature` was authored in Stage 2 but absent from the `default`
  profile's path allow-list — added it. Without this, `--tags @reliability` silently matched
  0 scenarios and passed vacuously (EXECUTE.md §7's false-green trap).

## Verification
```
npm run test:acceptance -- --tags "@reliability"
```
3 scenarios, 3 passed. `npx tsc --noEmit` and `npm run lint` (touched files) clean.

## Trap avoided
`/healthz` intentionally does not import `probes.ts`'s dependency checks — kept `liveness()`
dependency-free so a Postgres/Redis blip cannot restart-loop a live process.
