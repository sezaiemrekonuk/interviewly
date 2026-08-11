# T04 — The room: a pause is not the end of a turn
REPO: (this repo) · Depends: T03, S06 · Status: todo
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
- [ ] **1. Test red** — with fake timers and a stubbed mutation: a `pendingTurn` response keeps
  `recording` true and re-opens the recorder; a null `pendingTurn` moves to idle; the 13 s clock
  fires the silence submit exactly once; a fully silent turn never uploads audio; manual Stop
  sends `force`. See them red.
- [ ] **1b. Close #219 while you are in here.** `voice.test.tsx:234` and `:341` race a real
  1 000 ms `waitFor` against a request the loop has to issue — it fails on loaded CI runners and
  red-lights PRs that touch nothing near the room. Every timing assertion in that file is being
  rewritten by this task anyway. Drive the loop on fake timers, and give any remaining real-clock
  `waitFor` an explicit timeout rather than inheriting the default.
- [ ] **2. Stop reasons** — `stop(reason: 'probe' | 'final')`. The VAD passes `'probe'`; the Stop
  button, the mic-lost effect and unmount pass `'final'`.
- [ ] **3. `onstop`** — a `discardRef` short-circuit first; take the blob; on a probe stop call
  `startRecording()` immediately, before the upload; then upload with `force: '1'` on a final
  stop.
- [ ] **4. The two responses** — `pendingTurn` non-null ⇒ stay listening. Null ⇒ the turn was
  conducted: abort the recorder started a moment ago via `discardRef` (the interviewer is about
  to speak; an open mic would record the TTS), then `setPhase('idle')` as today.
- [ ] **5. Phase** — no new phase. A probe keeps `phase === 'listening'`, so the avatar keeps
  saying *listening* and the bars keep moving, which is the truth. Only a real submit reaches
  `uploading`/`acknowledging`.
- [ ] **6. The 13 s clock** — one new interval effect beside the VAD pair, live while
  `phase === 'listening' && !mic.muted`. Anchor is `heardRef.current ? lastLoudRef.current :
  turnStartedRef.current`. At `FORCE_SUBMIT_MS = 13_000` submit `{ kind: 'silence',
  inputMode: 'voice' }`. Guard against firing twice, and against firing while an upload is in
  flight.
- [ ] **7. Mutations** — `useSubmitTurn` grows `kind`; `useSubmitAudioTurn` grows the optional
  `force` field and returns `pendingTurn`.
- [ ] **8. The recovery notice** — `conversation.tsx` takes an optional `pendingTurn` prop and
  renders `.resumed` after the `<ol>`: uppercase mono label, the quoted italic text, a hint line.
  Tail-truncate at ~180 characters with the front elided — what the candidate needs is the
  sentence they were in the middle of, not the start of a thought they finished minutes ago.
  Read `state.pendingTurn` once on mount into a ref in the room page; frozen thereafter; gone
  when the turn is conducted. Voice mode only.
- [ ] **9. The pause line** — while the recorder is listening and something is held, the mic strip
  says so. Static, no live region.
- [ ] **10. Copy** — three keys in both locales:
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
_(fill in when done — record what the 2 s / 13 s pair actually felt like; both numbers are
guesses the backlog is waiting on)_
