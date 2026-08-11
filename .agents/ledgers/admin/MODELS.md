# Admin — Recommended Model Per Task

The admin surface is a trust boundary (the `/admin/*` role gate) wrapped around otherwise
plain relational reads. The task that builds the role gate and the soft-delete audit
correctness runs at the expensive tier; the pure aggregation endpoint runs at the moderate
tier.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| N01 | Admin-role gate + soft-delete audit path: `requireAdmin`, `GET /admin/interviews`, `DELETE /interviews/:id`, `GET /me/interviews` | `claude-opus-4.8` | Admin-role trust boundary + soft-delete-audit correctness — a leak of a deleted row into a user list, or an open `/admin/*` surface, is a 5-point security regression |
| N02 | Admin stats aggregation: `GET /admin/stats` (K11 metrics) | `claude-sonnet-4.6` | Plain relational read/aggregation over F02 tables to K11's fixed definitions; the trust boundary it sits behind was already authored on opus in N01 |
| N03 | Security, budget and time events land in `audit_logs` (US-29) | `claude-opus-4.8` | Changes a security-signal path and opens a seam across a package boundary. A sink that leaked the matched value puts candidate text in a durable table (issue 063); an audit write that can fail an interview turn is an availability regression. Security/availability, not a wrong number |
| N04 | Interview list facets and the per-interview drill-down | `claude-sonnet-4.6` | Relational reads behind a gate N01 already authored and hardened on opus. Facets narrow an already-audited query; the drill-down is a `findUnique` plus two `findMany`s |
| N05 | The console's remaining read endpoints and per-model spend | `claude-sonnet-4.6` | Five bounded cursor-paged reads and one Postgres aggregation, all on the existing gate. No new trust boundary |
| N06 | One query language behind every console list, and a sort that pages correctly | `claude-opus-4.8` | A parser on a trust boundary — a whitelist is the only thing between a field name on the query string and a column — plus cursor correctness under a variable sort. Both failures answer `200` with wrong rows, which is the silent kind, not the loud kind |

## Summary

- **`claude-opus-4.8` (3 tasks):** N01, N03, N06
- **`claude-sonnet-4.6` (3 tasks):** N02, N04, N05

Rule of thumb: **admin-role trust boundary, soft-delete-audit correctness, and any change to a
security-signal path = expensive tier; plain relational read/aggregation endpoints = moderate
tier.** N03 is the second opus row and it writes no endpoint at all: a sink that carried the
matched value, or an audit write that could fail an interview turn, is a security or
availability regression rather than a wrong number. N04 and N05 sit at the moderate tier by
the same reasoning as N02 — reads and one `groupBy` behind a gate that was authored on opus
and has not changed since. N02 only adds an aggregation
handler behind the `requireAdmin` gate N01 already built and hardened — the security-critical
code is opus-authored, so the aggregation is safe to run on sonnet. When unsure on N02 if a
grouping edge case (empty `perOccupation`, no completed interviews for `averageDurationMs`)
bites, run it on sonnet and code-review the diff with `claude-opus-4.8` — cheaper than running
the whole task expensive; the same fallback applies to N04 and N05. N06 is the third opus row
and it adds no endpoint either: it is a parser compiling a query string into a `where` clause,
so the expensive-tier trigger is the whitelist (reflection would have answered `password_hash:*`)
and the cursor's order-sensitivity, not the five reads it sits on top of. Its `computed` field
is the same rule read a third way — one condition built from two columns and an injected clock,
where the wrong clock is a security surface that looks right. Never use haiku, mini, or flash
for any admin task.
