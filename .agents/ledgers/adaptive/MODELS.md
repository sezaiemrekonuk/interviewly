# Adaptive — Recommended Model Per Task

Adaptive carries one hard invariant: **a malformed or schema-invalid answer score must never
select a graded next question.** Every task that interprets a score or guards that boundary
runs at the expensive tier. The pure candidate-assembly wiring — which interprets no score —
runs at the moderate tier.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| D01 | Adaptive score→question selector and malformed-score guard (pure module) | `claude-opus-4.8` | score→difficulty mapping + the malformed-score guard — the AI-trust/correctness heart of the invariant |
| D02 | Next-question candidate pre-generation during a turn | `claude-sonnet-4.6` | mechanical wiring over the `generateCandidates` seam; interprets no score, introduces no trust boundary |
| D03 | Score-driven promotion and malformed-score fallback (greens `@adaptive-questions`) | `claude-opus-4.8` | the fallback branch **is** the invariant; a wrong guard here lets a bad score drive a graded question |

## Summary

- **`claude-opus-4.8` (2 tasks):** D01, D03
- **`claude-sonnet-4.6` (1 task):** D02

Rule of thumb: **score→difficulty mapping + malformed-score guard (AI-trust/correctness) =
expensive tier; any mechanical wiring over the AI seam = moderate tier.** If D02 hits an edge
case, run it sonnet and code-review the diff with `claude-opus-4.8` — cheaper than running the
whole task expensive. Never use haiku, mini, or flash for any adaptive ledger task.
