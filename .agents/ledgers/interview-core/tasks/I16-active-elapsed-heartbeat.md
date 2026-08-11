# I16 — Active elapsed: the room's clock measures time in the room, not time since the start
REPO: (this repo) · Depends: I03, I07, S09 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — this moves the measure the speech ceiling enforces on. `isPastSpeechCeiling` ends interviews and refuses billable provider calls; a ceiling that can be extended by a client is a cost hole, and one that fires early cuts a candidate off mid-answer. The state-machine and budget tier applies.

## Goal
Owner's ask:

> "I left the interview and came back — the elapsed clock should start from the minute I left
> it at. Say I was 3 minutes into the interview and left; if I come back an hour later I want
> to carry on from 3 minutes."
> — Fatih, 2026-08-11

The room's elapsed readout was `now - interviews.started_at`: a stopwatch with no stop. Leaving
and returning an hour later showed `1:03:00` for three minutes of interview. Worse, S09 derives
`speechExpiresAt` from the *same* anchor deliberately ("one arithmetic" — a rendered countdown
and a `VOICE_SESSION_EXPIRED` must not name different times), so a voice interview was simply
over by the time the candidate came back to it.

This task moves both onto **active time**: seconds the candidate has actually been in the room.

## Security boundaries
- **The ceiling can only be spent, never extended by a client.** The bank lives in
  `interviews.elapsed_seconds`; the heartbeat's only power is to advance `last_seen_at` and add
  the stretch since the last one. It carries no client-supplied duration — a request body cannot
  buy or refund interview time, which is the same rule S08 put on `max_duration_seconds`.
- **Absence is inferred server-side.** A gap wider than `HEARTBEAT_GRACE_SECONDS` is not counted.
  A client that stops beating cannot thereby keep its session alive; it simply stops spending.
- **Heartbeat is behind ownership and CSRF.** It is a non-`GET` route on the interview router, so
  `resolveInterview` and `requirePublicOrigin` both cover it with no per-route wiring.
- **Finished interviews bank nothing.** `LIVE_STATES` gates the write, so a beat that races the
  last answer cannot grow a figure the report has already used.

## Non-negotiables
- **One arithmetic, still.** `activeMs` is the single source; `interviewWindow`, `speechExpiresAt`
  and `isPastSpeechCeiling` all read it. S09's invariant survives the move.
- **Millisecond arithmetic through the ceiling.** Seconds would put a divide and a multiply
  between `last_seen_at` and the deadline derived from it, and the AC-12 window scenario asserts
  `expiresAt - startedAt` to the millisecond.
- **`started_at` keeps its old meaning.** It is the interview's date — history's ordering, the
  report, `/admin/stats` duration — and is no longer the anchor for anything time-remaining.
- **Concurrent tabs spend one second per second.** The bank write is guarded on the
  `last_seen_at` it read, so two tabs beating cannot double-count the same wall-clock second.
- **`expiresAt` may now move later.** It is `now + remaining`, so a break pushes it out. Every
  consumer must re-derive from it rather than latching it.

## Context (anchors)
- `backend/prisma/schema.prisma` + `migrations/20260811140000_interview_active_elapsed/` —
  **created.** `elapsed_seconds INTEGER NOT NULL DEFAULT 0` (with a non-negative CHECK) and
  `last_seen_at TIMESTAMP(3)`. Additive only, per ADR-F02's migration protocol.
- `backend/modules/interview/elapsed.ts` — **create.** `activeMs`/`activeSeconds`,
  `bankActiveTime`, `HEARTBEAT_GRACE_SECONDS`. The whole model lives here.
- `backend/modules/interview/heartbeat.ts` — **create.** `POST /interviews/:id/heartbeat`.
- `backend/modules/speech/ceiling.ts` — rewritten onto `activeMs`. `speechRemainingSeconds`
  became `speechRemainingMs`; both `speechExpiresAt` and `isPastSpeechCeiling` now take the
  interview row rather than `(startedAt, maxDurationSeconds)`.
- `backend/modules/interview/state.ts` — `interviewWindow` gains `elapsedSeconds` and an
  injectable `now`.
- `backend/modules/interview/profile.ts` — seeds `last_seen_at` with `started_at`, so the seconds
  before the first beat are not lost.
- `frontend/src/lib/use-room-clock.ts` — **create.** `useRoomHeartbeat` (15 s, writes the reply
  into the `interviewState` cache entry) and `useRoomElapsed`.
- `frontend/src/components/room/room-rail.tsx` — reads `elapsedSeconds` + `dataUpdatedAt`.

  **The trap:** `useRoomElapsed` must anchor on **when the response arrived**, not on when the
  number last changed. A tab left open while the candidate is away receives a beat every 15 s
  carrying the *same* elapsed figure, because the server is banking nothing across the gap. A
  readout that re-anchored only on change would sit on its original anchor and count the whole
  absence — exactly the bug this task exists to remove. react-query's `dataUpdatedAt` is the
  arrival instant and is why it is threaded down to the rail.

## Steps
- [x] Schema + migration for `elapsed_seconds` / `last_seen_at`.
- [x] `elapsed.ts`: the bank-plus-open-stretch model and the guarded banking write.
- [x] `ceiling.ts` onto `activeMs`, in milliseconds; update the two speech callers.
- [x] `interviewWindow` reports `elapsedSeconds`; `profile.ts` seeds the first anchor.
- [x] `POST /heartbeat` + router mount.
- [x] Frontend: `useRoomHeartbeat`, `useRoomElapsed`, rail + room page wiring.
- [x] Rewrite the S09/S08 ceiling tests onto active time; rename the acceptance step that
      backdated `started_at` to one that banks room time.

## Verification
```bash
npm run lint && npm run typecheck && npm test && npm run test:acceptance
```

## Notes
Hand-off content for the next session:

- **`speechExpiresAt`/`isPastSpeechCeiling` changed signature.** Both take the interview row
  (`Ceilinged`: `started_at`, `elapsed_seconds`, `last_seen_at`, `max_duration_seconds`) instead
  of `(startedAt, maxDurationSeconds)`. Every current caller already had the row in hand.
- **`interviewWindow` takes an optional `now`.** Tests should pass it; production calls do not.
- **A test that wants an interview out of time sets `elapsed_seconds`.** Advancing the mocked
  clock no longer does it, and that is the point — see `tts.test.ts`'s `spent()` helper.
- **`ended_at - started_at` in `/admin/stats` is still wall clock** and is now a different number
  from the interview's active duration. Left alone deliberately: "how long did this take from
  start to finish" is a fair thing for an admin duration to mean, and no copy claims otherwise.
  If the admin ledger wants active duration, `elapsed_seconds` is now a column it can sum — **N
  ledger, flag to Fatih.**
- **No `abandoned` sweeper interaction was changed.** The worker's 24 h sweep still reads wall
  clock, which is right: a room nobody has been in for a day is stale however few active seconds
  it banked.
- **`HEARTBEAT_GRACE_SECONDS` (30) and `ROOM_HEARTBEAT_MS` (15 s) are a pair.** The grace must
  stay at least 2× the interval or an ordinary late beat forfeits its stretch. They are in two
  files (server and client) because neither ring imports the other; if a third consumer appears,
  promote the pair into `@interviewly/types`.
