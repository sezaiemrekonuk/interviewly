# W09 — Pre-join device check (screen 10): the voice-mode gate before the room
REPO: (this repo) · Depends: W06, V02 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — a device-permission gate screen. The hard part (the realtime voice
session) is V02/W10; this is the mic-check surface in front of it. Cut first if the deadline squeezes
(planning prompt §3, phase 5).

## Goal
Owner's ask (frontend spec screen 10):

> "Pre-join — the device check before a voice interview. Grant the microphone, see the input level,
> confirm the device, then enter the room. A denied or missing mic blocks entry with a clear
> recovery."
> — frontend spec §Behaviour screen 10; PLAN_FRONTEND_LEDGER.md §3 phase 5

Build the pre-join route `/interviews/:id/pre-join` — the microphone-permission gate that a
voice-mode interview passes through before `/interviews/:id/room` (W10).

## Security boundaries
- **Auth-gated + owner-scoped** — as the room; a non-owner is routed by W02's table, existence not
  leaked.
- **Microphone permission is the browser's boundary** — the client requests `getUserMedia({ audio })`
  and reflects the grant/deny; it stores no stream beyond the level meter and releases the track on
  leave. No audio is uploaded from this screen (the realtime session is W10/V02).
- **Voice readiness is gated on V02.** Pre-join only *enters* the voice room; it does not itself open
  the realtime session. If the interview `mode` is not `voice`, pre-join redirects to the text room
  (W06) — it never gates a text interview.

## Non-negotiables
- **`mode` decides the gate.** Read `GET /interviews/:id/state` (W02 `useInterviewState`); `mode:
  'voice'` shows pre-join, `mode: 'text'` redirects to `/interviews/:id/room`. Do not show a mic
  check for a text interview.
- **Permission states are all handled:** prompt (ask), granted (show the live input level + an
  Enter CTA), denied (a clear recovery: how to re-enable, a retry), unavailable (no device → a
  blocking message, no Enter). Entry to the room is disabled until granted.
- **Pre-join IS an entry surface** — gradient ground + `--shadow-soft` (W01 constants); it is in
  `ENTRY_ROUTES`. The Enter CTA is the single `--primary`.
- **States (verbatim):** loading = the state/permission skeleton; error = W02-routed for the
  interview fetch, inline recovery for a permission denial; empty = n/a (a pre-join always has an
  interview id).
- **Release the mic on leave** — navigating away or unmounting stops the track; no hot-mic leak.
- **Both locales** carry `preJoin.*` including the permission-recovery copy.

## Context (anchors)
- `frontend/src/app/interviews/[id]/pre-join/page.tsx` — **create.** The gate: `useInterviewState(id)`
  → branch on `mode`; request `getUserMedia`, drive the permission state machine, show the level
  meter, enable the `--primary` Enter CTA only when granted → navigate to `/interviews/:id/room`.
- `frontend/src/components/pre-join/mic-check.tsx` — **create.** The permission request + a live
  input-level meter (Web Audio `AnalyserNode`); emits the permission state up.
- `frontend/src/lib/use-mic-permission.ts` — **create.** A hook wrapping `getUserMedia` +
  permission-state transitions + track cleanup; unit-testable with a mocked `navigator.mediaDevices`.
- `frontend/src/lib/query.ts` (:W02) — reuse `useInterviewState`.
- `frontend/messages/{en,tr}.json` — **modify.** `preJoin.*` in both files.
- `frontend/src/app/interviews/[id]/pre-join/page.test.tsx` + `src/lib/use-mic-permission.test.ts`
  — **create.** Mock `navigator.mediaDevices.getUserMedia`. Assert: a granted mic enables Enter and
  navigates to the room; a denied mic blocks Enter and shows recovery; a `text` interview redirects
  to the room without a mic prompt; leaving stops the track.
- REFERENCE §backend-surface (`GET /interviews/:id/state`), W06's room route, the W01 entry
  constants — reuse.

  **The trap:** two. (1) Don't gate a text interview — read `mode` first and redirect text to the
  room. (2) Don't leak the mic — stop the `MediaStreamTrack`s on unmount/navigate, or the tab keeps
  a hot mic after the user leaves.

## Steps
- [ ] **1. `use-mic-permission.ts`** — `getUserMedia` wrapper, permission-state transitions, track
  cleanup + its unit test.
- [ ] **2. `mic-check.tsx`** — permission request + live level meter.
- [ ] **3. `pre-join/page.tsx`** — `mode` branch (text→room), the permission gate, `--primary` Enter
  → room; entry ground.
- [ ] **4. `preJoin.*` copy** (incl. recovery) in both files.
- [ ] **5. Tests** — granted→enter, denied→blocked+recovery, text→redirect, leave→track stopped.
- [ ] **6. Run the `## Verification` command.**

## Definition of done
- `/interviews/:id/pre-join` shows the mic check only for a `voice` interview and redirects a `text`
  interview to `/interviews/:id/room`.
- The permission state machine handles prompt/granted/denied/unavailable; Enter (`--primary`) is
  enabled only when granted and navigates to the room; a denial shows a clear recovery.
- Leaving the screen stops the media track (no hot-mic leak); pre-join uses the entry gradient;
  copy resolves EN + TR.

## Verification
```bash
npm run -w frontend test -- "src/app/interviews/[id]/pre-join/page.test.tsx" src/lib/use-mic-permission.test.ts
```
Expected: the pre-join + mic-permission suites pass — granted enables entry, denied blocks with
recovery, a text interview redirects without a prompt, and the track is released on leave.

## Notes

(Empty until the task is done.)
