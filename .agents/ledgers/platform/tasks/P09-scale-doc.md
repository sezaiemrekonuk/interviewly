# P09 — SCALE.md: the ceiling first, the tables second, and what was faked
REPO: (this repo) · Depends: P06, P08 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — the deliverable, and the one artefact that can be wrong while every
individual number in it is true.

## Goal
Owner's ask:

> If I want to deploy my system in fly and use also kuberneets and with fake routing show my
> scale level and note it in docs what would i need

The "note it in docs" half. `.agents/ledgers/platform/SCALE.md`, written from the result files P04,
P06 and P08 left behind, plus a physical deployment diagram per target.

**The delivered `DECISIONS.md` at the repo root already has a `## Physical deployment` section**
(added 2026-08-12, commit `a973d56`) with a mermaid `flowchart LR` of the compose topology. That
diagram is not replaced — it is the compose target and stays. This task adds two more beside it and
points them at `SCALE.md`.

## Non-negotiables
- **The ceiling goes first, before any table.** Concurrent interviews are bounded by Redis
  connections, one per open stream (`sse.ts:180`), not by api replica count. A document that opens
  with a replica table teaches a reader that replicas are the knob, and then every true number
  underneath supports a false conclusion. A reader who stops after section 1 must still leave with
  the correct statement.
- **Every figure is transcribed from a file in `loadtest/results/`,** with the filename beside it.
  Nothing is quoted from a `## Notes` paragraph or a remembered terminal. If a number cannot be
  traced to a file, it does not go in.
- **Fly and kind tables are never compared as absolutes** (ADR-P02). kind numbers are bounded by a
  laptop and the machine is named in the section. What can be compared is the *shape* of each
  curve against replica count, and the section that does so says which comparison it is making.
- **State what was stubbed, in its own section, not a footnote.** Providers were fake, at injected
  latencies (P02's defaults, listed). Routing, replicas and load balancers were real. A scale
  document that does not say what it stubbed is a marketing document.
- **Name what was not measured.** Real provider latency and rate limits, multi-region, a database
  under write pressure, and the worker tier's behaviour at queue depths beyond what these runs
  produced.
- **Fly Postgres is a single node.** Say it. A reader will otherwise assume the data tier scaled
  alongside the app tier.
- **No new measurements in this task.** If a number is missing, the fix is to reopen the task that
  owed it — not to run a quick one here under different conditions and put it in the same table.

## Context (anchors)
- `loadtest/results/` — every input. `compose-1x-*` (P04), `fly-{1,2,4,8}x-*` (P06),
  `kind-{1,2,4,8}x-*` and `kind-hpa-room` (P08).
- P04, P06, P08 `## Notes` — the machine descriptions, the named binding resources, the abandon
  sweep count, and P08's HPA scaling events.
- `backend/modules/interview/sse.ts:180` and `:212` — the ceiling and the alternative the comment
  declined to build. Quote the comment; it is the most credible thing in the document.
- `DECISIONS.md` ADR-P09 — why the ceiling is named rather than fixed, which this document restates
  for a reader who will not open the ADR log.
- `PLAN.md` → Topology — the three-column ASCII diagram to expand into two per-target physical
  diagrams.
- `DECISIONS.md` (repo root) → `## Physical deployment` — the compose diagram, in mermaid
  `flowchart LR`. **Match that style, not PLAN.md's ASCII**, for anything landing in this file.
- `DECISIONS.md` (repo root) → `## What we knowingly left` — where the SSE ceiling belongs as a
  one-line entry pointing at ADR-P09, in the same shape as the existing `answers.scores` and
  streaming entries.
- `SETUP.md` — the clean-environment doc. It currently describes one path (compose). A reader who
  finds two new deploy targets in `DECISIONS.md` and nothing in `SETUP.md` will assume they are
  supported the same way; one short pointer prevents that.
- IDEA.md §13 — the delivery checklist that requires the physical deployment diagram.
- `.agents/ledgers/speech-latency/REFERENCE.md` — the real provider latencies, for the section that
  states the offset between a stubbed turn and a real one.

## Steps
- [ ] Write section 1, **the ceiling**: one Redis connection per open stream, the measured
      connections-per-VU ratio from P04's and P06's runs, the plan cap that bound the Fly runs, and
      the `sse.ts:212` comment quoted verbatim.
- [ ] Write section 2, **Fly**: the table (api machines × sustained concurrent interviews × p95 turn
      × req/s × p95 HTTP), the binding resource per row, the fixed web/worker/edge counts, and the
      result filenames.
- [ ] Write section 3, **kind**: the same table shape, the machine named, plus the HPA observation
      — time to first scale-up, settled replica count, whether p95 recovered.
- [ ] Write section 4, **what the two targets say together**: which parts of each curve have the
      same shape, where they diverge, and why (in-cluster Redis has no plan cap; a laptop has fewer
      cores than a Fly region).
- [ ] Draw the two physical deployment diagrams as mermaid `flowchart LR`, matching the compose
      diagram already in the root `DECISIONS.md`, showing the balancer, the replicated tier, the
      fixed tier, and the managed stores.
- [ ] Add both diagrams to the root `DECISIONS.md` `## Physical deployment` section, **beside** the
      compose one rather than replacing it, each labelled with its target, and link `SCALE.md` for
      the numbers.
- [ ] Add one line to the root `DECISIONS.md` `## What we knowingly left` — the SSE connection
      ceiling, pointing at ADR-P09, in the same shape as the existing entries.
- [ ] Add a short pointer in `SETUP.md` saying compose is the supported path and the two deploy
      targets are measurement setups documented in `k8s/README.md` and `fly/`.
- [ ] Write section 5, **what was faked**: the stubbed providers, the injected latencies with their
      values, and the explicit statement that routing, replicas and balancing were real.
- [ ] Write section 6, **not measured**: the list above, each with what it would take to measure.
- [ ] Add a Backlog row to `STATE.md` for the shared-subscriber SSE fix, with this document's
      measured ceiling as its trigger.

## Definition of done
- `.agents/ledgers/platform/SCALE.md` exists, opens with the ceiling, and every figure in it names
  the result file it came from.
- Both physical deployment diagrams are present, in `SCALE.md` and in the root `DECISIONS.md`, and
  the compose diagram that was already there is unchanged.
- The root `DECISIONS.md` `## What we knowingly left` names the SSE ceiling.
- A reader who stops after section 1 leaves with a true statement about what bounds this system.
- The stubbing is stated in its own section with the injected latencies listed.
- `STATE.md` carries the shared-subscriber Backlog row with a trigger.
- No number in the document lacks a file behind it.

## Verification
```bash
test -f .agents/ledgers/platform/SCALE.md && echo present

# every result file referenced by the doc must exist
grep -o 'loadtest/results/[a-z0-9._-]*' .agents/ledgers/platform/SCALE.md | sort -u | \
  while read -r f; do test -f "$f" && echo "ok $f" || echo "MISSING $f"; done

# and every result file must be referenced by the doc
ls loadtest/results/ | while read -r f; do
  grep -q "$f" .agents/ledgers/platform/SCALE.md && echo "cited $f" || echo "UNCITED $f"
done
```

Expect zero `MISSING` lines. An `UNCITED` line is not automatically a failure — a self-test run
from P03 legitimately does not belong in the table — but each one must be accounted for in
`## Notes`, because the other reason a result file goes uncited is that its numbers were
inconvenient.

Then read the document once from the top, out loud if that helps, and answer one question in
`## Notes`: **if a reader stopped after the first section, what would they believe?** If the answer
is anything other than "concurrency here is bounded by Redis connections, not replicas", the
section order is wrong.

## Notes
