# Platform — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes. Prefix
`ADR-P` to avoid collision with `ADR-F`, `ADR-A`, `ADR-I`, `ADR-R`, `ADR-N`, `ADR-V`, `ADR-D`,
`ADR-W`, `ADR-S`, `ADR-T`, `ADR-L` and `ADR-ADD`. Referenced back into `PLAN.md`.

## ADR-P01 — 2026-08-12 — Kubernetes and multi-replica exist for measurement (supersedes IDEA.md §11's exclusions)

**Context:** IDEA.md §11 states plainly: "Load balancers, multi-instance and autoscaling are **not
built**", "No Kubernetes, no Helm, no Terraform. No image registry either — §11.5 was cut along
with the deploy target it served." §15's out-of-scope list repeats it. The forcing question is
whether a deployment initiative may contradict a decision the project already made and defended.

Options: **(A)** honour §11, deploy single-VM only, and describe scale on paper. **(B)** reverse
§11 wholesale and treat multi-replica as the production shape. **(C)** reverse it for a bounded
purpose — measurement — and leave the production recommendation as §11 wrote it.

**Decision:** (C). Kubernetes, an image registry, load balancing and horizontal scaling are built
in this ledger for one purpose: to produce measured scale levels for `SCALE.md` and the physical
deployment diagram IDEA.md §13 requires as a delivered artefact. §11's reasoning about production
is not disputed and not replaced — a four-service demo still does not need an orchestrator to run.

**Why not (A):** the deliverable is a number. A scale level produced against one process behind a
proxy that never balances anything is not a measurement of scaling, it is an assertion about it.

**Why not (B):** §11's argument that orchestration is deployment cost with no scale benefit is
correct at this project's real traffic, and nothing measured here is going to overturn it.

**Consequences:** §11's text stands unedited, the way ADR-S01 left `V01`–`V05` standing. Anything
already `done` under it is not reopened. This ledger owns the contradiction and states it in one
place. The cost is two deployment shapes to keep working; the mitigation is ADR-P06's single sha.

## ADR-P02 — 2026-08-12 — Fly.io is the live target, Kubernetes runs on local `kind`

**Context:** the ask names both Fly and Kubernetes. Running one application on both is unusual and
needs a reason per platform, not a shrug. Options: **(A)** Fly live, Kubernetes on a local `kind`
cluster. **(B)** Fly live, k8s manifests written but never applied — CI-validated only. **(C)** a
managed cloud cluster (GKE/EKS/DO) as the real target with Fly secondary.

**Decision:** (A). Fly carries the live, publicly reachable deploy and its scale table. `kind`
carries a genuine Kubernetes control plane — real Deployments, Service, Ingress, HPA, metrics-server
— on a laptop, deleted after each measurement session.

**Why not (B):** `kubeconform` proves a manifest parses. It does not prove ingress-nginx stops
buffering an SSE stream, and that is precisely the thing that breaks (ADR-P08's sibling trap, §3 of
the spec). Unapplied manifests are documentation shaped like infrastructure.

**Why not (C):** a managed cluster bills continuously for a demonstration that runs for an hour at
a time, and adds cloud IAM to the surface a fresh session has to learn.

**Consequences:** the kind numbers are laptop numbers and are not comparable to the Fly numbers in
absolute terms. `SCALE.md` reports the two tables separately and compares *shapes* — how each
target's curve responds to replica count — never one table's absolute against the other's.

## ADR-P03 — 2026-08-12 — Caddy survives on Fly as a fourth app

**Context:** Fly Proxy terminates TLS and routes to an app, but the `Caddyfile` carries four
behaviours that are not routing-to-an-app: `handle_path /api/*` prefix stripping, `flush_interval
-1` on the api upstream, the `/assets/*` bucket-name rewrite, and `Vary: Cookie, Accept-Language`
on negotiated paths excluding `_next/static`. Options: **(A)** deploy Caddy as `interviewly-edge`
with `.internal` upstreams. **(B)** split the four behaviours across Fly `[[services]]`, Next.js
rewrites and per-app config.

**Decision:** (A). The existing `Caddyfile` moves across with upstream hostnames changed and
nothing else.

**Why not (B):** it distributes four rules across three files and two systems, and each one fails
differently and silently. Dropping the prefix strip 404s every backend route; dropping
`flush_interval -1` makes the room look hung; dropping the bucket rewrite 404s every avatar (the
comment in `Caddyfile` records that this already happened once); dropping `Vary` serves one
visitor's language to the next (issue 91).

**Consequences:** one extra internal hop on every request, and `edge` is a scaling unit of its own.
In exchange the routing truth stays in the file the repo already reviews, and the compose path and
the Fly path cannot drift apart without the diff showing it.

## ADR-P04 — 2026-08-12 — Four Fly apps, not process groups of one

**Context:** Fly can run several process groups inside one app, sharing a scale surface, or
separate apps with independent ones.

**Decision:** four apps — `interviewly-edge`, `interviewly-web`, `interviewly-api`,
`interviewly-worker`.

**Why not process groups:** the worker has no ports, is LLM-bound rather than request-bound, and
scales on report backlog. Sharing a scale count with the api ties report throughput to HTTP
concurrency, which is the exact confusion this ledger's measurements exist to avoid. It would also
force ADR-P08's "HPA on api only" to be expressed as an exception rather than a topology.

**Consequences:** four `fly.toml` files and four secret sets. `REFERENCE.md` carries the map so no
session has to re-derive which app holds which env key.

## ADR-P05 — 2026-08-12 — Managed dependencies on Fly, no self-hosted stateful services

**Context:** compose runs `db` (postgres:16), `cache` (redis:7), `bucket` (MinIO) and `mail`
(Mailpit) as containers. Fly can run those as machines with volumes, or they can be swapped for
managed equivalents.

**Decision:** managed. Fly Postgres, Upstash Redis, Tigris for S3, and a real SMTP provider for
mail. Every one is protocol-compatible with what the code already speaks, so the change is env
only: `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`, `SMTP_*`.

**Why not self-host on Fly machines:** volumes are per-machine and do not follow a redeploy; a
mismanaged Postgres volume is how a demonstration deletes its own seed data. This ledger's subject
is the stateless tier, and hand-running the stateful one adds failure modes that would be
misattributed to the scale numbers.

**Consequences:** Fly Postgres is a **single node** — not HA, and `SCALE.md` must say so rather
than let a reader assume the database scaled too. Upstash's per-plan connection cap becomes the
binding constraint measured in ADR-P09. A mail sink is mandatory, not optional: registration always
enqueues a mail, so a stack without one dead-letters a job on the first signup.

## ADR-P06 — 2026-08-12 — GHCR, three images, tagged by commit sha, one sha for both targets

**Context:** IDEA.md §11.5 cut the image registry along with the deploy target it served. Fly can
build remotely from source and never touch a registry; kind needs an image from somewhere.

**Decision:** `.github/workflows/images.yml` builds the three existing Dockerfiles and pushes to
`ghcr.io/obss-ai-summer-internship-2026/interviewly-{api,worker,web}` tagged with the commit sha.
Fly deploys `--image` against that tag. kind side-loads the same digest with `kind load
docker-image`, so the cluster needs no registry credentials.

**Why not let each target build its own:** two targets running different bytes makes every
difference between their tables unattributable, and "it worked on Fly" becomes unfalsifiable. The
sha in both tables is what makes the comparison a comparison.

**Consequences:** `NEXT_PUBLIC_*` remain **build arguments**, not runtime env — `compose.yaml`'s
`web.build.args` block already documents why, and a `fly secrets set` for one of them arrives after
the value has already been inlined into the bundle. The workflow inherits that obligation and fails
loudly when a key is missing, exactly as compose does.

## ADR-P07 — 2026-08-12 — Providers are stubbed under load, at injected latency, behind a loud guard

**Context:** a live-interview load test at any interesting concurrency issues real OpenAI and
ElevenLabs calls. Options: **(A)** stub both, with injected latency. **(B)** run real providers at
low concurrency only. **(C)** both, two curves.

**Decision:** (A). `AI_ENABLED=false` already selects `StubAiClient` via `resolve-client.ts:38`,
and stub mode still writes audit rows through `StubRecordingClient`, so cost accounting stays
exercised. `FakeSpeechProvider` exists but is referenced only from `features/step_definitions/` and
`speech.test.ts` — P02 adds the runtime selection path it never had.

**The latency is injected, not omitted.** Both stubs return instantly today. A VU whose turn
resolves in microseconds cycles the loop with no think time, and the streams that determine
concurrency are precisely the ones held open for seconds. The profile injects fixed delays from
`speech-latency/REFERENCE.md`'s warm medians — STT ~1 650 ms, conductor ~1 180 ms, TTS ~430 ms — so
the load has the real system's shape and none of its bill.

**Why not (B):** at any concurrency worth measuring, the ceiling found would be the provider's rate
limit, not this system's. That is a fact about OpenAI.

**Why not (C):** double the runs and double the spend for a calibration offset that `SCALE.md` can
state from the already-measured `speech-latency` table.

**Why the guard is loud:** a fake provider silently active in production is an interview that
scores nobody and looks entirely normal. It gets the same posture as the acceptance suite's refusal
to run against a database whose name does not end in `_test`: refuse to boot when the fake speech
provider is selected unless the environment says so explicitly **and** `NODE_ENV` is not
production, and log the selected provider at startup either way.

**Consequences:** every number in `SCALE.md` is an infrastructure number, and the document says so
in its own section rather than in a footnote.

## ADR-P08 — 2026-08-12 — HPA on api only; the worker's replica count is fixed

**Context:** Kubernetes HPA scales on a metric. The obvious default is CPU.

**Decision:** an HPA on the api Deployment, CPU-targeted. The worker Deployment has a fixed replica
count, set by hand per measurement run.

**Why not an HPA on the worker:** report generation is LLM-bound. A worker with a full queue sits
at near-zero CPU waiting on a provider, so a CPU-target HPA scales it **down** under exactly the
load it should scale up for. The correct signal is BullMQ queue depth, which means KEDA, which is a
second control loop to install and debug — out of scope, and named here so the omission reads as a
decision rather than an oversight.

**Consequences:** worker throughput in `SCALE.md` is reported per fixed replica count, and the
document states that the worker tier does not autoscale and why. The api HPA needs metrics-server,
which kind does not install by default.

## ADR-P09 — 2026-08-12 — The SSE Redis-connection ceiling is measured and named, not fixed

**Context:** `sse.ts:180` calls `redis.duplicate()` for **every open stream**. The comment at :212
explains the choice and names the alternative it declined: "a single shared subscriber would need
an in-process channel → response map plus refcounted unsubscribe." Cross-replica fan-out already
works — `publishStateChanged` publishes to Redis (`sse.ts:87`), so a state change on one replica
reaches a stream held on another. The problem is not correctness, it is that concurrent interviews
consume Redis connections 1:1 and managed Redis caps them per plan.

**Decision:** measure it, state it as the headline of `SCALE.md`, and do not fix it in this ledger.

**Why not fix it first:** the refcounted subscriber map is where SSE fan-out bugs live — a missed
unsubscribe leaks, an over-eager one silently stops delivering events to a live interview, and
neither goes red. Building that before there is a number saying what it buys is spending the
riskiest change in the codebase on a guess.

**Consequences:** `SCALE.md` leads with a ceiling that api replica count does not move, and the
replica tables sit underneath it rather than above it. A reader who stops after the first section
still leaves with the true statement. The fix becomes a Backlog row whose trigger is P09's own
number.

## ADR-P10 — 2026-08-12 — kustomize, Deployments with PVCs; no Helm, no StatefulSets

**Context:** manifests need a tool and the stateful services need a workload kind.

**Decision:** kustomize with `k8s/base/` and `k8s/overlays/kind/`. Postgres, Redis and MinIO run as
single-replica Deployments with PVCs.

**Why not Helm:** a chart's value is parameterisation for consumers who cannot edit the manifests.
There are two overlays and one consumer, so a chart buys templating syntax and a release lifecycle
to debug.

**Why not StatefulSets:** nothing in this stack clusters, forms a quorum, or needs stable network
identity — each is exactly one instance behind one Service. A StatefulSet would add ordered
rollout semantics that carry no meaning here. The kind cluster is deleted after each session
anyway; the PVCs exist so a restart mid-session does not wipe the seed.

**Consequences:** the overlay is the only place a target-specific value lives, which is what keeps
`k8s/base/` honest as a description of the application rather than of the laptop.
