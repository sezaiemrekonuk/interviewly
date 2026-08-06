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
- [ ] **1. Test red** — `/state` returns both fields; the room renders a countdown that matches
  them; a text interview renders none. See them red.
- [ ] **2. Backend fields** — `startedAt` and `expiresAt` on the payload, computed the same way
  S02 computes the ceiling. One helper, used by both, so they cannot drift.
- [ ] **3. Types** — `lib/query.ts`'s `/state` response.
- [ ] **4. Timer** — a countdown in `voice-controls.tsx` derived from the two fields, with a
  visible warning state near the end.
- [ ] **5. Accessibility** — the remaining time is announced once at the warning threshold, not
  every tick, and the countdown is not colour-only (`ui` §4.4).
- [ ] **6. Unit test** — the countdown follows the server's `expiresAt` when the two disagree.

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
