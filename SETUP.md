# SETUP

Interviewly runs entirely in Docker Compose. These steps on a clean machine give you a working app
at <http://localhost> with a demo account in it.

## What you need

- Docker Desktop (Compose v2)
- Node.js 22 or newer — only for the seed in step 4
- ~4 GB of free disk for the images

No API keys needed to start: with `AI_ENABLED=false` the app serves canned question and report
content, enough to walk every screen. Step 2 turns on real generation.

## 1. Clone and configure

```bash
git clone <repo-url> interviewly
cd interviewly
cp .env.example .env
```

`.env.example` is a working configuration, not a skeleton. Don't edit it yet.

## 2. Optional — turn on the real LLM calls

Open `.env` and set three values together:

```bash
AI_ENABLED=true
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...     # required whenever AI_ENABLED is true, because voice mode becomes selectable
```

`GEMINI_API_KEY` is optional — the tier the chain falls back to when OpenAI fails. The API
validates every key a prompt file names at startup and refuses to boot if one is missing, so a
broken deployment fails loudly instead of degrading an interview quietly. Skip this step entirely
and the stack runs on the stub client.

## 3. Start the stack

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

First build takes a few minutes. `migrate` runs `prisma migrate deploy` and exits before `api` and
`worker` start, so the schema is never half-applied under a live API.

**Use both files.** `compose.dev.yaml` publishes the database and storage ports step 4 needs, and
sets `SESSION_COOKIE_SECURE=false` so the session cookie survives plain HTTP. Without it, sign-in
appears to succeed and is immediately forgotten.

## 4. Seed

```bash
npm install
npm run prisma:generate
DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly \
S3_ENDPOINT=http://localhost:9000 \
npm run seed
```

Expected output:

```
  occupation_clusters: 10
  mascot/: 5 objects
  personas: 2 (each with 5 avatar objects + 3 expressions)
  users: demo admin admin@demo.com (password: AdminDemo1!)
  sample listing: 1378 chars from prisma/fixtures/
  interviews: 1 sample (2 rounds, 4 questions, 1 ready report)
Seed complete.
```

Idempotent — re-run it as often as you like. It runs from the host because the production images
are built `--omit=dev` and `tsx` isn't in them; the two variables point it at the ports the dev
overlay publishes, since `db:5432` only resolves inside the Compose network.

## 5. Open it

<http://localhost>

Sign in with **admin@demo.com** / **AdminDemo1!** — an admin with one finished interview (report
ready) and one paused; `/admin` is in the account menu.

For the candidate flow: register, complete onboarding, paste any job listing, pick a question
count, start. Email verification ships off (`EMAIL_VERIFICATION_REQUIRED=false`), so you never
need an inbox; turn it on and the links land in Mailpit at <http://localhost:8025>.

## Ports

| URL | What |
|---|---|
| <http://localhost> | the app — this is the only address you need |
| <http://localhost:8025> | Mailpit inbox (dev overlay) |
| <http://localhost:5601> | Kibana — logs and debugging (observability profile) |
| `localhost:5432` · `localhost:6380` · `localhost:9000` | Postgres · Redis · MinIO (dev overlay) |

`http://localhost:3000` is **not** the app. Everything is served single-origin through Caddy on
port 80: `/` to the frontend, `/api/*` to the API, `/assets/*` to object storage.

## Tests

```bash
npm test              # unit + component (vitest, all workspaces)
npm run typecheck
npm run lint
npm run test:acceptance   # Cucumber, needs the stack up with the dev overlay
```

Go through the npm scripts: a bare `npx vitest` exits immediately, because `backend/src/env.ts`
calls `process.exit(1)` on missing config and the script supplies `.env`. The acceptance suite runs
against `interviewly_test` and Redis db 1 from the dev overlay, and truncates what it connects to
— so it refuses to start against a database not named `*_test`, or against Redis db 0.

## If something looks wrong

**Frontend changes don't show up.** `web` is a production build — rebuild it:
`docker compose -f compose.yaml -f compose.dev.yaml up -d --build web`. Same for `api`, `worker`.

**The published ports vanished after a `docker compose up -d`.** You left off `-f
compose.dev.yaml`. Re-run the two-file command; nothing is lost.

**Compose fails on a missing `NEXT_PUBLIC_*` variable.** Those three are baked into the frontend
image at build time, so Compose refuses to run without them. Copy them from `.env.example`.

**Everything is 502.** `docker compose ps` — `edge` waits on the `api` and `web` healthchecks.
Then `docker compose logs api --tail=50`.

**Kibana is up but empty.** Either the services started before Elasticsearch did
(`docker compose restart api worker`), or the data view has the wrong time field. Both below.

## Logs and debugging — Kibana

Debugging goes through **Kibana at <http://localhost:5601>**. Elasticsearch backs it and is
deliberately not published — Kibana is the only door. Both sit behind a Compose profile, which
needs the flag as well as the file:

```bash
docker compose -f compose.yaml -f compose.dev.yaml -f compose.observability.yaml \
  --profile observability up -d
```

Then point the services at it in `.env`:

```bash
LOG_TRANSPORT=elastic          # the literal string `elastic`, not `elasticsearch`
ELASTICSEARCH_URL=http://elasticsearch:9200
```

**Order matters.** The transport builds its client once at boot and never retries a dead
Elasticsearch, so an `api` that started first ships nothing and says nothing about it. Start the
profile first, or `docker compose restart api worker` after. Logs ship in bulk — give it ~30
seconds before the index exists.

### First run: the data view

Kibana → **Stack Management → Data Views → Create data view**:

| Field | Value |
|---|---|
| Index pattern | `interviewly-*` |
| Time field | **`time`** |

`time`, not `@timestamp` — pick the wrong one and Discover shows an empty chart over real data.
One index per day: `interviewly-2026-08-12`.

### What a log line looks like

```json
{ "level": 30, "time": "2026-08-12T13:36:05.707Z", "pid": 1, "hostname": "bdfb6affaa58",
  "title": "AUTH_LOGIN_OK",
  "msg": "{\"traceId\":\"f0aa3df5-…\",\"ip\":\"172.66.0.243\",\"method\":\"POST\",\"path\":\"/auth/login\",\"userId\":\"cmsn41…\"}" }
```

`title` is a fixed `UPPER_SNAKE` event name — that is what keeps the index at a handful of columns
instead of one per call site. `msg` is the request context folded into one JSON string: `traceId`,
`userId`, `ip`, `method`, `path`, plus whatever the call site added (`interviewId`, `jobId`, an
error name). `level` is a pino number — 30 info, 40 warn, 50 error. No secrets, tokens, PII or PDF
content is ever logged, and it is `path` rather than the full URL because a query string can carry
a verification token.

### Queries worth keeping

```
title: "AUTH_LOGIN_FAILED"                  # brute force / a user who can't get in
level >= 50                                 # everything that went bang
msg: "f0aa3df5-b7bb-4e33-8d1c-1ed2b5dc583d" # one request, end to end (quote the traceId)
msg: "cmsn41lht000arq9zffwaxam6"            # one interview, or one user, across services
title: REPORT_JOB_* and level >= 40         # report generation trouble
```

### Events you will actually look for

| Something is wrong with… | Search for |
|---|---|
| an interview that never finished | `INTERVIEW_ABANDONED`, `INTERVIEW_END_FAILED`, `CONDUCTOR_OPEN_ROUND_FAILED` |
| the interviewer behaving oddly | `CONDUCTOR_TURN_CEILING`, `CONDUCTOR_ENDED_INTERVIEW`, `CONDUCTOR_UNAVAILABLE`, `PENDING_TURN_MALFORMED` |
| a missing report | `REPORT_JOB_ENQUEUED` → `REPORT_JOB_STARTED` → `REPORT_PDF_RENDERED` → `REPORT_JOB_COMPLETED`; failures are `REPORT_JOB_RETRY`, `REPORT_JOB_FAILED`, `REPORT_DEAD_LETTERED` |
| an LLM call | `LLM_FALLBACK_TRIGGERED` (tier 1 died), `BUDGET_EXHAUSTED`, `PRICE_MISSING`, `AI_PROVIDER_KEYS_CHECKED` at boot |
| voice | `SPEECH_TTS_FAILED`, `SPEECH_STT_FAILED`, `VOICE_UNAVAILABLE`, `VOICE_DOWNGRADED_TO_TEXT` |
| sign-in | `AUTH_LOGIN_FAILED`, `AUTH_VERIFY_TOKEN_REJECTED`, `AUTH_GOOGLE_EXCHANGE_FAILED`, `AUTH_GOOGLE_NOT_CONFIGURED`, `AUTH_ADMIN_GOOGLE_BLOCKED` |
| uploads | `UPLOAD_INVALID_FORMAT`, `CV_TRUNCATED` |
| a request being refused | `RATE_LIMIT_HIT`, `LISTING_REJECTED`, `UNHANDLED_ERROR` |
| the process itself | `SERVER_STARTED`, `SERVER_STOPPING`, `SERVER_STOP_TIMEOUT`, `BOOT_FAILED` |

### Without Elasticsearch

The transport is additive — stdout gets every line either way:

```bash
docker compose logs -f api worker
docker compose logs api | grep AUTH_LOGIN_FAILED
```

`LOG_TRANSPORT=stdout` turns shipping off; `LOG_LEVEL=debug` when info isn't enough.
