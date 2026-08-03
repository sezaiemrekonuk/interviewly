# Frontend — Recommended Model Per Task

The frontend carries one invariant: **the client never owns interview truth or a display
string** (PLAN.md). The tasks that erode it silently are the ones with real state judgement —
the React-Query + SSE data layer everything trusts, the room's client-driven avatar state
machine and guarded submit, the report-wait transition, and the voice room's live driver. Those
run at the expensive tier. Screen composition over an existing data layer, forms over an
existing API, a token-lint suite, and a chart bound to server numbers are mechanical.

`EXECUTE.md` §5 bans haiku, mini and flash in any tier row — never use them here.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| W01 | UI build/seed checks (token lint, AA-contrast, avatar/mascot validation, gradient/shadow) | `claude-sonnet-4.6` | A deterministic Vitest suite over fixed token values and seeded objects; no state, no trust boundary |
| W02 | App shell + React Query data layer + SSE hook + error-code→route map + locale switcher | `claude-opus-4.8` | The layer every screen trusts: the single-source-of-truth query key, the nudge-then-refetch SSE seam, and the error-routing table — a subtle bug here (render from SSE payload, wrong invalidation, mis-routed code) is the invariant breaking (K11, §4.5) |
| W03 | Landing (screen 1) + `<Mascot>` primitive | `claude-sonnet-4.6` | A server-component page with no data fetch + a plain-`<img>` preload component; the LCP/bundle budgets are measured, not reasoned |
| W04 | Onboarding host (screens 6–8) | `claude-sonnet-4.6` | Three forms over `PATCH /me/profile`; per-card persistence and server-derived resume are stated verbatim in the task and the API |
| W05 | Setup (screen 9) + mobile | `claude-sonnet-4.6` | A large form + upload + local chip/card actions over existing endpoints; the one subtlety (typed text survives every error) is pinned in the task |
| W06 | Interview room text mode (screen 11) + widgets + mobile | `claude-opus-4.8` | The client avatar state machine, the typed-question animation timing, the guarded no-optimistic-advance submit, and the round handover — all correctness-critical presentation state derived from refetched truth (§3.8) |
| W07 | Report + transcript (screen 12) | `claude-opus-4.8` | The `evaluating` report-wait transition with the SSE-primary / bounded-poll fallback, and read-only rendering of the K15 `ReportPayload` — the degraded-transport tail is where this goes wrong (§8.1, K10) |
| W08 | History / dashboard (screen 13) | `claude-sonnet-4.6` | A cursor-paginated list with an optimistic delete over `GET /me/interviews`; the delete-then-reconcile pattern is one React Query mutation |
| W09 | Pre-join device check (screen 10, voice) | `claude-sonnet-4.6` | `getUserMedia` bound to a local `<video>` + a permission-denied downgrade; no server truth, camera off by default is a stated default |
| W10 | Voice room surface (screen 11-voice) | `claude-opus-4.8` | The live ASR transcript, the amplitude avatar driver and the fatal-error → text downgrade — real streaming state on top of W06's room, gated on the voice ledger |
| W11 | Admin list + stats (screen 14) | `claude-sonnet-4.6` | Tables + Recharts bound to `GET /admin/stats` **as returned** — the client never recomputes a metric (K11), so there is no judgement to get wrong |

## Summary

- **`claude-opus-4.8` (4 tasks):** W02, W06, W07, W10 — the data/SSE layer, the text room, the
  report-wait, the voice room.
- **`claude-sonnet-4.6` (7 tasks):** W01, W03, W04, W05, W08, W09, W11.

Rule of thumb: **the data layer / a client state machine / a transport-degradation path = the
expensive tier; screen composition over an existing endpoint = the moderate tier.** When a
sonnet task surfaces a real edge case (an optimistic-update race, an SSE reconnect gap), run it
with sonnet and code-review the diff with `claude-opus-4.8` — cheaper than running the whole task
expensive. Never use haiku, mini or flash: the invariant a cheap model erodes is exactly the one
that renders a raw error code or a room from a stale SSE payload.
