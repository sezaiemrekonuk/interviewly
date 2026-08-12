# P05 — Fly deploy

2026-08-12 · Ahmet · claude-opus-5 · darwin 25.5.0 host, flyctl v0.4.80, org `personal`, region `fra`
Status at end of session: **`in_progress`**. Live at https://interviewly-edge.fly.dev

## Why this task, out of order

The owner had roughly 1.5 hours and asked for the Fly deploy specifically, over the critical path
(`P02 → P03 → P04 → P06 → P09`). That is a real trade and it is recorded rather than smoothed over:
the deploy does not advance the thing the ledger is actually for. P06 still cannot run, because it
needs P04's single-replica baseline, which needs P03's harness, which needs P02's provider profile.

P01 was skipped with it, so there are no GHCR images and all four apps build on Fly's remote builder.
The Fly stack is self-consistent; it is not byte-comparable with a future `kind` run. **ADR-P06 does
not hold** until P01 lands.

## What was built

`fly/` — four `fly.toml` files, a thin edge image wrapping the root `Caddyfile` with `.internal`
upstreams, a `.env.fly.example` template and a runbook. No application code, no `Dockerfile`, no
`Caddyfile` behaviour changed. Managed dependencies: Fly Managed Postgres (Basic), Upstash Redis
(eviction disabled, matching compose's `noeviction` per issue #72), a public Tigris bucket.

Only the edge has a public IP. api and web have no `[http_service]` at all — reachable directly,
the api would see an X-Forwarded-For chain one hop shorter than `TRUST_PROXY=2` expects, and the
rate limiter would key on the wrong address for exactly the requests that bypassed the edge.

## What went wrong, and what it teaches

Two failures produced **a green machine serving 502s**, which is the shape worth remembering:

- **`HOSTNAME=0.0.0.0` binds IPv4 only; Fly's private network is IPv6.** Next logged
  `Network: http://0.0.0.0:3000`, Fly's health check passed (it reaches the machine over IPv4), and
  every page 502'd. The reason existed in exactly one place — the edge's own log:
  `dial tcp [fdaa:…:3418:2]:3000: connect: connection refused`. Fixed with `HOSTNAME = "::"`.
  compose is right to use `0.0.0.0`; the Docker bridge is IPv4. Only `web` was affected because
  Node's bare `listen(port)` is already dual-stack, which is why the api never showed it.
- **Caddy's `dynamic a` asks for A records**, and `.internal` publishes AAAA only. Caught before
  deploying by reading Fly's DNS behaviour rather than by debugging a 502; `versions ipv6` fixes it.
  Had it shipped, the symptom would have been an empty upstream set with no dial error at all.

The general lesson: **on Fly, a passing health check does not mean a reachable service**, because
the check and the client take different network paths. The edge's log was the only witness.

Also worth carrying forward:

- `[build] dockerfile` resolves relative to the **config file**, not the build context.
- `SHADOW_DATABASE_URL` must differ from `DATABASE_URL` or `migrate deploy` refuses — a config
  validation, not a connection, and it never touches the shadow database.
- PgBouncer was expected to break Prisma migrations and did not. `fly mpg attach` hands back a
  pooler endpoint and `migrate deploy` ran through it cleanly: 21 migrations, exit 0. No
  `directUrl` added to `schema.prisma`, so no schema change was needed.

## The worker check, and a deliberate decision not to fix it

`worker/src/health.ts:66` binds `127.0.0.1`. Under compose this works because Docker execs the
healthcheck *inside* the container; Fly probes from the host and gets `connection refused` forever,
holding every deploy at `1 critical` while the process is provably fine — `WORKER_STARTED`, then an
abandon sweep that scheduled and completed against both Redis and Postgres.

Binding `0.0.0.0` would fix the probe and is an application code change, which this task forbids.
So the check was removed and the worker's liveness signal on Fly is its logs. **This is a Fly
limitation, not a defect in the worker**, and P07 does not inherit it: a Kubernetes probe runs
against the pod's own network namespace, where loopback is reachable. Recorded here so nobody
"fixes" `health.ts` for the wrong reason later.

## The `.env.fly` near-miss

`.env.fly` was pasted over with the contents of `.env` and caught before the first deploy. Four of
the overwrites fail silently: `LOG_TRANSPORT=elastic` against no Elasticsearch, two `NEXT_PUBLIC_*`
keys reappearing as runtime env (the exact illusion P05's non-negotiable names), and
`S3_REGION=us-east-1` against Tigris. Only the `SESSION_SECRET` placeholder would have failed loudly
(`env.ts:135`).

This is an argument for the posture `compose.yaml` already takes with `${VAR:?}`: a deploy that
cannot name its own values should not start. `fly.toml` has no equivalent, so the check was a human
reading a diff — which is exactly the control that does not scale.

## Cost, which nobody had bounded

Managed Postgres Basic is **$38/month**, standing, whether or not anything runs. Upstash is
pay-as-you-go at **$0.20 per 100K commands**, and Fly's own CLI warns that BullMQ polls frequently —
this stack is BullMQ *and* opens one Redis connection per SSE stream. **A P06 load run on this plan
has no cost bound.** The Fly-billing blocker in STATE.md was closed by spending rather than by
agreement; the ceiling question is now retroactive and still needs an answer.

ADR-P09's number — the Redis connection limit — was **not obtained**. `fly redis status` does not
report it. Without it, P06's tables cannot be read as anything but replica counts.

## Left unverified, deliberately named

The SSE stream through the edge (`flush_interval -1` is configured and was never exercised — and
P06 depends on it), `/assets/*` (the bucket is empty, so the rewrite is untested; the 403 on
`/assets/` is an anonymous list denial and proves nothing), the `kill_timeout` drain check, and the
browser walk-through with it the `Secure` cookie flag and whether SMTP delivers.

Two owner decisions are open: Google sign-in is armed but its redirect URI is unregistered for the
new origin, and SMTP is Gmail rather than Resend, which works only with an App Password.
