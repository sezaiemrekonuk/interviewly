# W06 — Interview room, TEXT mode (screen 11): two-tile room, client avatar state machine, guarded answer submit
REPO: (this repo) · Depends: W02, I03, I06, I07 · Status: done
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
- [x] **1. `room-avatar.ts`** — the pure §3.8 lifecycle→`AvatarState` reducer + its unit test.
- [x] **2. `avatar.tsx`** — `<Avatar personaId state>` with the `idle` fallback + set preload.
- [x] **3. `persona-tiles.tsx`** — two tiles, active-only `--live`, inactive resolved from rounds.
- [x] **4. `question-panel.tsx`** — 40-char/sec type animation, reduced-motion instant.
- [x] **5. `answer-composer.tsx` + `answers`/`resume` mutations** — `{ inputMode: 'text' }`, no
  retry, `409` → silent refetch.
- [x] **6. `transcript.tsx`** — answered turns to `transcriptCursor` (reused by W07).
- [x] **7. `room/page.tsx`** — compose it over `useInterviewState` + `useInterviewEvents`; guard
  auth; route error codes; flat `--bg`/`--shadow-hairline`, no mascot; mobile stack.
- [x] **8. `room.*` copy + tests** (render-from-refetch, single text submit, silent `409`, reducer,
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

**Room-state was extended to build this — ADR-W06.** The shipped payload could not feed the
screen: no `persona.id` (so no avatar key), no round list (so no second tile), `transcriptCursor`
is a count with no rows. `backend/modules/interview/state.ts` now also returns:

- `persona.id` — the active speaker's persona id.
- `personas: [{ id, role, name, roundType, avatarSet }]` — both rounds, hr then tech. The two
  tiles. `avatarSet` is `personas.avatar_set`, i.e. the real content-addressed keys.
- `transcript: [{ questionId, question, answer, roundType }]` — answered turns in global order
  (`orderTranscript`, pure + unit-tested in `state.test.ts`).

Additive only; `transcriptCursor` and every other field are untouched, so I03/I06 acceptance
steps still hold. Verified with `npm test` (root, 275 pass).

**What exists now**

| File | Notes |
|---|---|
| `lib/room-avatar.ts` | `roomPhase()` derives the phase from (state, question, typedFor, submitting) — no effects, no local queue. `resolveAvatarState()` lets the phase win except in `settled`, where the server's sync value applies (unknown value → `idle`). |
| `components/avatar.tsx` | `<Avatar personaId state avatarSet>` + `avatarUrl()` + `<AvatarPreload sets>`. Prefix is `NEXT_PUBLIC_ASSETS_PREFIX` (default `/assets`), same contract as `mascot.tsx` — kept local so the room never imports a mascot module. |
| `components/room/*` | tiles / question-panel / answer-composer / transcript + one shared `room.module.css`. Composer is presentational: the page owns the mutation so one `isPending` drives the avatar's `acknowledging` beat. |
| `room/page.tsx` | auth gate → skeleton → state query + SSE nudge. Navigation lives in effects (routing during render fires twice). `evaluating/completed/failed/abandoned` → `replace('/interviews/:id')` (W07's surface). |
| `lib/error-routing.ts` | `SILENT_REFETCH_CODES` exported and reused by `useSubmitAnswer` — one home for §4.5's refetch set. |

**Deviations / traps for the next session**

- `--live` is an `outline`, not a second `box-shadow`: `ui-checks/tokens.test.ts` caps the room at
  `--shadow-hairline` and rejects raw box-shadow values. Same file rejects non-multiple-of-4 px.
- The question is fully in the DOM from frame 1 (`.srOnly` span + `aria-live`); only the visible
  span types. A screen reader must not wait 6 s for the question.
- `QuestionPanel.onTyped` reports the **question id**, not a boolean — a boolean makes the next
  question inherit "already typed" and skip its animation.
- Reduced motion is read via `window.matchMedia` (jsdom returns false by default), and the
  reduced case is the panel's **initial state** — `<QuestionPanel key={question.id}>` gives one
  instance per question, so no effect ever calls `setShown` synchronously.
- **`npm run lint` is weaker than the pre-commit hook.** Husky runs
  `eslint --config frontend/eslint.config.mjs` over staged `frontend/**`, which has
  `react-hooks/refs` and `react-hooks/set-state-in-effect` (both rejected a first draft of
  `question-panel.tsx`). Run that config on changed files before committing, not just `npm run lint`.
- `state.ts` ships the whole transcript on every refetch — `ponytail:` comment names the paging
  upgrade if turn counts ever grow.

**For W07/W09/W10:** reuse `<Transcript>` (already read-only) and room-state's `transcript[]`
rather than waiting on `GET /interviews/:id`. W10 replaces the composer only — tiles, phase
machine and preload are mode-agnostic; add `voice` to `SubmitAnswerBody['inputMode']` there.

**Verification:** `npm run -w frontend test -- "src/app/interviews/[id]/room" src/lib/room-avatar.test.ts`
→ 2 files, 15 tests pass. Root gates: `lint` clean, `typecheck` clean, `npm test` 275 pass.
`npm run test:acceptance` **could not run from the host**: `.env`'s `REDIS_URL` names the
compose-internal host `cache` (`getaddrinfo ENOTFOUND cache`), so the suite stalls on ioredis
retries. Running it inside the `api` container would truncate the dev database — left for CI /
a human. The backend change is additive and covered by `state.test.ts`.
