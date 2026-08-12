# Platform — REFERENCE (read this once, then you don't need to spelunk)

Single orientation doc for any agent executing a `P` task. Verified against the codebase on
**2026-08-12** at commit `a973d56`, after `L02` merged to master (PR #292) and the delivered
documents landed. If reality diverges, trust the code and patch this file.

Nothing in this ledger changes application behaviour. Every anchor below is something you **read
from** or **deploy**, not something you rewrite — with the single exception of
`SpeechProvider.ts`'s boot path in P02.

## Services, ports, images

| Service | Dockerfile | Port | Probe | Notes |
|---|---|---|---|---|
| `api` | `backend/Dockerfile` (`EXPOSE 4000`, `CMD node backend/dist/src/index.js`) | 4000 | `/healthz`, `/readyz` | drains in-flight requests for 10s |
| `worker` | `worker/Dockerfile` (`CMD node worker/dist/index.js`) | `WORKER_HEALTH_PORT` (4100) | `/healthz` | no published port anywhere; the probe is the only caller |
| `web` | `frontend/Dockerfile` (`EXPOSE 3000`, `CMD node frontend/server.js`) | 3000 | `GET /` | Next standalone output; production build |
| `edge` | `caddy:2-alpine` + `./Caddyfile` | 80 | — | the only published port in `compose.yaml` |
| `db` | `postgres:16-alpine` | 5432 | `pg_isready` | |
| `cache` | `redis:7-alpine` | 6379 | `redis-cli ping` | `--maxmemory 512mb --maxmemory-policy noeviction` |
| `bucket` | `minio/minio` | 9000 | `/minio/health/ready` | |
| `mail` | `axllent/mailpit` | 8025 (web) | `/readyz` | mandatory — registration always enqueues a mail |
| `migrate` | `backend/Dockerfile` | — | exits 0 | `prisma migrate deploy --schema backend/prisma/schema.prisma` |

**The probe split is already correct for Kubernetes** and was not built for it —
`backend/src/lib/probes.ts` (task I14) says why:

- `/healthz` (`backend/src/app.ts:63`) — liveness, **touches no dependency**, because a Postgres or
  Redis blip must not restart-loop a live process. This is the `livenessProbe`.
- `/readyz` (`backend/src/app.ts:66`) — checks both dependencies, timeout-bounded. This is the
  `readinessProbe`.

Wiring `livenessProbe` to `/readyz` would recreate exactly the restart loop I14 exists to prevent.

## Commands

```bash
docker compose up -d                                  # whole stack, edge on :80
docker compose -f compose.yaml -f compose.dev.yaml up -d   # + published dep ports
docker compose up -d --build web                      # REQUIRED to see frontend changes

npm run lint && npm run typecheck && npm test
npm run -w frontend lint                              # stricter, NOT covered by the root run
npm run test:acceptance                               # needs compose.dev.yaml up

# host-reachable ports published only by compose.dev.yaml
#   db 5432 · cache 6380 (→6379) · bucket 9000 · mailpit web 8025 · api 127.0.0.1:4000
```

Seeded demo account: `admin@demo.com` / `AdminDemo1!`.

## The SSE path — the subject of this ledger's headline number

`backend/modules/interview/sse.ts`:

- `:87` `publishStateChanged` → `redis.publish(eventChannel(event.interviewId), …)`. **Cross-replica
  fan-out already works.** A transition applied on replica B reaches a stream held on replica A.
- `:98` `publishQuestionsReady` → same channel, swallows its own failure.
- `:146` `streamsByUser = new Map<string, Set<Response>>()` — per-process, and **safe**: local
  bookkeeping for streams this process holds, never a source of truth.
- `:180` `redis.duplicate()` — **one Redis connection per open stream.** The `:212` comment states
  the reason (ioredis puts a connection into subscriber mode exclusively) and names the alternative
  it declined: a shared subscriber plus an in-process channel → response map with refcounted
  unsubscribe.
- `:216` `subscriber.on('message', …)`, `:223` `subscriber.subscribe(channel)`.

Consequence for every measurement in this ledger: **concurrent interviews consume Redis connections
1:1.** Before reporting an api replica count as a scaling knob, check whether the run hit the Redis
connection cap first. ADR-P09.

The client contract, which the k6 `live-interview` scenario must imitate:
`frontend/src/lib/use-interview-events.ts` — the SSE event says only *that* something changed;
the client always refetches `/state` for *what*. A VU that only counts SSE frames is not producing
the request load a real room produces.

## The worker — already replica-safe

`worker/src/index.ts`:

- `:27` **one** ioredis client shared by every queue and worker, so `/healthz` pings the same
  connection BullMQ consumes (issue 71).
- `:60` report worker, `concurrency: REPORT_CONCURRENCY`, deliberately low (K10) — report
  generation is the LLM-bound job.
- `:87` abandon sweep via a BullMQ **`JobScheduler`** (`{ every: ABANDON_SWEEP_EVERY_MS,
  immediately: true }`). Scheduler state lives in Redis, so N worker replicas produce one sweep per
  interval, not N. Verify this holds in P04 rather than assuming it.

## Providers and their stubs

| Surface | Live | Stub | Selected by |
|---|---|---|---|
| LLM (`packages/ai`) | `LiveAiClient` | `StubAiClient` wrapped in `StubRecordingClient` | `AI_ENABLED` — `packages/ai/src/resolve-client.ts:38` |
| Speech (TTS/STT) | `ElevenLabsSpeech` | `FakeSpeechProvider` | **nothing at boot** — see below |

`backend/modules/speech/SpeechProvider.ts`:

- `:21` `export let speechProvider = new ElevenLabsSpeech(...)` — the module-level binding, built at
  import time from `config.ELEVENLABS_*`.
- `:27` `setSpeechProvider(next)` — the seam already exists and swaps the binding wholesale, same
  pattern as `src/lib/storage.ts:31,52`. The acceptance ring calls it from a `Before` hook.
- **No production code path calls it.** `FakeSpeechProvider`
  (`backend/modules/speech/fake-speech.ts:8`) appears only in `features/step_definitions/speech*.ts`
  and `speech.test.ts`. A deployed process always holds `ElevenLabsSpeech`. P02 adds the one
  boot-time caller.

Stub mode still audits: `StubRecordingClient` (`resolve-client.ts:100`) writes the `llm_calls` row
because "the interview costs nothing, but nothing is a number". Cost accounting stays exercised
under load.

**Neither stub delays.** `grep -nE 'delay|sleep|setTimeout|latency'` over `fake-speech.ts` and
`stub.ts` returns nothing. P02 injects the delays; the figures to inject are in
`.agents/ledgers/speech-latency/REFERENCE.md`'s warm-median table — STT ~1 650 ms, conductor
~1 180 ms, TTS ~430 ms (`eleven_turbo_v2_5`, since L01).

## Env keys that move when the target changes

From `.env.example`. Everything else stays as-is.

| Key(s) | compose | Fly / kind |
|---|---|---|
| `DATABASE_URL`, `SHADOW_DATABASE_URL` | `db:5432` | managed Postgres |
| `REDIS_URL` | `cache:6379` | Upstash / in-cluster `cache` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | `http://bucket:9000`, `minioadmin` | Tigris / in-cluster |
| `S3_PUBLIC_PREFIX`, `NEXT_PUBLIC_ASSETS_PREFIX` | `/assets` | unchanged — the edge rewrites |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | `mail` | real SMTP |
| `PUBLIC_ORIGIN`, `INTERNAL_API_URL` | `http://localhost` | the deployed hostname |
| `TRUST_PROXY`, `SESSION_COOKIE_SECURE` | dev values | **must flip behind a real TLS proxy** |
| `AI_ENABLED` | `true` | `false` in a load-test profile only |

**`NEXT_PUBLIC_ASSETS_PREFIX`, `NEXT_PUBLIC_MASCOT_SHA256`, `NEXT_PUBLIC_DEFAULT_LOCALE` are build
arguments, not runtime env.** `compose.yaml`'s `web.build.args` block documents the whole trap: they
are inlined when the bundle is built, so a value supplied at run time is already too late, and the
image ships the source fallbacks instead. `compose.yaml` fails every command when they are missing
(`:?`); the image workflow must fail the same way.

## The Caddyfile's four load-bearing behaviours

Any target that terminates requests must reproduce all four, or fail in these exact ways:

| Behaviour | Where | If dropped |
|---|---|---|
| `handle_path /api/*` prefix strip | `Caddyfile` | every backend route 404s |
| `flush_interval -1` on the api upstream | `Caddyfile` | SSE buffers; every room looks hung |
| `/assets/*` → `/{bucket}{uri}` rewrite | `Caddyfile` | every avatar and mascot 404s (this already happened once — the comment records it) |
| `Vary: Cookie, Accept-Language` on negotiated paths, excluding `_next/static` | `Caddyfile` | one visitor's language served to the next (issue 91) |

Caddy also splits its own logging so a client hanging up an SSE stream does not drown real proxy
warnings (issue 134). Keep the `log` blocks when the file moves.

The CSP is **not** set here — `frontend/src/middleware.ts` sets it per request with a nonce. Do not
add one at the edge or in an ingress annotation; it clobbers the nonce.

## The delivered documents (new on 2026-08-12, commit `a973d56`)

Four files at the repo root, and this ledger's output feeds two of them:

- **`DECISIONS.md`** — the graded deliverable IDEA.md §13 asks for. Already carries a
  `## Physical deployment` section with a **mermaid `flowchart LR`** of the compose topology, a
  `## What we knowingly left` section, and a prefix table under `## Where the rest of it lives`
  (the `P` row is already added). P09 adds the two deployed topologies beside the compose one and
  matches its mermaid style — not `PLAN.md`'s ASCII.
- **`SETUP.md`** — the clean-environment doc; describes the compose path only, plus ports, tests
  and Kibana. P09 adds a pointer so two new deploy targets do not read as supported setups.
- **`README.md`**, **`AI_DEVLOG.md`** — no `P` task writes to either.

## CI as it stands

`.github/workflows/ci.yml` jobs: `static`, `build`, `unit`, `acceptance`, `audit`. A new
`images.yml` (P01) is a separate workflow, not a job added here — image publishing must not gate a
pull request.

## Conventions a reviewer will flag

- Commits are conventional (`commitlint.config.js`); scope by area.
- Pre-commit runs `lint-staged`; the **frontend** uses a stricter config that the root
  `npm run lint` does not cover.
- `.agents/EXECUTE.md` §6 rule 9: **one task per session, do not commit between tasks.**
- Every finished task writes `.agents/devlogs/<same basename as the task file>.md`.
- `ci/check-devlogs.sh` exists — check it before inventing a devlog shape.
