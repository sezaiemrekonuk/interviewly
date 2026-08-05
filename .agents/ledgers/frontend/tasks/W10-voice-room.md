# W10 — Voice room surface (screen 11-voice): the voice-mode room over the realtime session
REPO: (this repo) · Depends: W09, V02, V05 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — the voice variant of the room, sitting on the realtime voice session
(V02/V05) plus the same K11 render-from-state invariant as W06. Coordinating the live audio session
lifecycle with the server-authoritative room state without letting the audio become a second source
of truth is real judgement, not composition.

## Goal
Owner's ask (frontend spec screen 11, voice mode):

> "The voice room — the same two-tile room, but the candidate speaks and the interviewer's questions
> are spoken. The live audio session drives the speaking/listening beats; the room still advances
> only when the server says so, and the transcript still fills from the server."
> — frontend spec §Behaviour screen 11 (voice); PLAN_FRONTEND_LEDGER.md §3 phase 5

Build the voice-mode surface of `/interviews/:id/room` over the realtime voice session (V02/V05),
reusing W06's room shell, tiles, transcript and avatar reducer. This is the internship demo's
end-state (voice), but text (W06) is built and demoed first.

## Security boundaries
- **The room still renders from `GET /interviews/:id/state`, never from the audio session or an SSE
  payload** (K11, ADR-W02). The realtime session drives the *local* avatar speaking/listening beats;
  the current question, index, transcript cursor and advance all come from the refetched state.
- **Advance is server-authoritative** (K2) — as W06. The voice session never advances the index; a
  `QUESTION_NOT_CURRENT` silently refetches.
- **The realtime credential/token comes from V02/V05, scoped to this interview** — the client
  requests it through the owned endpoint and never embeds a long-lived key. The mic track is
  released when the room unmounts (no hot-mic leak carried from pre-join).
- **Owner-scoped** — a non-owner is routed by W02's table.

## Non-negotiables
- **Voice depends on V02/V05 existing.** The realtime session (token issue, transport, the
  server-side voice turn) is V02/V05's contract. `Depends on V09` is the wrong letter — this task
  depends on **V02** (session) and **V05** (reconciliation). If those endpoints do not resolve when
  execution starts, **stop and flag them**, do not build against a phantom realtime API.
- **Reuse W06, do not fork it.** The two tiles (`persona-tiles.tsx`), the transcript
  (`transcript.tsx`), the avatar (`avatar.tsx`) and the §3.8 reducer (`room-avatar.ts`) are shared;
  voice adds the audio session lifecycle and the mic/speaker controls, not a second room.
- **The avatar beats are driven by the audio session in voice mode** — speaking while the
  interviewer's audio plays, `listening` while capturing the candidate, `acknowledging` on a turn
  boundary — but `persona.avatarState` from each refetch remains the sync value (§3.8). The audio is
  a *local* driver between refetches, not a truth source.
- **The room is NOT an entry surface** — flat `--bg`, `--shadow-hairline`, no gradient, no mascot;
  only the active tile wears `--live` (as W06).
- **States (verbatim):** loading = the room skeleton + the session-connecting beat; error =
  W02-routed for the interview, plus a session-lost recovery (reconnect) distinct from an interview
  error; empty = `currentQuestion: null` shows the waiting beat.
- **Reconnect** — a dropped realtime session shows a reconnect affordance and, on reconnect,
  re-syncs from a state refetch (V05 reconciliation covers the server side).
- **Mobile** and **both locales** (`room.*` voice keys) as W06.

## Non-negotiables — do NOT
- Do not read the SSE body or let the audio session advance the index or fill the transcript. Do not
  duplicate the tiles/transcript/avatar/reducer — import W06's. Do not show a mascot or `--live` off
  the active tile.

## Context (anchors)
- `frontend/src/app/interviews/[id]/room/page.tsx` (:W06) — **modify.** Branch on `mode`: `text` →
  the W06 composer path; `voice` → the voice session surface. Keep the shared shell.
- `frontend/src/components/room/voice-controls.tsx` — **create.** Mic mute/level + speaker + the
  session status/reconnect affordance; drives the local avatar beats.
- `frontend/src/lib/use-voice-session.ts` — **create.** The realtime session lifecycle over V02's
  token/transport: connect, capture, play, turn-boundary events, reconnect, teardown (release the
  mic). Emits the local avatar phase; never mutates room state. Unit-testable with a mocked transport.
- `frontend/src/components/room/{persona-tiles,transcript,avatar}.tsx`, `src/lib/room-avatar.ts`
  (:W06) — **reuse** unchanged.
- `frontend/src/lib/query.ts` / `use-interview-events.ts` (:W02) — reuse the state key + SSE nudge.
- `frontend/messages/{en,tr}.json` — **modify.** The `room.*` voice keys in both files.
- `frontend/src/app/interviews/[id]/room/voice.test.tsx` + `src/lib/use-voice-session.test.ts` —
  **create.** Mock the V02 transport + W02's `event-source-mock`. Assert: the voice surface renders
  from the refetched state (not the audio session or the SSE body); a turn boundary drives the local
  avatar beat but the index advances only on a state refetch; a dropped session shows reconnect and
  re-syncs on reconnect; the mic track is released on unmount.
- REFERENCE §room-state shape, §avatar state machine, §error table; the V02/V05 REFERENCE for the
  session contract — the authorities.

  **The trap:** the whole point of voice mode is a live audio session, and the tempting shortcut is
  to treat that session as the source of truth (advance when the audio turn ends, fill the transcript
  from local ASR). That is the K11 violation again, one layer deeper: the audio drives *beats*, the
  server drives *truth*. Advance and transcript always come from the state refetch.

## Steps
- [ ] **1. Confirm V02/V05 session endpoints resolve.** If not, stop and flag them in STATE.
- [ ] **2. `use-voice-session.ts`** — connect/capture/play/turn-boundary/reconnect/teardown over
  V02's transport; emits the local avatar phase; unit test with a mocked transport.
- [ ] **3. `voice-controls.tsx`** — mic/speaker/session-status/reconnect.
- [ ] **4. Branch `room/page.tsx` on `mode`** — voice surface reusing W06's tiles/transcript/avatar/
  reducer; local beats from the session, truth from the state refetch.
- [ ] **5. `room.*` voice copy** in both files.
- [ ] **6. Tests** — render-from-refetch, turn-boundary beat vs. server advance, reconnect re-sync,
  mic released on unmount. Run the `## Verification` command.

## Definition of done
- Voice mode renders the same two-tile room from `GET /interviews/:id/state`; the realtime session
  drives only the local speaking/listening beats, and the index/transcript/advance come from the
  state refetch (proven in the test — not from the audio or the SSE body).
- W06's tiles, transcript, avatar and §3.8 reducer are reused unchanged (no fork).
- A dropped session shows a reconnect affordance and re-syncs from a refetch; the mic is released on
  unmount; flat `--bg`, active-tile-only `--live`, no mascot; copy resolves EN + TR.

## Verification
```bash
npm run -w frontend test -- "src/app/interviews/[id]/room/voice.test.tsx" src/lib/use-voice-session.test.ts
```
Expected: the voice-room + session suites pass — render-from-refetch, local beats decoupled from the
server advance, reconnect re-sync, and mic release on unmount.

## Notes

(Empty until the task is done.)

## Design

Read `frontend/DESIGN.md` before writing CSS — §3 (composition patterns), §5 W10 brief, §6 (quality floor).
Non-negotiables for this surface: **room mode** — flat `--bg`, `--shadow-hairline` only, no gradient,
no mascot, near-zero motion. Reuse `room.module.css`; add controls, not a second stylesheet.
`--live` on exactly one tile or none, always paired with the lit name/role label. Voice controls are
a sticky bottom bar mirroring `.composer`: ≥44px icon buttons, mic level as an `--accent` fill on a
`--surface-sunken` track, session status as a **text** chip (never a coloured dot alone). Session-lost
banner carries the surface's single `--primary` (the Reconnect button). Transcript pane is
`aria-live="polite"` and scrolls in its own container. One authored motion moment: the `--live`
ring crossfading between tiles — static under `prefers-reduced-motion`.
