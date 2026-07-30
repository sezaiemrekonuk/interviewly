# V05 — Pre-join device check (before the mint) + active-speaker signal for the two persona tiles
REPO: (this repo) · Depends: V01, V03 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — browser media plumbing plus one ordering rule. The ordering rule
(check devices before minting) is the part that matters; the rest is `getUserMedia` and an
`AnalyserNode`.

## Goal
Owner's ask:

> "A pre-join screen with camera preview and mic level before the room opens, camera off by
> default, a note that nothing is recorded — and in the room, make it unmistakable which agent is
> speaking."
> — IDEA.md §3.2, §4.3 screens 10–11, voice spec *Voice room surface*

Ships the device-check module behind `/interviews/:id/pre-join` (permission state, mic level,
camera preview), the routing rule that a voice interview passes through it **before** any session
is minted, and the active-speaker signal the room's two persona tiles render.

## Non-negotiables
- **Pre-join precedes the mint.** No `POST /interviews/:id/voice/session` is issued until the user
  presses **Join** on a passed device check. A denied microphone must downgrade to text with **no
  `voice_sessions` row ever created** — otherwise every denial burns a minted ceiling and pollutes
  the session table with rows nothing will consume.
- **A denial reuses V03's downgrade path.** One path from "voice cannot work" to "the same interview
  continues in text", not two. Same `interviewId`, same question index, `mode = 'text'`.
- **The preview stream never leaves the browser.** `getUserMedia` binds only to a local `<video>`:
  no `RTCPeerConnection`, no `MediaRecorder`, no upload, no canvas capture (§3.2). Stop every track
  on unmount — a camera light left on after leaving the screen is the kind of bug users never
  forgive.
- **Camera is off by default.** The user turns it on; the default is never inferred from a previous
  session.
- **Exactly one active speaker.** The signal drives the ring on the tile matching the *round*
  (`hr_round` → HR, `tech_round` → tech) and nothing else. There is no state where two tiles are
  active — one live question means one live speaker (K2).
- **Active speaker is never colour-only** (`ui` §4.4): the ring is paired with the lit name/role
  label, and the round handover fires one `aria-live` announcement.
- **No `REC` indicator, no consent dialog, no recording artifact** — in any mode (§3.2).

## Context (anchors)
- `frontend/app/interviews/[id]/pre-join/page.tsx` (:frontend) — the screen. **`frontend` owns the
  composition**; this task supplies the hook it calls.
- `frontend/src/lib/voice/device-check.ts` — **create.** `checkDevices()` → `{ micPermission,
  camPermission, micLevel$, previewStream }`, plus a `release()` that stops all tracks.
- `frontend/src/lib/voice/active-speaker.ts` — **create.** Amplitude source when the SDK exposes an
  `AudioNode`/`MediaStream` for agent output (§15.1 item 3), event-timer interpolation otherwise —
  the same fork the avatar drivers already have (§3.6), so reuse that decision rather than
  re-litigating it here.
- `frontend/src/lib/voice/session.ts` (:V01) — the mint call. **Move its invocation behind Join**;
  do not call it on route mount.
- `frontend/src/lib/voice/downgrade.ts` (:V03) — reuse for the denial path.

## Steps
- [ ] **1. `device-check.ts`** — permission query, mic level via `AnalyserNode` RMS, camera preview
  bound to a local element, `release()` stopping every track.
- [ ] **2. Gate the mint behind Join**, and make a permission denial call V03's downgrade.
- [ ] **3. Text-mode guard** — a text interview visiting `/pre-join` redirects to the room.
- [ ] **4. `active-speaker.ts`** with the amplitude/event fork and a single-active invariant
  derived from room-state's `state`, not from audio alone (audio decides *how loud*, the state
  machine decides *who*).
- [ ] **5. Unmount hygiene** — tracks stopped, `AnalyserNode` disconnected, `AudioContext` closed.
- [ ] **6. One runnable check** — a small test asserting that (a) a rejected `getUserMedia` produces
  the downgrade with **zero** mint calls, and (b) `active-speaker` reports the HR tile in
  `hr_round` and the tech tile in `tech_round` and never both.

## Definition of done
- Voice-mode interviews route through pre-join; a denial ends in text mode with no
  `voice_sessions` row (voice AC-11).
- The active tile follows the round; no state produces two active speakers (voice AC-12).
- No `REC` element and no recording code path exists (voice AC-13).
- Leaving the pre-join screen leaves no live media track.

## Verification
```bash
npm run -w frontend test -- voice/device-check voice/active-speaker
psql "$DATABASE_URL" -c "SELECT count(*) FROM voice_sessions;"   # before/after a denied join
```
Expected: tests pass; the `voice_sessions` count is unchanged across a denied join.

## Notes

(Empty until the task is done. Fill with: what actually happened, whether the ElevenLabs SDK
exposed an audio surface (resolving IDEA.md §15.1 item 3 — record the answer, it decides whether
`AmplitudeAvatarDriver` exists), and anything deliberately left out.)
