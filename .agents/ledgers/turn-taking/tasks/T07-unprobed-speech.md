# T07 — Speech spoken before the first probe still dies with the page
REPO: (this repo) · Depends: T06 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — it adds a second, unattended upload path on the trust boundary
ADR-T02 exists to guard, at the one moment the page is being torn down and nothing can be
verified afterwards.

## Goal
Owner, twice, on two separate live runs:

> "when I refreshed the page while talking it didnt save what i said"

`T06` fixed the case where a pause had happened: a probe reaches the server, the fragment is
held, and the reload shows the recovery notice. What is still lost is speech the candidate is
*in the middle of* — nothing has been uploaded, so there is nothing to recover, and the browser's
audio dies with the document.

## Non-negotiables
- **The voice route still accepts `audio` and `force` and nothing else** (ADR-T02). A flush is an
  ordinary probe: unforced, gated, joined like any other.
- **Best-effort, never load-bearing.** `sendBeacon` returns false when the payload is too large
  and the page is going away regardless. A failed flush must cost nothing and be invisible.
- **No held-partial text on the client** (K6, ADR-T05). The client sends audio; the text stays
  server-side.
- **The recorder's timeslice must not change what a normal turn uploads.** `start(1000)` only
  makes the same bytes arrive in chunks; the blob assembled in `onstop` is unchanged.

## Context (anchors)
- `frontend/src/lib/use-voice-session.ts` — `startRecording`'s `recorder.start()` (no timeslice
  today, so `chunksRef` stays empty until `stop()`), `chunksRef`, the unmount effect.
- `frontend/src/lib/query.ts` `useSubmitAudioTurn` — the multipart shape to mirror, part name
  `audio`, bare media type.
- `backend/modules/speech/stt.ts` `turnFields` — refuses any field but `force`; a beacon that
  adds one gets a `VALIDATION_ERROR`.

## Steps
- [ ] **1. Test red** — with a stubbed `navigator.sendBeacon`: a `pagehide` while listening posts
  the chunks gathered so far to `/turns/audio` with no `force`; a `pagehide` while idle posts
  nothing; the beacon is not sent twice.
- [ ] **2. `recorder.start(1000)`** so `chunksRef` fills continuously instead of only at `stop()`.
- [ ] **3. Flush on `pagehide`** (not `beforeunload` — it does not fire on mobile Safari, and a
  backgrounded tab is the same loss). Assemble the chunks, `navigator.sendBeacon(url, form)`.
- [ ] **4. Cap it.** Beacons are capped around 64 KB; opus at ~8 KB/s means roughly the last 8 s
  is all that will land. Send the **tail** — the words nearest the interruption are the ones the
  candidate was in the middle of — and skip the flush entirely rather than send a truncated head.
- [ ] **5. Say what it cannot do.** If the flush is skipped or refused, nothing is shown and
  nothing is claimed. The recovery notice already renders only what the server actually holds.

## Definition of done
- Speaking continuously and refreshing mid-sentence leaves a held partial, and the reloaded room
  shows the recovery notice with the tail of it.
- A normal turn's upload is byte-identical to today's.
- `npm run -w frontend lint` passes.

## Verification
```bash
npm run -w frontend test -- use-voice-session
npm run lint && npm run typecheck && npm test
```
Then in the real room: speak continuously for ~10 s with no pause, refresh mid-word, and check
the API log for a `SPEECH_STT_TRANSCRIBED` at the moment of the refresh, then the notice on the
reloaded page.

## Notes
_(fill in when done — and record what fraction of a 10 s answer actually survives the 64 KB cap,
because that number decides whether this is a fix or a consolation)_
