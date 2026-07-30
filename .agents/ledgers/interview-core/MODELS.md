# Interview-core — Recommended Model Per Task

Interview-core carries two invariants at once: **cost** (no AI call unbilled, no budget
bypass) and **prompt-injection safety** (attacker text never becomes an instruction), plus
the server-owned state machine that guards progression. Every task that touches the AI
seam, the prompt boundary, the state transition table, schema validation, the budget
transaction, or untrusted upload bytes runs at the expensive tier. Mechanical CRUD, config
extension, rate-limit wiring over an existing factory, and health probes run at the
moderate tier.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| I01 | `@interviewly/ai` scaffold: `AiClient` seam, schemas, prompt registry, `PromptBuilder`, `StubAiClient` | `claude-opus-4.8` | The prompt-injection trust boundary + the schema contract every caller trusts |
| I02 | Provider execution: fallback chain, per-attempt `llm_calls`, cost, stub mode, key validation | `claude-opus-4.8` | Cost-audit invariant + AI-trust reliability; a hidden fallback cost is a defect |
| I03 | Interview setup, room-state read, ownership resolver, CSRF middleware | `claude-sonnet-4.6` | CRUD + a heuristic split over the F02 helpers; ownership is a one-line filter |
| I04 | Profiling + round question generation (HR batch, tech batch during HR) | `claude-opus-4.8` | Untrusted profile/listing → LLM through the injection boundary; schema-failure semantics |
| I05 | CSRF/origin enforcement on state-changing routes | `claude-opus-4.8` | A trust-boundary control; a weak origin check is a cross-site state-change hole |
| I06 | Answer submission, guarded advance, duration, round handover, resume | `claude-opus-4.8` | The K2 progression invariant — a race here targets a non-current question |
| I07 | State machine transition table + pause/resume + SSE state events | `claude-opus-4.8` | The full state-machine guard; an illegal transition corrupts interview integrity |
| I08 | Budget enforcement (in-transaction ceiling, exhaustion path) | `claude-opus-4.8` | The cost invariant — a bypass bills unbounded; answer-preservation is subtle |
| I09 | Report generation + `ReportPayload` schema gate + completion | `claude-opus-4.8` | AI-trust: a malformed report must never reach the caller or persist |
| I10 | Language detection + two-consecutive-turn switch counting | `claude-sonnet-4.6` | A deterministic no-LLM heuristic + a counter; no trust boundary |
| I11 | Upload validation (MIME/magic/size/pages/text) + `sha256` dedup | `claude-opus-4.8` | Untrusted file bytes at a trust boundary; magic-byte + extraction safety |
| I12 | Object-storage signed-URL wrapper + report download endpoint | `claude-opus-4.8` | Owner-scoped signed URLs; a TTL or ownership slip leaks another user's report |
| I13 | Rate limits: daily interview cap + interview-start limiter | `claude-sonnet-4.6` | Wiring over the A01 Redis limiter factory; no new trust boundary |
| I14 | Reliability probes: `/healthz`, `/readyz` | `claude-sonnet-4.6` | Two dependency checks; mechanical |
| I15 | Config: extend env schema with this ledger's keys, fail-fast | `claude-sonnet-4.6` | Zod schema extension over the F03 env base; mechanical |

## Summary

- **`claude-opus-4.8` (10 tasks):** I01, I02, I04, I05, I06, I07, I08, I09, I11, I12
- **`claude-sonnet-4.6` (5 tasks):** I03, I10, I13, I14, I15

Rule of thumb: **AI seam / prompt boundary / state machine / budget transaction / untrusted
bytes = expensive tier.** When unsure on a sonnet task if an edge case surfaces, run it with
sonnet and code-review the diff with `claude-opus-4.8` — cheaper than running the whole task
expensive. Never use haiku, mini, or flash for any interview-core task; the AI-trust and
cost invariants are exactly the ones a cheap model erodes silently.
