# T07 — Speech spoken before the first probe still dies with the page
REPO: (this repo) · Depends: T06 · Status: done
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
- [x] **1. Test red** — with a stubbed `navigator.sendBeacon`: a `pagehide` while listening posts
  the chunks gathered so far to `/turns/audio` with no `force`; a `pagehide` while idle posts
  nothing; the beacon is not sent twice.
- [x] **2. `recorder.start(1000)`** so `chunksRef` fills continuously instead of only at `stop()`.
- [x] **3. Flush on `pagehide`** (not `beforeunload` — it does not fire on mobile Safari, and a
  backgrounded tab is the same loss). Assemble the chunks, `navigator.sendBeacon(url, form)`.
- [x] **4. Cap it.** Beacons are capped around 64 KB; opus at ~8 KB/s means roughly the last 8 s
  is all that will land. Send the **tail** — the words nearest the interruption are the ones the
  candidate was in the middle of — and skip the flush entirely rather than send a truncated head.
  **Amended in flight: the header chunk rides along with the tail.** See Notes.
- [x] **5. Say what it cannot do.** If the flush is skipped or refused, nothing is shown and
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
reloaded page. **Write down that line's audio duration** — it is the answer to the question the
Notes could not measure, and the ledger has no other way to get it.

## Verification output

`npm run -w frontend test -- use-voice-session voice.test` → 58 passed. Root `npm test` → 1261
passed (120 files). `npm run lint`, `npm run -w frontend lint`, `npm run typecheck` clean. No
backend file changed, so the acceptance ring was not re-run.

**Live: confirmed by the owner, 2026-08-12 ~12:05.** Refresh mid-sentence, one reload, the notice
is there. The 11:42 run had already proved the audio half; this is the marker and the grace window
in front of a real unload.

**The cap number is still open, and there is now a reason to think it may never bite.** Every
beacon and probe observed across both runs carried 2.0–3.6 s of audio — nowhere near the 60 000
byte budget. The cap only matters for an answer spoken continuously for long enough to fill it,
and nobody has yet refreshed in the middle of one. Until someone does, the honest statement is
that the tail rule is untested rather than that it costs nothing.

## Notes

**Shipped:** `CHUNK_MS = 1_000` on `recorder.start()`, `BEACON_MAX_BYTES = 60_000`, `flushedRef`,
and a `pagehide` effect that lives only while `phase === 'listening'`. Eight tests, in their own
`(T07)` describe. Mutation-checked twice: dropping `chunksRef.current = [head]` reds the
double-upload test and nothing else; dropping the head from the beaconed `File` reds the two that
assert what a decoder gets.

**Step 4 was wrong about the tail, and the fix is one chunk wide.** A pure tail is not a file. A
`MediaRecorder` puts the EBML header, the Segment and the Tracks — the codec's init data — in
**chunk 0** and nothing but clusters in the rest, so a beacon carrying only the last few clusters
is bytes no decoder will open, and Scribe would have answered `SPEECH_AUDIO_INVALID` at the one
moment nothing can be retried. What ships is **chunk 0 + as many trailing chunks as fit**, which
is still "the words nearest the interruption" and is still a real WebM: the clusters that were
skipped leave a timeline gap, which `libavformat` reads as a discontinuity rather than an error.
The cost is the middle of a long answer, and the middle is the oldest speech — which is the part
the cap was always going to take.

**What survives a 10 s answer: unmeasured here, and it is arithmetic until a live run.** The
budget is 60 000 bytes minus chunk 0, and how many seconds that buys depends on a bitrate this
repo does not set — `MediaRecorder`'s default. At the task's assumed 8 KB/s it is ~6.5 s of the
last 10; at Chrome's leaner opus default (~6 KB/s) the whole answer fits with room to spare; at a
128 kbps encoder (16 KB/s) it is ~2.7 s. **jsdom cannot answer this** — T08's tech-debt line
again — so the number belongs to the live pass below, and until someone runs it this is a fix of
unknown size rather than a measured one. Setting `audioBitsPerSecond` would make it deterministic
and was deliberately not done: it changes the bytes every normal turn uploads and the audio Scribe
is scored on, which this task's own non-negotiable forbids.

**The page that comes back.** `pagehide` is not always the end — a backgrounded tab can be
restored — so the beaconed bytes must not also travel in the recorder's own upload and be joined
onto the same turn twice. The flush therefore leaves `chunksRef` holding **chunk 0 alone**: the
header stays so whatever `onstop` assembles later is still openable, and everything already sent
is gone. `flushedRef` is the second half of it, one flush per open recorder.

**Nothing is claimed on failure.** `sendBeacon` returning false, a recording with only a header in
it, and a `pagehide` with no recorder open all do exactly nothing — no state, no error, no notice.
The recovery notice still renders `GET /state`, which is the server's own answer about what it
holds.

## The live run, 2026-08-12 11:42 — the flush worked and the room hid it

**Measured.** Beacon at the refresh, `SPEECH_STT_TRANSCRIBED` 2.359 s of audio at 11:42:48,
`CONDUCTOR_TURN_HELD` at 11:42:49 taking the fragment from 96 to 120 chars, `probes: 3`. The tail
it carried was `Oh my God. You slipped?` — the words the candidate was in the middle of. The Redis
key still held them minutes later, against the right `questionId` and the interview's own
`current_index`. **The audio path did exactly what it was built to do.**

The candidate saw nothing, and reported it as "it didn't save" — twice, which is how many refreshes
it took. The room's notice latches on the FIRST `GET /state` and freezes (ADR-T05, and the
freezing is deliberate). That read landed at ~11:42:47, about two seconds before the gate wrote.
It latched an honest `null` and no later value could revive it.

So a beacon is not enough on its own: the flush's round trip outlives the page that sent it, and
the page that replaces it asks too early **by construction**, every time. Shipped with it:

- `lib/voice/unload-flush.ts` — `markFlushed` / `takeFlushed` over `sessionStorage` (same tab,
  survives the reload, dies with the tab), plus `FLUSH_GRACE_MS = 6_000` and
  `FLUSH_POLL_MS = 1_000`. The marker says only *that* a flush left, never what was said (K6).
- The room re-reads `/state` on that interval while a marker was found, and latches the moment a
  fragment appears. Six seconds is the measured ~2 s round trip with room for a long answer's
  transcription; past it the room latches null and stops asking.
- Five more tests (three in `voice.test.tsx`, two in the hook's). Mutation-checked: dropping the
  wait guard reds the flight test, dropping `markFlushed` reds the marker test.

**The lint rule was right and changed the design.** The first version derived the wait from
`resumed`, which the same effect writes — `react-hooks/set-state-in-effect` called it a cascade,
and it was one. The wait is now a ref written only from effects and timers, so the latch effect
keeps the single `[room]` dependency it had before this task touched it.
