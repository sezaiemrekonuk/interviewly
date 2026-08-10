---
task: S09
author: Ahmet
sessions: [2026-08-10]
model: claude-opus-5
model_recommended: claude-sonnet-5
iterations: 4
tools: [superpowers:test-driven-development, cucumber, vitest, docker]
---

## Session 1 — 2026-08-10

### What I asked for / what came back
- Ran on **opus, not the sonnet tier `MODELS.md:21` names.** EXECUTE.md §5 ended the first run
  with `TIER S09 needs sonnet-tier, running claude-opus-5[1m]`; the owner said continue anyway.
  Recorded, not aligned — the frontmatter above is the honest pair.
- The invocation (`start s09`) named no person either. Proceeded as Ahmet on the `S`-prefix rule
  plus the git identity, stated as an assumption rather than guessed silently.

### Methodology trace
speech spec AC-12 → `speech_turn.feature:188-219` (4 scenarios) → red (`startedAt missing` in the
`/state` body) → `ceiling.ts` + `interviewWindow` → green, 111/111.
Frontend: `voice-controls.test.tsx` → red (`time-remaining` absent) → `TimeRemaining` → green.

### Friction
- **First red was red for the wrong reason.** All four scenarios failed at setup with
  `500 INTERNAL_ERROR`, not at the assertion. A stale Prisma client, not my diff —
  `git stash` proved the same failure on a clean tree. `npx prisma generate` fixed it and the
  scenarios were re-run to see them fail on the missing fields. A red that is not the red you
  expected is not evidence.
- **~20 min lost to compose ports.** `docker compose up -d api` (no `-f compose.dev.yaml`)
  recreated the stack from the base file and dropped every published host port mid-run, so the
  ring died with `Can't reach database server`. Worse, `compose.dev.yaml` now publishes `db` on
  5432 and this machine already runs a different Postgres there. Fixed with a throwaway socat
  forwarder; the recipe is in the task Notes and the stale memory has been corrected.
- The api image has no bind mount, so the task's `curl` verification needed a full
  `docker compose build api` before it could see the new fields.
- **Reported the work done on a gate that does not cover it.** Root `npm run lint` was green;
  the pre-commit hook runs `frontend/eslint.config.mjs`, which is stricter, and rejected the
  commit with three `react-hooks/set-state-in-effect` errors. Both timer hooks had to be
  rebuilt. The lesson is in the task Notes: for frontend changes, run that config directly.

### What I rejected and rewrote by hand
- **Rejected: computing `min(round, interview, chosen)` a second time inside `state.ts`.** It
  typechecks and passes, and it is exactly the two-clock failure the task forbids. Rewrote as
  `speechExpiresAt` in a new `ceiling.ts`, with `isPastSpeechCeiling` redefined on top of it so
  the guard and the payload are one expression (ADR-S09).
- **Rejected: `useState(0)` + `setSeconds(s => s + 1)` for the countdown** — the same shape the
  rail already had. It drifts the moment the tab sleeps or the server's window moves. Rewrote to
  subtract two timestamps every tick; the test that pins this rerenders with a shorter deadline
  and asserts the display jumps to it.
- **Rejected two further shapes the linter refused, in order.** `setSeconds(read())` to seed the
  effect (`set-state-in-effect`), then a repaint counter with `Date.now()` computed in the render
  body (`purity`). Landed on `useSyncExternalStore` over a module-level clock
  (`lib/use-clock.ts`) — which is better than what I set out to write: one interval for the whole
  room, so the rail's elapsed and the countdown read the same instant by construction.
- **Rejected: putting the ticking figure in the `aria-live` region.** A screen reader would read
  it once per second. Split into a silent readout plus one fixed sentence that is set once at the
  60s threshold and never changes again.
- **Rejected leaving `room-rail.tsx` alone** to stay inside the six listed steps. Its `useElapsed`
  counted from arrival and its own ponytail asked for `startedAt`. Two clocks in one room is what
  the task's first non-negotiable is about, so it was rewired and the copy changed in both
  locales; the deviation is written into the Notes rather than smuggled.
