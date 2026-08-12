# P07 — kind: kustomize base and overlay, and the ingress annotation that decides whether SSE works
REPO: (this repo) · Depends: P01 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — manifests. They fail loudly and locally; a pod that will not start
says so, and nothing here can reach a candidate.

## Goal
Owner's ask:

> If I want to deploy my system in fly and use also kuberneets and with fake routing show my
> scale level and note it in docs what would i need

The orchestrated target. A real Kubernetes control plane on a local `kind` cluster (ADR-P02),
running P01's images: Deployments for `web`/`api`/`worker`, Services, an ingress-nginx Ingress, the
migration as a Job, and the stateful dependencies as single-replica Deployments with PVCs
(ADR-P10).

P08 adds the HPA and measures. This task ends when an interview runs end to end in the cluster.

## Non-negotiables
- **`nginx.ingress.kubernetes.io/proxy-buffering: "off"` and a `proxy-read-timeout` longer than an
  interview.** ingress-nginx buffers by default. This is the exact mirror of the Caddyfile's
  `flush_interval -1`, and without it every pod reports Ready, every probe passes, and every room
  looks hung. It is the single most likely reason a correct-looking deploy of this app is broken.
- **`livenessProbe` → `/healthz`, `readinessProbe` → `/readyz`. Never the other way round.**
  `backend/src/lib/probes.ts` (I14) says why: `/healthz` touches no dependency precisely so a
  Postgres or Redis blip cannot restart-loop a live process. Wiring liveness to `/readyz`
  recreates the restart loop that endpoint split was built to prevent.
- **Do not set a CSP anywhere in the ingress.** `frontend/src/middleware.ts` sets it per request
  with a nonce for Next's inline hydration scripts; a second one clobbers it, exactly as the
  `Caddyfile` comment records.
- **The migration is a Job that must complete before api serves**, matching compose's
  `service_completed_successfully`. An initContainer on the api Deployment is the wrong shape here
  — it runs once per replica, so N replicas race N migrations.
- **`--schema backend/prisma/schema.prisma` is required.** The image WORKDIR is the workspace root
  (F02); a bare `prisma migrate deploy` finds nothing.
- **Same sha as P01, side-loaded.** `kind load docker-image`, never a locally built image and never
  `:latest` — ADR-P06's whole point is that both targets run the same bytes.
- **No application code changes.** If a manifest cannot express something without one, that is a
  finding for `## Notes`.

## Context (anchors)
- `compose.yaml` — the dependency graph the manifests reproduce: `migrate` completes before
  `api`/`worker`; `api`/`worker` wait on db, cache, bucket healthy; `web` and `api` healthy before
  `edge`. Kubernetes has no `depends_on`, so this becomes the Job plus readiness gating.
- `backend/src/app.ts:63,66` — `/healthz`, `/readyz`.
- `worker/src/health.ts:54` — `GET /healthz` on `WORKER_HEALTH_PORT` (4100). Container-internal by
  design; the probe is its only caller, and it must not get a Service.
- `Caddyfile` — the four behaviours the Ingress has to reproduce. `/api` prefix strip becomes a
  path rewrite, `/assets/*` becomes a rewrite to the bucket Service, `Vary` becomes a
  `configuration-snippet`, and buffering becomes the annotation above.
- `db/init.sql` — mounted as a Postgres init script under compose; becomes a ConfigMap mount here.
- `.env.example` — the key set. Non-secret values go in a ConfigMap, credentials in a Secret.
- `compose.yaml` → `cache` — `--maxmemory 512mb --maxmemory-policy noeviction`. Carry both flags;
  a Redis that evicts loses BullMQ jobs instead of failing.

## Steps
- [ ] `k8s/base/`: Deployments + Services for `web` (3000), `api` (4000), `worker` (no Service);
      ConfigMap and Secret; the `migrate` Job with `ttlSecondsAfterFinished`; the Ingress with the
      buffering, timeout and rewrite annotations.
- [ ] `k8s/overlays/kind/`: `db`, `cache`, `bucket` and `mail` as single-replica Deployments with
      PVCs and Services; the `db/init.sql` ConfigMap; kind-local image tags and NodePort wiring.
- [ ] `k8s/README.md`: the literal cluster-up sequence, including `kind create cluster` with the
      port mappings ingress-nginx needs, `kubectl apply` for ingress-nginx, and the image side-load.
- [ ] Wire probes: api liveness `/healthz` + readiness `/readyz`; worker liveness `/healthz` on
      4100; web readiness `GET /` on 3000.
- [ ] Bring the cluster up, apply the overlay, and confirm the migrate Job reaches `Completed`
      before any api pod is Ready.
- [ ] Walk one interview end to end through the Ingress: login, start, **watch the room update
      without a manual refresh** (this is the buffering check), load an avatar from `/assets/`,
      finish and open the report.
- [ ] Record in `## Notes`: the cluster-up command sequence that actually worked, and any manifest
      that needed a value compose does not have.

## Definition of done
- `kubectl get pods` shows web, api, worker and the four dependencies Running, and the migrate Job
  Completed.
- An interview runs end to end through the Ingress, with the room updating live.
- Killing an api pod mid-interview does not end the interview — the client reconnects and the
  stream resumes from another pod. (This is the cross-replica fan-out from `sse.ts:87` being real.)
- Nothing outside `k8s/` changed.

## Verification
```bash
kind create cluster --config k8s/overlays/kind/kind-cluster.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=180s

SHA=$(git rev-parse HEAD)
for i in api worker web; do
  docker pull ghcr.io/obss-ai-summer-internship-2026/interviewly-$i:$SHA
  kind load docker-image ghcr.io/obss-ai-summer-internship-2026/interviewly-$i:$SHA
done

kubectl apply -k k8s/overlays/kind
kubectl wait --for=condition=complete job/migrate --timeout=300s
kubectl wait --for=condition=available deployment --all --timeout=300s
kubectl get pods
```

Expect the Job `Completed` and every Deployment Available. Then the SSE check, which is the one
that catches the buffering trap:

```bash
curl -sN http://localhost/api/interviews/<id>/events | head -c 200
```

Must emit bytes within a second or two. If it hangs with no output while the interview is
progressing, `proxy-buffering` is still on.

Then in a browser at `http://localhost`: run an interview and confirm the room advances without a
refresh. Then `kubectl delete pod -l app=api` mid-interview and confirm the room recovers.

Cleanup: `kind delete cluster`.

## Notes
