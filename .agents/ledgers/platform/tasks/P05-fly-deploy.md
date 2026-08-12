# P05 — Fly: four apps, managed dependencies, and the three settings that fail silently
REPO: (this repo) · Depends: P01 (**skipped** — see Notes) · Status: in_progress
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — real credentials, a real hostname, and a release command running
`prisma migrate deploy` against a real database. Three of its settings fail quietly rather than
loudly.

## Goal
Owner's ask:

> If I want to deploy my system in fly and use also kuberneets and with fake routing show my
> scale level and note it in docs what would i need

The live target. Four Fly apps — `interviewly-edge`, `interviewly-web`, `interviewly-api`,
`interviewly-worker` (ADR-P04) — running P01's images, with managed Postgres, Redis, object storage
and SMTP (ADR-P05), behind the existing Caddyfile moved across as the edge (ADR-P03).

This task ends when the app works at one machine each. P06 scales it.

## Non-negotiables
- **`kill_timeout = 15` on the api app.** Fly's default is 5s. `compose.yaml` sets
  `stop_grace_period: 15s` deliberately above the API's own 10s drain ceiling, for issue #70 —
  below it, a deploy SIGKILLs machines mid-answer and the only symptom is candidates losing turns
  during a release.
- **`NEXT_PUBLIC_*` are build arguments and must not appear in `fly secrets`.** They were inlined
  when P01 built the image. Setting them as secrets creates the illusion of configuration while the
  bundle keeps the fallbacks.
- **`TRUST_PROXY` and `SESSION_COOKIE_SECURE` must be set for a real TLS proxy.** Left at their
  compose values, rate limiting keys on the proxy's IP instead of the client's, and the session
  cookie ships without `Secure` over a public origin.
- **`AI_ENABLED=true` and `SPEECH_PROVIDER` unset on this deploy.** P02's guard makes the fake
  configuration explicit; this task must not quietly ship a load-test profile as the live app. The
  load-test env belongs to P06's runs.
- **A mail sink is mandatory.** Registration always enqueues a mail; a stack without SMTP
  dead-letters a job on the first signup. Mailpit is not deployed — configure real SMTP.
- **The Caddyfile moves, it does not get rewritten.** Change upstream hostnames to `.internal` and
  nothing else. All four of its load-bearing behaviours are listed in REFERENCE.md, and each fails
  in its own way.
- **No `Dockerfile`, no `Caddyfile` behaviour, no application code changes.** Deploy config only.

## Context (anchors)
- `Caddyfile` — the whole routing surface. `handle_path /api/*`, `flush_interval -1`,
  `/assets/*` bucket rewrite, `Vary` on negotiated paths, and the split `log` blocks from issue 134.
- `compose.yaml` → `api.stop_grace_period` (15s, issue #70) and the `web.build.args` block.
- `backend/src/app.ts:63,66` — `/healthz` (no dependencies, liveness) and `/readyz` (checks both,
  readiness). Fly `[[http_service.checks]]` points at `/readyz`.
- `worker/src/health.ts:54` — `GET /healthz` on `WORKER_HEALTH_PORT`, no public port.
- `backend/prisma/schema.prisma` — the release command needs the explicit `--schema` path, because
  the image WORKDIR is the workspace root (F02).
- `.env.example` — every key, with the compose-vs-deployed mapping in REFERENCE.md.
- `db/init.sql` — runs as a Postgres init script under compose. **Check whether managed Postgres
  needs its contents applied by hand**; it will not run automatically.

## Steps
- [ ] Create the managed dependencies: Postgres, Upstash Redis, a Tigris bucket, and an SMTP
      sender. Record every connection string into a local, gitignored `.env.fly` — never into the
      repo.
- [ ] Apply `db/init.sql` to the managed database if it carries anything the Prisma migrations do
      not (roles, extensions, grants). Record what you found either way.
- [ ] Write four `fly.toml` files under `fly/`: `edge`, `web`, `api`, `worker`. api carries
      `kill_timeout = 15`, an `http_service` check on `/readyz`, and
      `[deploy] release_command = "npx prisma migrate deploy --schema backend/prisma/schema.prisma"`.
      worker declares no services.
- [ ] Point the edge's Caddyfile upstreams at `interviewly-api.internal:4000`,
      `interviewly-web.internal:3000` and the Tigris endpoint; ship it as a config mount or a thin
      image, whichever keeps the file itself unedited.
- [ ] `fly secrets import` per app from `.env.fly`, with `TRUST_PROXY` and `SESSION_COOKIE_SECURE`
      set for TLS and the three `NEXT_PUBLIC_*` keys **excluded**.
- [ ] Deploy all four at P01's sha with `--image`, at one machine each. Confirm the release command
      ran the migration before the new version served.
- [ ] Seed the demo account and walk one interview end to end in a browser: signup mail arrives,
      login works, the room streams, an avatar loads from `/assets/`, a report renders.

## Definition of done
- The public hostname serves the app over TLS; `/api/*`, `/assets/*` and the SSE stream all work
  through the edge.
- `fly logs -a interviewly-api` shows the release command running `prisma migrate deploy` and
  exiting 0 before the new version took traffic.
- A deploy issued while an interview is mid-turn does not lose the turn (the `kill_timeout` check).
- The session cookie on the deployed origin carries `Secure`, and rate limiting keys on the client
  IP rather than the proxy's.
- No application code, `Dockerfile` or `Caddyfile` behaviour changed.

## Verification
```bash
fly status -a interviewly-edge && fly status -a interviewly-api \
  && fly status -a interviewly-web && fly status -a interviewly-worker

HOST=<the deployed hostname>
curl -sf https://$HOST/api/healthz
curl -sfI https://$HOST/assets/... | head -5          # a real asset path from the running app
curl -sN https://$HOST/api/interviews/<id>/events | head -c 200   # must stream, not buffer
fly logs -a interviewly-api | grep -i "migrate deploy"
```

Then live, in a browser on the deployed hostname: register → open the verification mail at the SMTP
provider → log in → start an interview → confirm the room updates without a manual refresh → open
devtools and confirm the session cookie has `Secure`.

Then the drain check: start an interview, and while a turn is in flight run
`fly deploy -a interviewly-api --image <same sha>`. The turn must complete.

Cleanup: `fly scale count 0` on all four apps if the deploy is not being kept warm for P06.

## Notes

Session 2026-08-12 (Ahmet, opus-5). Deployed from a darwin 25.5.0 host, flyctl v0.4.80, org
`personal` (ahmet-kilic-924), region `fra`. **Status: `in_progress`, not `done`** — the stack is
up and serving, four of the Definition-of-done bullets are unverified. They are listed at the end.

### Scope deviation: P01 was skipped

The owner chose to go straight to Fly, so there are no GHCR images. All four apps build on Fly's
remote builder from the same Dockerfiles. The Fly deployment is internally consistent, but
**ADR-P06 does not hold**: a later `kind` run is not byte-comparable with these numbers until P01
lands and both targets deploy one sha. Anything P06 measures here is a Fly number, not a
cross-target number. `fly/README.md` repeats this where a deployer will hit it.

### Seven things that were wrong on the first attempt

1. **`[build] dockerfile` resolves relative to the config file, not the build context.**
   `dockerfile = "backend/Dockerfile"` in `fly/api.toml` was looked up at `fly/backend/Dockerfile`.
   All four use `../` (the edge uses `edge/Dockerfile`); the build context is still the repo root.
2. **`HOSTNAME=0.0.0.0` on `web` binds IPv4 only, and Fly's private network is IPv6.** This is the
   one that would have cost a session. Next logged `Network: http://0.0.0.0:3000`, Fly's own health
   check passed — it reaches the machine over IPv4 — and every page returned 502, with the reason
   visible only in the edge's log: `dial tcp [fdaa:…:3418:2]:3000: connect: connection refused`.
   A green machine serving 502s. `HOSTNAME = "::"` binds dual-stack. compose is right to use
   `0.0.0.0`: the Docker bridge is IPv4. The api needs no equivalent — Node's `listen(port)` with
   no host argument is already dual-stack, which is why only `web` failed.
3. **Caddy's `dynamic a` needs `versions ipv6` against `.internal`.** Same root cause: Fly's
   internal DNS publishes AAAA only, and the module asks for A records by default. It would have
   resolved an empty upstream set on every refresh and 502'd with no dial error at all.
4. **`SHADOW_DATABASE_URL` must differ from `DATABASE_URL`, even though `migrate deploy` never
   uses a shadow database.** The release command failed with `The shadow database you configured
   appears to be the same as the main database.` — a config validation, not a connection. Pointed
   at `/fly-db-shadow` on the same cluster; nothing ever connects to it.
5. **The worker's health check is unimplementable on Fly and has been removed.**
   `worker/src/health.ts:66` binds `127.0.0.1` deliberately. Under compose the healthcheck works
   because Docker execs it *inside* the container; Fly probes from the host and gets
   `connect: connection refused` forever, holding the deploy at `1 critical` while the process is
   provably fine. Binding `0.0.0.0` is an application code change this task does not make, so the
   worker has no check and its liveness signal on Fly is its logs. **This does not carry to P07** —
   a Kubernetes probe runs against the pod's own network namespace, where loopback is reachable.
6. **`.env.fly` had been pasted over with `.env`.** Caught before the first deploy. Repaired:
   `SESSION_SECRET` was back to the `change-me` placeholder (`env.ts:135` would have refused the
   boot — loud), `LOG_TRANSPORT=elastic` with `ELASTICSEARCH_URL=http://elasticsearch:9200` (no
   Elasticsearch in this deployment — silent), `NEXT_PUBLIC_ASSETS_PREFIX` and
   `NEXT_PUBLIC_MASCOT_SHA256` present as runtime keys (silent, and exactly the illusion the
   non-negotiable names), `S3_REGION=us-east-1` against Tigris.
7. **Fly creates a standby machine per app automatically** (api, web, worker each have one,
   `stopped`). P06 must account for this before reading `fly scale count` as a replica count.

### PgBouncer: not the problem it was expected to be

`fly mpg attach` hands back a **PgBouncer** endpoint, and `prisma migrate deploy` ran through it
without complaint — connected, found 21 migrations, applied them, exited 0. No `directUrl` in
`backend/prisma/schema.prisma` and none needed, so no schema change was made. The cluster's direct
endpoint is `fdaa:85:3524:0:1::6` if a future migration does trip on an advisory lock.

### `db/init.sql` — checked, nothing to apply

It issues three `CREATE DATABASE` statements and nothing else — no roles, extensions or grants.
Managed Postgres creates the application database itself, `migrate deploy` never touches a shadow
database, and `interviewly_test` belongs to the compose acceptance ring. Nothing was applied by
hand, and nothing needs to be.

### What exists, and what it costs

| Resource | Identity | Cost |
|---|---|---|
| Managed Postgres | `interviewly-pg` / `d2gznoqg6310pkm8`, Basic, 10GB, fra | **$38/month** |
| Upstash Redis | `interviewly-cache`, pay-as-you-go, eviction **disabled** | **$0.20 per 100K commands** |
| Tigris bucket | `interviewly-assets`, public | usage |
| Apps | `interviewly-{edge,web,api,worker}`, 1 machine + 1 standby each | machine time |

`--disable-eviction` matches compose's `noeviction` (issue #72). Fly's own output warns:
*"If you're using Sidekiq or BullMQ, which poll Redis frequently, consider switching to a
fixed-price plan."* This stack is BullMQ **and** opens one Redis connection per SSE stream, so a
P06 load run bills per command on top of the connection ceiling. **Move to a fixed-price plan
before P06 runs, or the run's cost is unbounded.**

**ADR-P09's number was not obtained.** `fly redis status` reports the plan but not a connection
limit, and pay-as-you-go does not publish one in the CLI. P06 cannot report a ceiling until this
is read from the Upstash console. This is the single most important missing figure in the ledger.

### Verified

Public hostname: **https://interviewly-edge.fly.dev**

| Check | Result |
|---|---|
| `/api/healthz` through the edge | `{"ok":true}` — the `handle_path /api/*` strip works |
| `/api/readyz` through the edge | `{"ready":true}` — Postgres **and** Redis reachable from api |
| `/` through the edge | 200 — web upstream after the `::` fix |
| `Vary` on `/` | `Cookie, Accept-Language` present (issue 91 behaviour survived the move) |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options` present |
| Release command | `prisma migrate deploy` ran and exited 0 before the new version served |
| Worker | `WORKER_STARTED`, then an abandon sweep that scheduled **and completed** — BullMQ's `JobScheduler` reaches both dependencies |

### Not verified — the honest list

- **The SSE stream through the edge.** `flush_interval -1` is in the config and was never exercised
  against a live interview. This is the behaviour the whole ledger depends on; P06 must not assume it.
- **`/assets/*`.** The Tigris bucket is empty — nothing has been uploaded — and the landing page
  renders no `/assets/` path, so the rewrite is untested. `/assets/` returning 403 is an anonymous
  bucket-list denial and is correct behaviour, not evidence either way.
- **The drain check.** `fly deploy` mid-turn, the reason `kill_timeout = 15` is set. Not run.
- **The browser walk-through**, and with it the `Secure` flag on a real session cookie and whether
  SMTP delivers.

### Two things the owner must decide

- **Google sign-in is armed and will fail.** `GOOGLE_CLIENT_ID`/`SECRET` are deployed, so
  `/api/auth/capabilities` reports `{"oauth":{"google":true}}` and the button draws — but
  `https://interviewly-edge.fly.dev/api/auth/google/callback` is not registered in the Cloud
  console, and Google matches it character for character. Either register it or unset both
  secrets; both-empty is a supported state (issue #60). Password login is unaffected.
- **SMTP is Gmail, not Resend** (`smtp.gmail.com:465`). Nodemailer's implicit-TLS path handles it,
  but only if `SMTP_PASSWORD` is a Google **App Password** — a regular account password is
  rejected, and the symptom is `email.send` retrying and dead-lettering, not a failed registration.
