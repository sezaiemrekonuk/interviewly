# Fly deployment (P05)

Four apps — `interviewly-edge`, `interviewly-web`, `interviewly-api`, `interviewly-worker`
(ADR-P04) — with managed Postgres, Redis, object storage and SMTP (ADR-P05), behind the root
`Caddyfile` moved across as the edge (ADR-P03).

Every command runs **from the repo root**, not from this directory. The build context is the
repo root for all four images, exactly as `compose.yaml` sets it.

This is a measurement and demonstration target. It is not where real candidates go — see
`PLAN.md`, "Out of scope".

## What is where

| File | What it is |
|---|---|
| `fly/api.toml` | api app. `kill_timeout = 15`, `/readyz` check, the `prisma migrate deploy` release command |
| `fly/worker.toml` | worker app. No services, `/healthz` on 4100 |
| `fly/web.toml` | web app. The three `NEXT_PUBLIC_*` **build args** |
| `fly/edge.toml` | edge app. The only public IP |
| `fly/edge/Caddyfile` | the root Caddyfile with `.internal` upstreams; its three deviations are documented in its header |
| `fly/edge/Dockerfile` | `caddy:2-alpine` + the config, validated at build |
| `fly/.env.fly.example` | template for the gitignored `.env.fly` |

## Deviation from ADR-P06

The task as written deploys P01's GHCR images by digest, so the Fly and `kind` tables compare
the same bytes. **P01 was skipped**, and these configs build on Fly's remote builder from the
same Dockerfiles instead. The Fly deployment is self-consistent, but a later `kind` run is
**not** byte-comparable with it until P01 lands and both targets deploy one sha. Anything P06
measures here is a Fly number, not a cross-target number.

## Runbook

### 1. Managed dependencies

```bash
fly mpg create --name interviewly-pg --region fra --plan Basic
fly redis create --name interviewly-cache --region fra --disable-eviction --no-replicas
fly storage create --name interviewly-assets --public
```

`--disable-eviction` is not a default worth taking. compose runs Redis at
`--maxmemory-policy noeviction` deliberately (issue #72): BullMQ loses jobs rather than
degrading when a queue key is evicted, and the non-queue keys are all written with a TTL, so
nothing here is safely disposable.

`--public` on the bucket is what makes the edge's `/assets/*` proxy work at all. Without it
every anonymous avatar and mascot GET is a 403, and the page renders with broken images and no
server-side error.

Each command prints credentials **once**. Copy them straight into `.env.fly`:

```bash
cp fly/.env.fly.example .env.fly
# fill DATABASE_URL, SHADOW_DATABASE_URL, REDIS_URL, S3_*, SMTP_PASSWORD, SESSION_SECRET
```

`SESSION_SECRET`: `openssl rand -hex 32`. Not the `.env.example` placeholder — `env.ts:135`
refuses to boot a deployed origin that still carries it.

Record the Redis plan's **connection limit** while it is in front of you. `sse.ts:180` opens one
Redis connection per open SSE stream, so that number, not the api machine count, is what bounds
concurrent interviews (ADR-P09). P06 needs it.

### 2. `db/init.sql` — checked, nothing to apply

`db/init.sql` only issues three `CREATE DATABASE` statements (`interviewly`,
`interviewly_shadow`, `interviewly_test`). It carries no roles, extensions or grants. Managed
Postgres creates the application database itself, `migrate deploy` never touches a shadow
database, and the acceptance database belongs to compose. **Nothing from it needs applying by
hand.**

### 3. Create the apps

```bash
for a in api worker web edge; do fly apps create interviewly-$a; done
```

Then put the real Tigris bucket name into `fly/edge.toml` — it replaces
`REPLACE_WITH_TIGRIS_BUCKET_NAME`, and it is not `interviewly`, because Tigris names are
globally unique. The `/assets/*` rewrite reads it.

### 4. Secrets

```bash
fly secrets import -a interviewly-api    < .env.fly
fly secrets import -a interviewly-worker < .env.fly
grep -E '^(NODE_ENV|PUBLIC_ORIGIN)=' .env.fly | fly secrets import -a interviewly-web
```

The edge gets no secrets. It has no business holding the S3 credentials a shared env file would
hand it — the same reason `compose.yaml` gives that service an explicit `environment` block.

The three `NEXT_PUBLIC_*` keys are **not** in `.env.fly` and must not be added. They were inlined
into the client bundle at build time (`frontend/Dockerfile:33`); as secrets they would look like
configuration while the bundle keeps its source fallbacks.

### 5. Deploy

api first — it owns the migration, and the other three assume a migrated schema.

```bash
fly deploy -c fly/api.toml
fly deploy -c fly/worker.toml
fly deploy -c fly/web.toml
fly deploy -c fly/edge.toml
```

Only the edge gets a public address. If `fly ips list -a interviewly-api` shows one, release it:
reachable directly, the api sees an X-Forwarded-For chain one hop shorter than `TRUST_PROXY=2`
expects, and rate limiting keys on the wrong address for exactly the requests that skipped the
edge.

### 6. Verify

```bash
for a in edge api web worker; do fly status -a interviewly-$a; done

HOST=interviewly-edge.fly.dev
curl -sf  https://$HOST/api/healthz
curl -sfI https://$HOST/assets/mascot/... | head -5     # a real asset path from the running app
fly logs -a interviewly-api | grep -i "migrate deploy"
```

An empty `/assets` response means the page did not render or the bucket is not public — check
`fly logs -a interviewly-edge` before concluding the rewrite is wrong.

Then in a browser on the deployed hostname: register, open the verification mail, log in, start
an interview, confirm the room updates without a manual refresh, and confirm in devtools that
the session cookie carries `Secure`.

### 7. Cost

Nothing here idles free. `fly scale count 0` on all four apps when the deployment is not being
kept warm for P06, and remember that Postgres and Redis bill whether or not an app is running.
