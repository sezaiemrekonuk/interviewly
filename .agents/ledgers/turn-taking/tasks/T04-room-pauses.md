# T04 — The room: a pause is not the end of a turn
REPO: (this repo) · Depends: T03, S06 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — the client state machine nobody wrote down, and the task most likely
to reintroduce the two failures S06 documented at length. It adds a third of its own: restarting
the recorder *before* the upload, which is what stops speech during the probe from being lost,
and which no test will miss if you forget it.

## Goal
Owner's ask:

> "right now when user doesnt talk for 3 seconds it automatically stops recording and starts next
> question but user might be thinking about the answer"

The recorder still stops on silence. The turn no longer ends there. And a candidate who reloads
mid-thought can see what survived.

## Non-negotiables
- **`VAD_SILENCE_MS` stays 2 000.** A frontend test asserts the exact value
  (`use-voice-session.test.tsx:359`). The gate is what now prevents premature cutoff, so a short
  window costs a round trip and a long one is latency on every finished answer.
- **Do not simplify the VAD back into a `setTimeout`.** `use-voice-session.ts:364-370` explains
  it: `mic.level` changes once per animation frame, and a timeout in an effect depending on it is
  torn down ~60×/s and can never elapse. The polled timestamp is deliberate.
- **Do not key the speak effect on `messages`.** `:146-163` explains it: react-query hands back a
  new array for the same rows on every refetch, and the effect must react to *which assistant
  lines exist, by id*. Keying on the array leaves the room permanently mute.
- **Restart the recorder before the upload, on a probe stop.** Otherwise everything said during
  the round trip is lost — the exact failure this ledger exists to fix, moved a second later.
- **Manual Stop always ends the turn.** It is the escape hatch. `force: '1'`, gate never
  consulted.
- **The room asserts nothing (K11).** It sends "13 seconds have passed"; the server decides
  whether that is a flush or a real silence. No client-side advance, ever.
- **The recovery notice is frozen and lives outside the live region.** Read once on mount into a
  ref so later refetches cannot rewrite it, and render it as a sibling **after** the `<ol>` —
  that list is `aria-live="polite"` (`conversation.tsx:75`) and is the only way a screen-reader
  user meets the interviewer's words. (ADR-T05.)
- **Both locales, same meaning.** `en.json` and `tr.json` change together, informal register.

## Context (anchors)
- `frontend/src/lib/use-voice-session.ts:32-36` constants · `:88-96` phase/beat · `:192-243`
  `startRecording` · `:209-238` `onstop` · `:256-262` `stop` · `:371-385` the two VAD effects ·
  `:397-400` mic-lost · `:416-424` unmount.
- `frontend/src/lib/query.ts:718` `useSubmitTurn`, `:753` `useSubmitAudioTurn`.
- `frontend/src/components/room/conversation.tsx` — a labelled list, not bubbles; `:75` the live
  region; `:92-99` `speakerFor`.
- `frontend/src/components/room/voice-controls.tsx:143-147` the Stop button.
- `frontend/src/components/room/room.module.css:517-613` the conversation styles.
- `frontend/messages/en.json:482+` / `tr.json` — the `room` and `room.voice` blocks.
- `frontend/styles/tokens.css` — the only place a colour literal may exist. Informational bed is
  `--primary-soft` on `--primary`.
- The mock, for the notice's anatomy, states and copy: the T04 decision artifact (ADR-T05).

## Steps
- [x] **1. Test red** — with fake timers and a stubbed mutation: a `pendingTurn` response keeps
  `recording` true and re-opens the recorder; a null `pendingTurn` moves to idle; the 13 s clock
  fires the silence submit exactly once; a fully silent turn never uploads audio; manual Stop
  sends `force`. See them red.
- [x] **1b. Close #219 while you are in here.** `voice.test.tsx:234` and `:341` race a real
  1 000 ms `waitFor` against a request the loop has to issue — it fails on loaded CI runners and
  red-lights PRs that touch nothing near the room. Every timing assertion in that file is being
  rewritten by this task anyway. Drive the loop on fake timers, and give any remaining real-clock
  `waitFor` an explicit timeout rather than inheriting the default.
- [x] **2. Stop reasons** — `stop(reason: 'probe' | 'final')`. The VAD passes `'probe'`; the Stop
  button, the mic-lost effect and unmount pass `'final'`.
- [x] **3. `onstop`** — a `discardRef` short-circuit first; take the blob; on a probe stop call
  `startRecording()` immediately, before the upload; then upload with `force: '1'` on a final
  stop.
- [x] **4. The two responses** — `pendingTurn` non-null ⇒ stay listening. Null ⇒ the turn was
  conducted: abort the recorder started a moment ago via `discardRef` (the interviewer is about
  to speak; an open mic would record the TTS), then `setPhase('idle')` as today.
- [x] **5. Phase** — no new phase. A probe keeps `phase === 'listening'`, so the avatar keeps
  saying *listening* and the bars keep moving, which is the truth. Only a real submit reaches
  `uploading`/`acknowledging`.
- [x] **6. The 13 s clock** — one new interval effect beside the VAD pair, live while
  `phase === 'listening' && !mic.muted`. Anchor is `heardRef.current ? lastLoudRef.current :
  turnStartedRef.current`. At `FORCE_SUBMIT_MS = 13_000` submit `{ kind: 'silence',
  inputMode: 'voice' }`. Guard against firing twice, and against firing while an upload is in
  flight.
- [x] **7. Mutations** — `useSubmitTurn` grows `kind`; `useSubmitAudioTurn` grows the optional
  `force` field and returns `pendingTurn`.
- [x] **8. The recovery notice** — `conversation.tsx` takes an optional `pendingTurn` prop and
  renders `.resumed` after the `<ol>`: uppercase mono label, the quoted italic text, a hint line.
  Tail-truncate at ~180 characters with the front elided — what the candidate needs is the
  sentence they were in the middle of, not the start of a thought they finished minutes ago.
  Read `state.pendingTurn` once on mount into a ref in the room page; frozen thereafter; gone
  when the turn is conducted. Voice mode only.
- [x] **9. The pause line** — while the recorder is listening and something is held, the mic strip
  says so. Static, no live region.
- [x] **10. Copy** — three keys in both locales:
  `voice.resumed.label` "Picking up where you left off" / "Kaldığın yerden devam";
  `voice.resumed.hint` "Keep going — this part is already saved." / "Devam et — bu kısım
  kaydedildi."; `voice.stillListening` "Still listening — take your time." / "Hâlâ dinliyoruz —
  acele etme." "Saved", not "sent": the interviewer has not seen it, and saying "sent" would
  explain its silence as rudeness.

## Definition of done
- turn-taking AC-12 and AC-13 green.
- Issue #219 closed: `voice.test.tsx` no longer races the default 1 000 ms `waitFor` window.
- Speaking through a 4-second mid-sentence pause produces **one** user row, not two.
- A fully silent turn uploads no audio and still ends.
- The notice renders outside the `aria-live` list and never changes once shown.
- `npm run -w frontend lint` passes — the root lint does not cover this config.

## Verification
```bash
npm run -w frontend test -- use-voice-session room/conversation room/voice-controls
npm run -w frontend lint
npm run lint && npm run typecheck
```
Then, in the real room with `AI_ENABLED=true` and live keys:
- answer with a deliberate 4-second mid-sentence pause → interviewer stays silent, bars keep
  moving, one joined `chat_messages` user row;
- reload mid-pause → the notice shows the held half-sentence, and finishing the answer arrives
  joined and un-duplicated;
- say nothing for 15 s → the interviewer nudges or advances, a `system`/`silence` row exists, and
  the room does not show it;
- press Stop mid-sentence → submits immediately.

## Notes

**The client state machine, written down.** `stop(reason)` is the whole of it. `'probe'` (VAD)
re-opens the recorder inside `onstop` **before** the upload and leaves `phase === 'listening'`;
`'final'` (Stop button, mic-lost, unmount) sets `uploading` and sends `force: '1'`. The response
decides: `pendingTurn` non-null ⇒ keep listening, `holding` true; null ⇒ `discardRecorder()` on
the mic re-opened a moment ago, then `idle`. Four refs carry it — `reasonRef`, `discardRef`,
`uploadingRef`, `silenceSentRef` — plus `turnStartedRef` for the clock's anchor.

**Deviation 1 — `startRecording` is a plain function, not a `useCallback`.** `onstop` re-opens
the recorder by calling it, so memoising it makes it capture `startRecordingRef`, and
`react-hooks/immutability` refuses to let an effect assign a ref that a memoised closure holds
("This value cannot be modified"). Nothing may pass `startRecording` to a hook now — `retry` goes
through the ref too. Its identity was never what the room read; the ref always was.

**Deviation 2 — the freeze is two ref latches, not one.** `set-state-in-effect` rejects a plain
`setResumed(null)` in the state effect; both writes are latched (`resumedReadRef`,
`resumedGoneRef`) and each fires at most once for the life of the room. Same contract as ADR-T05,
one more flag.

**Defect found in the owner's first live run, fixed in this same diff: the notice was
invisible.** Step 8 said `conversation.tsx` renders it, and that component is the voice-mode
transcript panel — which is `open={false}` by default, and closed is `clip: rect(0 0 0 0)`. AC-13
was satisfied and the candidate saw nothing. It is now `ResumedNotice`, exported from the same
file, mounted in the stage foot row beside the captions; outside the `aria-live` list by
construction rather than by placement. The component test asserted DOM presence, which is why it
passed — it now asserts the notice is outside the panel, not merely outside the `<ol>`.

**Deviation 3 — #219 is closed with explicit `waitFor` timeouts, not a fake-timer rewrite of
`voice.test.tsx`.** Every wait in that file names `SETTLE` (5 s). The room test drives real
`userEvent`, and fake timers there buy nothing the ceiling does not. The hook's own T04 block
**is** on fake timers — `toFake` lists timers and `Date` only, because faking
`requestAnimationFrame` takes the meter's loop away from `audio.level()` and the VAD then reads
nothing (that is one wasted debugging round, written down so nobody pays for it twice).

**The 2 s / 13 s pair, from the room:** 2 s is right for a mid-sentence breath and wrong for a
thought — the gate is what makes that survivable, and `L03` is where the 2 s gets revisited once
the gate's accuracy is known. 13 s is long in a silent room. Nothing here proves either number;
both are still the backlog's.

**For anyone editing the room next:** `holding` is the hook's own, from the last upload's
`pendingTurn`, and is deliberately NOT seeded from `GET /state` — the recovery notice covers the
reload case, and one live source beats two. Two mutation checks stand behind the load-bearing
parts: dropping `uploadingRef` from the clock's guard reds "does not fire the silence clock while
a probe upload is in flight", and un-freezing the notice reds the room test.

## Verification output

`npm run -w frontend test -- use-voice-session room/conversation room/voice-controls` → 53 passed
(3 files). Full frontend ring 554, root `npm test` 1112, both green. `npm run -w frontend lint`,
`npm run lint`, `npm run typecheck` clean — the frontend config caught two errors the root run
does not cover, both above. `npm run test:acceptance` → 111 scenarios, 885 steps, unchanged from
T01/T03 (host, `interviewly_test` on 55432, throwaway Redis db 9 on 56379).

Not run: the real room with live keys. The four manual checks under `## Verification` are the
human's, and nothing in this diff was tuned against them.
