# T06 — A suspended AudioContext makes the room deaf, and only after a reload
REPO: (this repo) · Depends: T04 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — the failure is silent by construction: permission granted, recorder
running, Stop button showing, and every measurement zero. MODELS.md's line for opus is "wrong in
a way a green test still passes", and this shipped past five ledgers' worth of them.

## Goal
Owner, after the second live run (2026-08-11):

> "again while i was talking i refreshed web app and redis didnt work also gpt 4.1 again didnt
> work even though i answered and i waited too long bcs of that"

Redis was innocent and so was the gate. The API log for that run carries **zero**
`SPEECH_STT_TRANSCRIBED` — no audio was ever uploaded, before or after the refresh — while the
owner confirms the Stop button was visible and the question was audible. Mic open, nothing
measured, nothing probed.

**Cause:** `use-mic-permission.ts` created an `AudioContext` and never resumed it. Browsers
create one **suspended** unless the page has had a user gesture; a suspended analyser returns
silence, so `level` never leaves 0, `heardRef` never arms, and the VAD cannot fire. A page reload
is exactly the no-gesture case — which is why every reloaded session in the logs uploaded nothing
and every clicked-into one worked.

**Not a T04 regression.** The bug is as old as the meter (W09/S06). T04 is what made it fatal:
before the gate, the VAD was still the only automatic stop, so this always broke a reloaded voice
room — nobody had reloaded one mid-answer until now.

## Non-negotiables
- **The turn always ends.** This restores the VAD; the 13 s clock stays the backstop and is not
  touched.
- **No new permission prompt.** `resume()` on an existing context, never a re-`getUserMedia`.
- **Every listener this arms is removed** — on the first gesture that works, and in `release()`.
  A mic hook that leaks window listeners across device switches is a worse bug than the one it
  fixes.

## Context (anchors)
- `frontend/src/lib/use-mic-permission.ts:59-77` `meter()` · `:49-57` `release()`.
- `frontend/src/lib/use-voice-session.ts` — the two consumers of `mic.level`: the VAD arm effect
  and the meter the room draws.
- `frontend/src/lib/use-mic-permission.test.ts` — `AudioContext` must be stubbed with a **normal
  function**, never an arrow: `new` on an arrow throws, `meter()` runs inside `request()`'s try,
  and the throw surfaces as `state === 'denied'` rather than as the real error.

## Steps
- [x] **1. Test red.** A context created `suspended` is resumed; one the browser refuses to
  resume is retried on the first `pointerdown`; one already `running` arms no listener at all.
- [x] **2. `wake(ctx)`** in `meter()`: `resume()` immediately, and when `ctx.state` is still
  `suspended`, listen once for `pointerdown`/`keydown`/`touchstart`.
- [x] **3. Remove the listeners** in `release()` and on the gesture that lands.

## Definition of done
- A reloaded voice room measures the candidate's voice, so the VAD probes and the turn ends.
- No leaked window listener after `release()`.
- `npm run -w frontend lint` passes.

## Verification
```bash
npm run -w frontend test -- use-mic-permission use-voice-session
npm run -w frontend lint
npm run lint && npm run typecheck && npm test
```
Then, in the real room — this is the check that matters, because the bug is invisible to jsdom:
- enter the room, answer, **refresh mid-answer**, answer again → `SPEECH_STT_TRANSCRIBED` appears
  in the API log for the second answer. Before this fix it never did.
- watch the candidate's own bars after a reload: they must move while you speak.

## Notes

**Shipped:** `wake()` in `use-mic-permission.ts`, called from `meter()`, cleaned up in
`release()` via `wakeRef`. Three tests, mutation-checked (removing the `wake(ctx)` call reds all
three).

**What this does NOT fix, and the owner hit it too:** speech spoken *before* any probe still dies
with the page. The buffer that survives a reload is server-side, and nothing reaches the server
until a 2 s pause triggers an upload — so refreshing mid-sentence loses the sentence. That is
`T07`, and it is the honest reading of "I refreshed and it didn't save": with `T06` the common
case (pause, then refresh) now recovers; the uninterrupted-speech case still does not.

**Also worth knowing:** the second live run produced no evidence at all about the gate or about
`T05`'s two clocks, because no turn was ever submitted. Both are still unverified against a live
model.

## Verification output

`npm run -w frontend test -- use-mic-permission use-voice-session` → 39 passed. Root `npm test` →
1119 passed (109 files), up from 1116. `npm run lint`, `npm run -w frontend lint`,
`npm run typecheck` clean. Acceptance not re-run: no backend file changed by this task.
