# Platform — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-P entry referenced here.
Codebase orientation: `REFERENCE.md` (read that before touching any task).
Spec: `.agents/specs/2026-08-12-platform.md`.

## Goal

The system deploys to Fly.io behind real load balancing, and the same commit deploys to a local
`kind` cluster with real Deployments, Services, Ingress and an HPA. Synthetic traffic drives both,
and `SCALE.md` states what each replica count actually holds — concurrent live interviews, req/s,
p95 — together with the ceiling that replica count does not move.

Today the answer to "what does this hold" is nothing at all: one VM, one process per service,
never measured. IDEA.md §13 already requires a physical deployment diagram in the delivered
`DECISIONS.md`. This ledger is what stops that diagram being a diagram of an aspiration.

## The invariant this initiative must not weaken

> No scale measurement may change what the application does to a real candidate, and no
> load-test artefact — stubbed provider, seeded user, flushed store — may be reachable from a
> production boot.

The traffic is fake and the routing is real. Everything this ledger adds is either outside the
request path (manifests, workflows, k6 scripts) or behind a switch that refuses to arm itself in
production and says so out loud at startup. If a scale finding requires an application change,
that is a **finding** — it goes into `SCALE.md` and the Backlog, not into a task here.

## Topology

What changes. `edge`, `web`, `api`, `worker` are the same four images in all three columns.

```
  compose (today)              Fly (P05)                     kind (P07)
  ───────────────              ─────────                     ──────────
  :80 caddy ─┬─ web:3000       fly proxy ─ edge app ─┬─ web   ingress-nginx ─┬─ web svc
             ├─ api:4000       (TLS, anycast)        ├─ api   (buffering off)├─ api svc ─ HPA
             └─ bucket:9000                          └─ tigris                └─ bucket svc
  worker (no ports)            worker app (n fixed)          worker deploy (n fixed)
  db  postgres:16              Fly Postgres (1 node)         db deploy + PVC
  cache redis:7                Upstash Redis  ◄── the ceiling  cache deploy + PVC
  mail mailpit                 SMTP (Resend)                 mailpit deploy
  migrate (compose job)        [deploy] release_command      migrate Job (ttlSeconds)

  load: k6 from an in-region machine ──► the public hostname of either target
        providers stubbed at fixed latency (P02), routing untouched
```

The arrow marked *the ceiling*: every open SSE stream holds its own Redis connection
(`sse.ts:180`), so concurrent interviews are bounded by the Redis connection cap before they are
bounded by api replicas. ADR-P09.

## Decision table (full ADRs in DECISIONS.md)

| # | Decision | Chosen | Reason |
|---|----------|--------|--------|
| P01 | Does this repo get Kubernetes and multi-replica at all? | Yes, for measurement — production stays as IDEA.md §11 left it | "What does it need to run" and "what does it hold" are different questions; only the second needs a second replica |
| P02 | Where does each target run? | Fly.io live, Kubernetes on local `kind` | Real orchestration without a managed-cluster bill; the app is identical on both |
| P03 | Who owns path routing on Fly? | Caddy, as a fourth Fly app | Four behaviours (`/api` strip, SSE flush, bucket rewrite, `Vary`) stay in one reviewed file |
| P04 | Fly process groups or separate apps? | Four separate apps | The worker has no ports and must not share a scale count with HTTP concurrency |
| P05 | Stateful dependencies on Fly? | Managed: Fly Postgres, Upstash, Tigris, SMTP | All protocol drop-ins; no application code changes, only env |
| P06 | How do both targets get images? | GHCR, tagged by commit sha, side-loaded into kind | Two targets on different images makes the comparison unfalsifiable |
| P07 | What do providers do under load? | Stubbed, with **injected** latency, behind a loud guard | Real calls measure the provider's queue and bill for it; instant stubs measure a turn loop that does not exist |
| P08 | What autoscales? | HPA on api only; worker replicas fixed | The worker is LLM-bound and idles at low CPU exactly when it should scale up |
| P09 | The SSE Redis-connection ceiling? | Measure and name it; do not fix it here | The fix is a refcounted subscriber map — real risk, and no number yet says what it buys |
| P10 | Manifest tooling? | kustomize; Deployments + PVC, not Helm or StatefulSets | Two overlays, no chart consumers, and nothing in the stack clusters |

## Data model additions

**None.** No migration in this ledger. `prisma migrate deploy` moves from the compose `migrate`
service to Fly's `[deploy] release_command` and to a Kubernetes `Job`, but the schema it applies
is whatever `master` already carries.

## What "scale level" means here

Two numbers per target per replica count, and one ceiling that belongs to neither.

- **Concurrent live interviews** — the k6 `live-interview` VU count at which p95 turn latency
  crosses its threshold. Each VU registers, creates an interview, **holds its SSE stream open**,
  and answers on a timer. This is the figure the product actually cares about.
- **req/s and p95** — from `http-browse`, the ordinary request path, no long-lived connections.
- **The ceiling** — Redis connections, one per open stream. Reported before either table so the
  tables are not read as a promise about a knob that is not the binding one.

Every figure is transcribed from a JSON file under `loadtest/results/`, never from a terminal.

## Phasing / task clusters (see STATE.md ledger)

0. **Make the load honest** (P02–P04) — the provider seam, the k6 scenarios, the single-replica
   compose baseline every later number is compared against.
1. **Ship the images** (P01) — GHCR, three images, one sha. Independent of cluster 0; either can
   go first.
2. **Fly** (P05–P06) — deploy, then scale and measure.
3. **Kubernetes** (P07–P08) — manifests, then HPA and measure.
4. **Write it down** (P09) — `SCALE.md`: the ceiling, both tables, the diagrams, and an explicit
   account of what was stubbed.

## Out of scope (post-platform)

- **Fixing the SSE connection ceiling.** Named by P09; a separate task once a number justifies it.
- **KEDA / queue-depth autoscaling.** The right tool for the worker, and a second control loop to
  debug in an initiative that currently has none.
- **Multi-region, Helm charts, Terraform, a managed cloud cluster.**
- **Running the Cucumber acceptance ring against a cluster.** `tests/smoke/` gets a deployed-URL
  variant; the ring keeps running against compose, where it is fast and hermetic.
- **Any change to application behaviour**, including performance fixes this ledger's own
  measurements suggest.
- **Production traffic.** Nothing here implies the Fly deployment is where real candidates go.
