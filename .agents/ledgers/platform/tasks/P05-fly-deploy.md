# P05 — Fly: four apps, managed dependencies, and the three settings that fail silently
REPO: (this repo) · Depends: P01 · Status: todo
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
