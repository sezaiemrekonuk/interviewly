# P08 — kind: metrics-server, an HPA on api, and the second table
REPO: (this repo) · Depends: P04, P07 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — an HPA against a cluster deleted afterwards. ADR-P08 already made the
one real judgement.

## Goal
Owner's ask:

> If I want to deploy my system in fly and use also kuberneets and with fake routing show my
> scale level and note it in docs what would i need

The Kubernetes half of the scale story: metrics-server, a CPU-targeted HPA on the api Deployment,
and the same k6 scenarios at fixed api replica counts plus one run where the HPA does the scaling
itself.

These are laptop numbers. They are not comparable in absolute terms to P06's Fly numbers, and P09
compares the **shapes** of the two curves rather than their values (ADR-P02).

## Non-negotiables
- **No HPA on the worker.** ADR-P08: report generation is LLM-bound, so a worker with a full queue
  idles at low CPU and a CPU-target HPA scales it *down* under exactly the load it should scale up
  for. The worker replica count is set by hand per run and recorded. Queue-depth autoscaling is
  KEDA and is out of scope.
- **Fixed-count runs first, HPA run last.** A table whose replica count was chosen by a controller
  mid-run has no independent variable. The HPA run is a separate, additional observation about
  whether the controller reacts usefully — not a row in the same table.
- **Record the machine.** Cores, RAM, and what else was running. Every one of these numbers is
  bounded by a laptop, and P09 must be able to say so with specifics.
- **Same sha as P07**, side-loaded, never rebuilt between levels.
- **Load-test profile on**, and confirmed by the boot log naming the fake speech provider before
  any run is trusted.
- **Do not raise limits to make a number better.** Resource requests and limits are set once, in
  P07's manifests, and recorded. Changing them between levels invalidates the table.

## Context (anchors)
- `k8s/` — P07's manifests and README. The HPA is an addition to `base/`, not a rewrite.
- P04's `## Notes` — the compose baseline on the same machine, which is the honest comparison for
  these numbers (same hardware, different orchestration).
- P06's `## Notes` — the Fly table. Read it for the *questions* it answered, not for values to
  match.
- `worker/src/index.ts:60` — `concurrency: REPORT_CONCURRENCY`, low by design (K10). Worker replica
  count multiplies this; record both.
- `backend/modules/interview/sse.ts:180` — the per-stream Redis connection. In-cluster Redis has no
  plan cap, so this target will likely hit CPU or file descriptors first. **That difference is a
  finding for P09**, not a reason to prefer one target's numbers.
- ADR-P02 — why kind numbers and Fly numbers are never compared as absolutes.

## Steps
- [ ] Install metrics-server into the kind cluster (it needs `--kubelet-insecure-tls` on kind) and
      confirm `kubectl top pods` returns figures.
- [ ] Add an HPA to `k8s/base/` targeting the api Deployment on CPU, min 1 max 8, with the target
      utilisation recorded. Set explicit resource requests on api — an HPA without requests has no
      denominator and does nothing.
- [ ] Apply the load-test profile via the ConfigMap/Secret and confirm the api boot log names the
      fake speech provider.
- [ ] Fixed-count runs at api replicas 1, 2, 4, 8 with the HPA scaled to `minReplicas =
      maxReplicas = N` (or temporarily removed — record which). Two result files per level, named
      `kind-{N}x-{room,browse}`.
- [ ] At each level record: sustained concurrent streams, p95 turn latency, req/s, Redis
      `connected_clients`, api pod CPU, and the resource that ended the run.
- [ ] One HPA run: min 1, max 8, ramp the `live-interview` scenario and record what the controller
      actually did — how long until the first scale-up, how many replicas it settled on, and
      whether p95 recovered. Save as `kind-hpa-room`.
- [ ] Record the machine, the resource requests/limits in force, and the worker replica count.

## Definition of done
- Eight fixed-count result files plus one HPA result file in `loadtest/results/`, at P07's sha.
- Every fixed level has a named binding resource.
- The HPA observation states time-to-first-scale-up, the settled replica count, and whether p95
  recovered — or states plainly that it did not react, which is also a result.
- `k8s/` gained an HPA and a metrics-server note in its README; nothing else changed.

## Verification
```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch -n kube-system deployment metrics-server --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
kubectl top pods                                     # must return numbers, not an error

kubectl logs -l app=api --tail=50 | grep -i "speech provider"

# BASE = twice the concurrency at which P04's compose baseline degraded, on this same machine.
for n in 1 2 4 8; do
  kubectl scale deployment/api --replicas=$n
  kubectl wait --for=condition=available deployment/api --timeout=120s
  MAX_VUS=$(( BASE * n )) RESULT_NAME=kind-${n}x-room   k6 run loadtest/live-interview.js
  MAX_VUS=$(( BASE * n )) RESULT_NAME=kind-${n}x-browse k6 run loadtest/http-browse.js
done

kubectl apply -k k8s/overlays/kind                   # restore the HPA
MAX_VUS=$(( BASE * 8 )) RESULT_NAME=kind-hpa-room k6 run loadtest/live-interview.js
kubectl describe hpa api | tail -20                  # the scaling events
ls loadtest/results/kind-*                           # expect 9 files
```

Expect nine files and an `hpa` description showing scale events with timestamps. Paste those events
verbatim into `## Notes` — "it scaled up" without the timing is not the observation this task owes.

Cleanup: `kind delete cluster`.

## Notes
