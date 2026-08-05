# W09 — Pre-join device check (screen 10): the voice-mode gate before the room
REPO: (this repo) · Depends: W06, V02 · Status: done
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
- [x] **1. `use-mic-permission.ts`** — `getUserMedia` wrapper, permission-state transitions, track
  cleanup + its unit test.
- [x] **2. `mic-check.tsx`** — permission request + live level meter.
- [x] **3. `pre-join/page.tsx`** — `mode` branch (text→room), the permission gate, `--primary` Enter
  → room; entry ground.
- [x] **4. `preJoin.*` copy** (incl. recovery) in both files.
- [x] **5. Tests** — granted→enter, denied→blocked+recovery, text→redirect, leave→track stopped.
- [x] **6. Run the `## Verification` command.**

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

**What exists now**
- `src/lib/use-mic-permission.ts` — `useMicPermission()` → `{ state, level, devices, deviceId,
  request(deviceId?), select(deviceId) }`. States `idle|prompt|granted|denied|unavailable`.
  `level` is 0..1 RMS off an `AnalyserNode` (`fftSize 256`), rAF-driven, clamped at 1; the meter is
  skipped entirely when `AudioContext` is undefined (jsdom), so the hook is testable without one.
- `src/components/pre-join/mic-check.tsx` (+ `.module.css`) — auto-requests on `idle`, emits every
  state up, renders the meter (`--accent` fill, `--surface-sunken` track, `transition: none`) with
  the `aria-hidden` bar and a 14px `--text-muted` sibling line as the truth. Device `<select>`
  renders only when `devices.length > 1` (labels are empty before a grant, so enumeration happens
  after `getUserMedia`, not on mount).
- `src/app/interviews/[id]/pre-join/page.tsx` (+ `pre-join.module.css`) — entry ground, 480px panel,
  skeleton while `isPending`, `routeForError` on the state fetch, CTA `--primary` full-width.
- `preJoin.*` in `messages/{en,tr}.json`: `title/subtitle/deviceLabel/deviceFallback/prompt/hearYou/
  quiet/enter/enterHint`, `denied.{title,step1..3,retry}`, `unavailable.{title,body}`.

**Deviations / decisions**
- `NotFoundError`/`DevicesNotFoundError`/`OverconstrainedError` → `unavailable`; every other
  rejection → `denied`. Collapsing them would offer a retry that cannot succeed.
- `unavailable` removes the Enter CTA (DESIGN §5); `denied` keeps it visible and disabled with the
  13px "why" line, so the layout does not shift under the user.
- No camera anywhere — the task's security boundary is mic-only. The ledger row title's
  "camera off-by-default" is satisfied by never requesting video.
- Old sketch keys `preJoin.loading`/`preJoin.recovery.*` were replaced, not extended.

**Fixed en route (outside scope, but it blocked verification)**
`src/lib/query.ts` exported `useDeleteInterview` twice (both identical in behaviour; committed at
`483797b`). Rolldown fails the whole module on a duplicate export, so *every* test importing
`lib/query.ts` was red. The second copy is deleted.

**For W10** — reuse `useMicPermission` for the room's 4px mic meter; do not re-request permission
there, pre-join already holds the grant for the tab. The hook releases on unmount, so the room
mounts its own instance.

**Verification** — `npm run -w frontend test -- "src/app/interviews/[id]/pre-join/page.test.tsx"
src/lib/use-mic-permission.test.ts` → 2 files, 9 tests, pass. Full `npm run -w frontend test`:
28 files / 220 tests pass.

## Design

Read `frontend/DESIGN.md` before writing CSS — §3 (composition patterns), §5 W09 brief, §6 (quality floor).
Non-negotiables for this surface: **entry mode** — gradient ground (`ENTRY_ROUTES`), one centred
`--surface` panel at `--radius-panel` + `--shadow-soft`, max-width 480px, padding 32/24.
The **level meter fill is `--accent`** on a `--surface-sunken` track with `transition: none` — never
`--live` (room-only), never `--primary` (reserved for the single Enter CTA). The meter is
`aria-hidden`; a 14px `--text-muted` sibling line carries the "we can hear you" truth (never
colour-or-motion-only). Denied/unavailable renders as a designed inline block (`--surface-sunken`
bed, 1px `--danger`, problem + numbered recovery), not a raw error string. Mascot: none by default;
`shrug` only inside the denied/unavailable block. One authored motion moment: the CTA enabling.
