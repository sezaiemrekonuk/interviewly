# Platform — Recommended Model Per Task

Opus for the three tasks that can fail **quietly**: a fake provider that reaches production, a
deploy that handles real secrets and a release command that owns the schema, and the document
whose whole job is not to overclaim. Sonnet for the rest — manifests, workflows and measurement
runs, all of which fail loudly and immediately.

`.agents/EXECUTE.md` §5 is the rule — the tier must match the model actually running, or the
session prints `TIER <ID> needs <tier>, running <model>` and ends.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| P01 | GHCR: three images, tagged by sha | `claude-sonnet-5` | A workflow file against three Dockerfiles that already build. The one trap — `NEXT_PUBLIC_*` must be build args — is documented in `compose.yaml` in the file the session will copy from, and getting it wrong ships fallback values that are visible on the first page load |
| P02 | The load-test provider profile | `claude-opus-5` | **The quiet one.** A fake speech provider reaching a production boot is an interview that transcribes nothing, scores nobody, and looks entirely normal — no exception, no red test, no complaint until a candidate reads a report about answers they never gave. The task is small; the guard around it is the whole point, and a guard that is merely *present* rather than *impossible to bypass* passes every test it has |
| P03 | k6 harness | `claude-sonnet-5` | New files, no production code touched. A wrong scenario produces an obviously wrong number rather than a plausible one — a VU loop that skips the `/state` refetch shows up as a request count that does not match the room's real shape |
| P04 | Single-replica baseline on compose | `claude-sonnet-5` | Running an existing harness and writing down what it printed. The judgement — whether the sweep really is once-per-interval across replicas — is checked by observation, not decided |
| P05 | Fly: four apps, managed deps, secrets, release command | `claude-opus-5` | Real credentials, a real hostname, and `release_command` running `prisma migrate deploy` against a real database. Three things here fail silently rather than loudly: `NEXT_PUBLIC_*` set as secrets instead of build args (ships fallbacks), `kill_timeout` left at Fly's 5s default (SIGKILLs an answer mid-flight, issue #70), and `TRUST_PROXY`/`SESSION_COOKIE_SECURE` left at dev values behind a real TLS proxy |
| P06 | Fly scale runs, first table | `claude-sonnet-5` | `fly scale count`, run the harness, transcribe JSON. The one judgement — was that the Redis cap or the app? — has a mechanical check written into the task |
| P07 | kind: kustomize base and overlay | `claude-sonnet-5` | Manifests. Fails loudly and locally: a pod that will not start says so, and the SSE annotation trap shows up as a room that never updates on the first manual check. Nothing here can reach a candidate |
| P08 | kind: metrics-server, HPA, second table | `claude-sonnet-5` | An HPA against a cluster that is deleted afterwards. ADR-P08 already decided the worker does not autoscale, so the one real judgement is made |
| P09 | `SCALE.md` | `claude-opus-5` | The deliverable, and the one artefact that can be wrong in a way nobody notices — a table of replica counts implies a knob, and this system's binding constraint is not that knob. Getting the emphasis wrong is not a typo; it is the document asserting something false while every individual number in it is true |

## Summary

- **`claude-opus-5` (3 tasks):** P02, P05, P09
- **`claude-sonnet-5` (6 tasks):** P01, P03, P04, P06, P07, P08

Rule of thumb for this ledger: **if it can be wrong without anything going red, it is opus.** A
manifest that is wrong will not start. A workflow that is wrong will not push. A load run that is
wrong prints a number nobody can reproduce. But a stub that reaches production, a session cookie
that is not `Secure` behind TLS, and a scale table that implies the wrong knob all look exactly
like success.
