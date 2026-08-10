# S09 — `startedAt` and `expiresAt` in `/state`, and the room timer
REPO: (this repo) · Depends: S02, I03 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — two fields onto an existing payload and a countdown that derives
from them. Deliberately derives, never counts independently.

## Goal
Owner's ask:

> "Ne kadar süre kaldığını görebileyim."
> — issue #105; speech spec AC-12

A voice interview runs against a hard server-side ceiling the candidate is never shown. When it
is reached the session simply stops — no countdown, no warning, no explanation. This adds the
two fields the room needs and the timer that renders them.

## Non-negotiables
- **The server's number is the number.** The room derives the countdown from `startedAt` and
  `expiresAt`; it never keeps its own elapsed total. Two clocks disagreeing is how a candidate is
  told they have four minutes and cut off in one.
- **A warning before the end, not only at it.** The ceiling ends the interview with
  `time_exhausted` (ADR-S06). Reaching that silently is the bug; a visible countdown plus one
  late warning is the fix.
- **The timer is not the enforcement.** Hiding it, pausing the tab, or blocking the render must
  change nothing about when the interview ends.
- **Text mode gets the fields too, and shows nothing.** The ceiling only bounds voice; adding a
  countdown to text mode would invent a pressure the product does not apply.

## Context (anchors)
- `backend/modules/interview/state.ts:160-173` — the `/state` payload. Add `startedAt` and
  `expiresAt`; every other field is already derived from the DB, and these are too.
- `backend/modules/interview/profile.ts:112` — where `started_at` is stamped.
- `backend/src/lib/env.ts:43-44` — the two ceilings; `expiresAt` is
  `started_at + min(roundLeft, interviewLeft)`, the same arithmetic S02 and S03 do.
- `frontend/src/lib/query.ts:242,282` — the typed `/state` response the two fields join.
- `frontend/src/components/room/voice-controls.tsx:32-56` — mute, meter, status chip. The timer
  goes here.
- `frontend/src/app/interviews/[id]/room/page.tsx:140-152` — the only progress indicator today.

## Steps
- [x] **1. Test red** — `/state` returns both fields; the room renders a countdown that matches
  them; a text interview renders none. See them red.
- [x] **2. Backend fields** — `startedAt` and `expiresAt` on the payload, computed the same way
  S02 computes the ceiling. One helper, used by both, so they cannot drift.
- [x] **3. Types** — `lib/query.ts`'s `/state` response.
- [x] **4. Timer** — a countdown in `voice-controls.tsx` derived from the two fields, with a
  visible warning state near the end.
- [x] **5. Accessibility** — the remaining time is announced once at the warning threshold, not
  every tick, and the countdown is not colour-only (`ui` §4.4).
- [x] **6. Unit test** — the countdown follows the server's `expiresAt` when the two disagree.

## Definition of done
- speech AC-12 green.
- The room shows time remaining, and it matches what the server enforces.
- A text interview shows no timer.
- Nothing about when the interview ends depends on the timer being rendered.

## Verification
```bash
npm test -- --project node interview/state
npm run -w frontend test -- room
curl -s -b "$COOKIE" localhost/api/interviews/$ID/state | jq '{startedAt, expiresAt}'
```
Expected: tests green; the curl prints two non-null ISO timestamps for a started voice
interview.

## Notes

**What exists now.** `backend/modules/speech/ceiling.ts` (new) owns the arithmetic:
`speechExpiresAt(startedAt, maxDurationSeconds)` returns the instant, `isPastSpeechCeiling` is
now "`clock.now()` is at or past it". `tts.ts` re-exports the guard, so `stt.ts:89`,
`tts.ts:77` and `tts.test.ts` are unchanged (ADR-S09).

`state.ts` gained exported `interviewWindow(interview)` → `{ startedAt, expiresAt }`, spread into
the `/state` payload. `expiresAt` is null in text mode and before `started_at` is stamped.

Frontend: `InterviewStateResponse` gained both fields. `voice-controls.tsx` has `TimeRemaining`
(module-private) driven by a new required `expiresAt` prop — **any other caller of
`VoiceControls` must pass it.** Warning threshold `WARN_AT_SECONDS = 60`; warn state is a word
(`room.timeLeftWarning`) plus tone, and one fixed sentence in a `role="status"` region
(`data-testid="time-warning"`), never the ticking figure.

`frontend/src/lib/use-clock.ts` (new) is `useNowMs()` — the wall clock behind
`useSyncExternalStore`, one interval shared by every subscriber, `0` before subscribe and on the
server. **Both readouts go through it; use it for any future ticking readout.**
`frontend/eslint.config.mjs` forbids `Date.now()` during render (`react-hooks/purity`) *and* a
`setState` seed in an effect body (`react-hooks/set-state-in-effect`), which rules out both
obvious shapes — a store is what is left. **That config runs in the pre-commit hook and NOT in
root `npm run lint`**, so a clean `npm run lint` is not evidence the commit will land.

**Deviation from plan.** `room-rail.tsx`'s `useElapsed` was a second clock counting from arrival
— the ponytail on it asked for exactly this field. It now derives from `room.startedAt`
(`data-testid="room-elapsed"`), and `room.elapsedNote` changed in both locales. Not in the step
list, but leaving it would have left two clocks in one room, which non-negotiable 1 forbids.

**New copy** (en + tr): `room.timeLeftLabel`, `room.timeLeftWarning`, `room.timeLeftAnnounce`;
`room.elapsedNote` rewritten.

**Verification.** `interview/state` 9 passed; frontend `room` 35 passed (full frontend 455);
unit 810; acceptance 111/111 (was 107 — the four new `@speech @AC-12` scenarios). The curl
printed `startedAt 2026-08-10T08:24:48.431Z` / `expiresAt …08:36:48.431Z`, exactly +720s.

**For S10.** The room's failure copy lands in the same `VoiceControls`; `TimeRemaining` sits
first in `styles.bar` and is unrelated to `session.error`. The lost banner is still untested
(ledger tech debt), and nothing in S09 touched it.

**Local-environment trap, cost ~20 min.** `compose.dev.yaml` publishes `db` on **5432**, and on
this machine 5432 is a different Postgres (`role "interviewly" does not exist`) — the compose DB
is unreachable from the host. Recreating the stack without `-f compose.dev.yaml` also silently
drops every host port. What worked: `docker compose -f compose.yaml -f compose.dev.yaml up -d`,
then a throwaway forwarder
`docker run --rm -d --name pgfwd-tmp --network interviewly_default -p 15432:5432 alpine/socat tcp-listen:5432,fork,reuseaddr tcp-connect:db:5432`
and the ring pointed at 15432. Redis stays a throwaway on 16999 (the compose one has the worker
attached). Both containers were removed at the end of the run.
