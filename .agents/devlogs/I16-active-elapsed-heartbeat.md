---
task: I16
author: Fatih
sessions: [2026-08-11]
model: claude-opus-5
model_recommended: claude-opus-4.8
iterations: 3
tools: []
---

## Session 1 — 2026-08-11

### Ownership — read this first

**This task was not run under EXECUTE.md § 4, and it is not in its author's seat.** § 1 gives
interview-core (`I01`–`I15`) and frontend (`W01`–`W11`) to Sezai and speech (`S`) to Ahmet; I16
touches all three (`schema.prisma`, `state.ts`, `speech/ceiling.ts`, `room-rail.tsx`). Fatih
raised the bug directly, was shown the § 1 conflict, and chose "implement it fully, ledger
included" over a design-only hand-off.

So: **Sezai and Ahmet did not write this and have not seen it.** The two files most likely to
surprise them are `speech/ceiling.ts` (signature change) and `state.ts` (`interviewWindow` gained
a field and a parameter). Nothing was renumbered and no existing task was reopened. If this
collides with work already in flight on either seat, this is the change to rebase, not theirs.

### The bug

`room-rail.tsx` rendered `now - startedAt`. Leave a three-minute interview, come back an hour
later, and the rail says `1:03:00`. The report of it was exactly that scenario.

The tempting fix — clamp the readout on the client — is wrong, and the codebase says so out loud.
S09 derived `speechExpiresAt` from the same `started_at` on purpose ("one arithmetic, deliberately
— a room told it has four minutes and cut off in one is what two copies of this produces"). Fix
only the readout and the rail says 3:00 while the server says the voice session expired forty
minutes ago. The measure had to move underneath both.

### The model

Bank plus one open stretch: `elapsed_seconds` is what closed room sessions contributed,
`last_seen_at` anchors the one still open, active time is the sum. A 15 s heartbeat advances the
anchor; a gap wider than `HEARTBEAT_GRACE_SECONDS` (30) is not counted.

**Absence is the signal, because absence is the only signal that survives the client vanishing.**
There is no reliable "left the room" event — `beforeunload` does not fire on a killed tab, a
crashed browser or a closed lid, and a leave button only covers the deliberate departure. A
design that banked on departure would be correct for the one exit that is already easy and wrong
for every other. Inferring it from the heartbeat stopping costs one column and handles all of
them.

### Friction

- **The frontend readout was wrong on the first pass and my own test caught it.** I anchored on
  "the elapsed number changed", which is right for a room that unmounts on the way out and wrong
  for the case the feature is about: a tab left open while the candidate is away gets a beat every
  15 s carrying the *same* figure, because the server is banking nothing. The readout sat on its
  original anchor and counted the whole absence — the exact bug, reintroduced one layer up. The
  fix is to anchor on when the response *arrived*, and react-query already tracks that as
  `dataUpdatedAt`, so the hook became a pure derivation with no `useState` at all.
- **Second pass on the arithmetic, after reading the acceptance suite.** AC-12 asserts
  `(expiresAt - startedAt) / 1000 === 300` exactly. My first `ceiling.ts` went ms → seconds →
  float subtraction → ms, and that round trip can land `expiresAt` a millisecond off the second it
  belongs on. Moved the whole path to integer milliseconds (`activeMs`, `speechRemainingMs`).
  Nothing was red; I would rather not find this from a flaky CI run six weeks out.
- **Two tabs would have double-counted.** An unguarded `increment` banks the same wall-clock
  second once per beating tab. The write is now guarded on the `last_seen_at` it read, and the
  loser re-reads instead of reporting a total only it believes.
- **`profile.ts` had to seed `last_seen_at`.** Without it `activeMs` is 0 at the start, and
  `expiresAt` comes back as `now + ceiling` rather than `started_at + ceiling` — which is what
  broke the AC-12 window scenario until I set it in the acceptance fixture too.
- **A Gherkin step had to be renamed, not just re-implemented.** "that interview started 2000
  seconds ago" no longer causes anything; under I16 an interview can have started a week ago with
  its full window intact. Renamed to "has spent 2000 seconds in the room" across
  `speech_turn.feature` and the step definition, because leaving the old phrase would have
  described the fixture rather than the cause.
- Bare `npx vitest` died on env validation, as AGENTS.md warns. Acceptance needed the
  `compose.dev.yaml` overlay for published db/redis ports, then `DATABASE_URL`/`REDIS_URL`
  exported at `localhost:5432` / `localhost:6380`.

### What I deliberately did not do

- **Did not pause the clock on a hidden tab.** Asked; the answer was that being in the room with
  another window in front is still being in the room. It is also the safer rule — a
  `visibilitychange` pause makes tab-switching an unbounded extension of a ceiling that gates
  billable provider calls.
- **Did not touch `/admin/stats`.** Its `ended_at - started_at` is now a different number from
  active duration, and "how long from start to finish" is a fair thing for an admin duration to
  mean. `elapsed_seconds` is there to sum if the N ledger wants the other one.
- **Did not touch the worker's 24 h `abandoned` sweep.** Wall clock is right there: a room nobody
  has entered in a day is stale whatever it banked.

### Verification

`npm run lint` clean · `npm run typecheck` clean (plus `tsc -p backend/tsconfig.json`, which the
root config does not cover — it includes `backend/src` but not `backend/modules`) · `npm test`
1020/1020 across 104 files · `npm run test:acceptance` 111 scenarios, 885 steps, all passing.

New coverage: `backend/modules/interview/elapsed.test.ts` (10 cases — grace boundary, the
hour-away case, clock-went-backwards, the two-tab race) and
`frontend/src/lib/use-room-clock.test.tsx` (9 cases, including 240 consecutive unchanged beats
holding the readout still).
