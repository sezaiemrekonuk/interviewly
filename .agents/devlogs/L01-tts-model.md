---
task: L01
author: Ahmet
sessions: [2026-08-12]
model: claude-opus-4.8
model_recommended: claude-sonnet-5
iterations: 0
tools: []
---

## Session 1 — 2026-08-12

### What I asked for / what came back
"start l01". Tier check fired: L01 is sonnet-tier, session ran opus-4.8 → printed
`TIER L01 needs sonnet, running opus`. Owner overrode ("okay to do with opus") and confirmed a
live ELEVENLABS_API_KEY, so proceeded on opus by explicit instruction — the `model` /
`model_recommended` split above records the deviation.

### Methodology trace
No red→green here — L01 is measure-listen-decide, not code (ADR-L03: the ear decides, no
correctness call for a test to catch). Bench script from a prior scratch (`bench/l01-tts-bench.mjs`)
mirrors `speak()` exactly. Ran live, n=5, warm-up discarded:
multilingual 1270/1483 ms → turbo 407/460 ms (EN/TR). Owner heard all 6 samples → "they all sound
the same" → SWAP to turbo_v2_5. Verification: `npm test -- --project node speech` 79/79, lint +
typecheck clean.

### Friction
REFERENCE flagged an identical-Turkish-byte anomaly (82,799 for both models) as reason to distrust
the comparison. Did not reproduce — 6/6 outputs distinct-hashed. It was a spike-time measurement
artefact; resolved and noted, no comparison void.

### What I rejected and rewrote by hand
Rejected purging the `speech/*` cache on swap. Keys carry no model marker, so the reflex is to
purge — but the owner judged the voices indistinguishable, so an in-flight session serving mixed
old/new bytes has no audible seam; purging would only re-bill interviews already running. Accepted
the stale cache instead. No app code written (config surface held, as the task required).
