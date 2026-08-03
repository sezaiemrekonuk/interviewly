# W06 — Interview room, TEXT mode (screen 11): two-tile room, client avatar state machine, guarded answer submit
REPO: (this repo) · Depends: W02, I03, I06, I07 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — the demoable core and the invariant's sharpest edge. The two-tile
speaker resolution, the client-driven `AvatarState` lifecycle (§3.8), the SSE-nudge-then-refetch
loop, and the `QUESTION_NOT_CURRENT` guarded advance all sit here; a render-from-payload or a
wrong-current submit is a K11/K2 violation. This needs state-machine judgement, not composition.

## Goal
Owner's ask (frontend spec screen 11, text mode):

> "The interview room — the two persona tiles, the live question, the answer composer, the
> transcript so far. In text mode the candidate types an answer and submits; the avatar animates
> the question and reacts to the submit; the room advances only when the server says the next
> question is current."
> — frontend spec §Behaviour screen 11; PLAN_FRONTEND_LEDGER.md §3 phase 3

Build the text-mode interview room at `/interviews/:id/room` over the room-state, answers, resume
and SSE endpoints (I03/I06/I07), plus the `<Avatar>` primitive. Voice is W09/W10 — this task ships
text mode only and needs no `V02` webhook.

## Security boundaries
- **The room renders from `GET /interviews/:id/state`, never from an SSE payload** (K11, ADR-W02).
  `useInterviewEvents(id)` (W02) only invalidates `['interview',id,'state']`; the tiles, the
  current question and the transcript cursor all read the refetched state. The `{ type }` body is
  never read.
- **Advance is server-authoritative** (K2). The client submits an answer for the question it
  believes is current; a `409 QUESTION_NOT_CURRENT` triggers a **silent** state refetch (no toast)
  and re-renders from truth — the client never advances its own index.
- **Ownership is the backend's** — a non-owner hitting the room gets `FORBIDDEN`/`INTERVIEW_NOT_FOUND`
  routed by W02's table; the client leaks no existence.

## Non-negotiables
- **Two tiles, one live speaker.** `persona` in room-state is the *active* speaker only; the other
  tile is resolved from the rounds already known — never invent a second live speaker (§3.2, K2).
  Only the active tile wears the `--live` ring; `--live` appears nowhere else and never off the room.
- **Client-driven avatar state machine (§3.8).** `persona.avatarState` is the sync value on every
  refetch; between refetches the lifecycle drives `<Avatar state>`: awaiting next → `thinking`;
  question mid-animation → `speaking`; shown & awaiting input → `listening`; just after submit →
  `acknowledging`; idle → `idle`. Typed-question animation is **40 chars/sec**, instant under
  `prefers-reduced-motion`.
- **`deliveredAt` is server-stamped** — the client never computes answer duration from a local
  clock (REFERENCE room-state note).
- **Answer submit** is `POST /interviews/:id/answers` with `{ questionId, transcript, inputMode:
  'text' }`; it does not retry (W02 mutation policy); on success the state refetch (nudged by SSE or
  the response) drives the next question; `widget` input is out of scope while `currentQuestion.
  widget` is always `null` (I04/I06) — render text mode only.
- **Resume** — a `paused` state offers a resume affordance calling `POST /interviews/:id/resume`;
  `BUDGET_EXCEEDED` refetches into `evaluating` → routes to report-wait (W07's surface).
- **The room is NOT an entry surface** — flat `--bg`, `--shadow-hairline` only, no gradient, no
  mascot (a mascot in the room is a defect, ui). Motion is near-zero except the type animation.
- **States (verbatim):** loading = the room skeleton while the first `['interview',id,'state']`
  resolves; error = the mapped route/inline behaviour from W02's table; empty = `currentQuestion:
  null` in a live round shows the "waiting for the next question" beat, not a blank panel.
- **Mobile** — the two tiles stack and the composer stays reachable above the keyboard at ≤ 375 px.
- **Both locales** carry `room.*`.

## Non-negotiables — do NOT
- Do not parse or render the SSE event body. Do not maintain a local question queue or advance the
  index client-side. Do not animate a second live speaker. Do not show a mascot or `--live` outside
  the active tile.

## Context (anchors)
- `frontend/src/app/interviews/[id]/room/page.tsx` — **create.** The room host: `useInterviewState(id)`
  (W02) + `useInterviewEvents(id)` (W02); render the two tiles, the live question (typed animation),
  the composer, and the transcript-so-far; wire submit/resume; guard auth; route on the error codes.
- `frontend/src/components/room/persona-tiles.tsx` — **create.** The two `<Avatar>` tiles; only the
  active one wears `--live`; the inactive tile resolved from the round list, not a second `persona`.
- `frontend/src/components/room/question-panel.tsx` — **create.** The current question with the
  40-char/sec type animation (instant under reduced motion) driving the `speaking`→`listening`
  transition.
- `frontend/src/components/room/answer-composer.tsx` — **create.** The text composer; submit →
  `POST /interviews/:id/answers` `{ inputMode: 'text' }`; disabled while in flight; `409` → silent
  refetch.
- `frontend/src/components/room/transcript.tsx` — **create.** The answered turns so far (up to
  `transcriptCursor`); reused read-only by W07.
- `frontend/src/components/avatar.tsx` — **create.** `<Avatar personaId state>` plain `<img>` at the
  content-addressed `personas/{id}/{state}-{sha}.webp` key; `idle` placeholder fallback on error;
  typed on `AvatarState`. Preload both personas' full sets during the waiting beat (ui).
- `frontend/src/lib/room-avatar.ts` — **create.** The pure §3.8 lifecycle→`AvatarState` reducer
  (input: lifecycle phase + refetch sync value; output: the state to render). Unit-tested in
  isolation — this is where the state-machine correctness lives.
- `frontend/src/lib/query.ts` / `use-interview-events.ts` (:W02) — reuse the state key + SSE hook;
  add the `answers` and `resume` mutations (no retry).
- `frontend/messages/{en,tr}.json` — **modify.** `room.*` in both files.
- `frontend/src/app/interviews/[id]/room/page.test.tsx` + `src/lib/room-avatar.test.ts` — **create.**
  Use W02's `event-source-mock`. Assert: an SSE event triggers a state refetch and the tiles/question
  re-render from it (not from the event); a submit posts `{ inputMode: 'text' }` once; a `409`
  response silently refetches and does not toast; the avatar reducer produces the §3.8 state for each
  lifecycle phase; only the active tile carries `--live`.
- REFERENCE §room-state shape, §avatar state machine, §error table — the authorities. Do not restate
  a shape or add an error code.

  **The trap:** the tempting shortcut is to read the SSE event's `{ type }` and update the UI from
  it (fewer refetches). That is the exact K11 violation this whole layer exists to prevent. The
  event is a *nudge*; the render is always from the refetched `['interview',id,'state']`. Every
  room test must prove the render followed a refetch, not the event body.

## Steps
- [ ] **1. `room-avatar.ts`** — the pure §3.8 lifecycle→`AvatarState` reducer + its unit test.
- [ ] **2. `avatar.tsx`** — `<Avatar personaId state>` with the `idle` fallback + set preload.
- [ ] **3. `persona-tiles.tsx`** — two tiles, active-only `--live`, inactive resolved from rounds.
- [ ] **4. `question-panel.tsx`** — 40-char/sec type animation, reduced-motion instant.
- [ ] **5. `answer-composer.tsx` + `answers`/`resume` mutations** — `{ inputMode: 'text' }`, no
  retry, `409` → silent refetch.
- [ ] **6. `transcript.tsx`** — answered turns to `transcriptCursor` (reused by W07).
- [ ] **7. `room/page.tsx`** — compose it over `useInterviewState` + `useInterviewEvents`; guard
  auth; route error codes; flat `--bg`/`--shadow-hairline`, no mascot; mobile stack.
- [ ] **8. `room.*` copy + tests** (render-from-refetch, single text submit, silent `409`, reducer,
  active-tile `--live`). Run the `## Verification` command.

## Definition of done
- The room renders the two tiles, the live question and the transcript purely from
  `GET /interviews/:id/state`; an SSE event only triggers the refetch and the UI re-renders from it
  (proven in the test — the event body is never read).
- A text answer posts `{ questionId, transcript, inputMode: 'text' }` once; a `409
  QUESTION_NOT_CURRENT` silently refetches and re-renders without a toast; the client never advances
  its own index.
- The avatar reducer yields the §3.8 state for every lifecycle phase; only the active tile wears
  `--live`; no mascot/gradient appears; the type animation is 40 char/sec and instant under reduced
  motion.
- The room is usable at ≤ 375 px; copy resolves EN + TR.

## Verification
```bash
npm run -w frontend test -- "src/app/interviews/[id]/room" src/lib/room-avatar.test.ts
```
Expected: the room + reducer suites pass — render-from-refetch (not from the SSE body), single
text-mode submit, silent `409` refetch, the §3.8 avatar states, and active-tile-only `--live`.

## Notes

(Empty until the task is done.)
