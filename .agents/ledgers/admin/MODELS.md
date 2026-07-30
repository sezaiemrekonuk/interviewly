# Admin — Recommended Model Per Task

The admin surface is a trust boundary (the `/admin/*` role gate) wrapped around otherwise
plain relational reads. The task that builds the role gate and the soft-delete audit
correctness runs at the expensive tier; the pure aggregation endpoint runs at the moderate
tier.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| N01 | Admin-role gate + soft-delete audit path: `requireAdmin`, `GET /admin/interviews`, `DELETE /interviews/:id`, `GET /me/interviews` | `claude-opus-4.8` | Admin-role trust boundary + soft-delete-audit correctness — a leak of a deleted row into a user list, or an open `/admin/*` surface, is a 5-point security regression |
| N02 | Admin stats aggregation: `GET /admin/stats` (K11 metrics) | `claude-sonnet-4.6` | Plain relational read/aggregation over F02 tables to K11's fixed definitions; the trust boundary it sits behind was already authored on opus in N01 |

## Summary

- **`claude-opus-4.8` (1 task):** N01
- **`claude-sonnet-4.6` (1 task):** N02

Rule of thumb: **admin-role trust boundary + soft-delete-audit correctness = expensive tier;
plain relational read/aggregation endpoints = moderate tier.** N02 only adds an aggregation
handler behind the `requireAdmin` gate N01 already built and hardened — the security-critical
code is opus-authored, so the aggregation is safe to run on sonnet. When unsure on N02 if a
grouping edge case (empty `perOccupation`, no completed interviews for `averageDurationMs`)
bites, run it on sonnet and code-review the diff with `claude-opus-4.8` — cheaper than running
the whole task expensive. Never use haiku, mini, or flash for either admin task.
