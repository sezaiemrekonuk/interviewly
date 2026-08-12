---
task: L02
author: Ahmet
sessions: [2026-08-12]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 2
tools: []
---

## Session 1 — 2026-08-12

### What I asked for / what came back

Two things the task's own text disagreed about, and the disagreement turned out to be the whole
finding. The Goal says "begin synthesis when the row is written" and the anchor at
`conductor.ts:759` calls everything after `say()` "latency"; step 4 says "after the turn response
is sent". Both were implemented as step 4 reads. Checking whether that cost anything is where the
session earned its keep: `nextQuestion` calls `say()` last, so on the ordinary path the two
placements are milliseconds apart — but `handover` says its closing line and then runs a whole
second conductor call (`openRound`, ~1 180 ms) before returning, and there the two placements are
a second apart. Written up in `## Notes` as a promotable task rather than done here.

### Methodology trace

The extraction first, because everything else depends on it not being a second synthesis path:
`synthesise` out of `serveSpeech` with the double-checked read carried across intact, and the
pre-existing `tts.test.ts` assertions left alone as the proof. Then `spokenIds`, read back by the
request's `trace_id` rather than threaded through six return values — `say()` already stamps it,
and a handover's nested `openRound` shares it, which is exactly the two-line ordering the task
wanted. `TurnAdvance = Omit<TurnResult,'spokenIds'>` on the inner functions so the ids can only
be attached in one place. Then the prewarm off `res.json`, then the room's prefetch map.

### Friction

- **The double-bill test passed for the wrong reason at first.** `tts.test.ts` mocked
  `withBudget` as `fn => fn()` — no serialisation — so two concurrent `synthesise` calls both
  reached the provider and the re-read inside the lock proved nothing. The mock had to become a
  promise chain before the test could fail without the re-read. A test that cannot fail is worth
  less than no test, and this one was one line of mock away from being that.
- **The task's `## Verification` line does not run the tests the task asks for.**
  `npm test -- --project node speech interview/conductor` excludes `*.integration.test.ts` by
  config, so the two `spokenIds` tests never ran under the command that was supposed to gate
  them. Run separately against the compose Postgres on its published port. Noted in `## Notes`
  rather than by editing the command — EXECUTE § 6.5 says fix the code, not the command.
- **The 780 ms in the Definition of Done is not there to be had on this path.** The two round
  trips delayed TTS; they never started it. Removing them buys ~300 ms and the arithmetic says so
  before any measurement does. Recording that honestly, and pointing at L01's measured
  1 024 → 313 ms as where the rest is, was more useful than finding a way to claim the number.

### What I rejected and rewrote by hand

- **Firing the prewarm inside `say()` — rejected, then built at one call site.** As a general
  change it is wrong: on every path but one, `say()` is the last thing a turn does, so it buys
  nothing and puts a paid provider call behind a write helper. `handover` is the one exception,
  and it is worth ~1.1 s there, so that single call site got it explicitly rather than `say()`
  getting it implicitly. Written up first, built second, on the owner's go-ahead — the ordering
  matters, because the version I would have written in the first pass was the implicit one.
  The test is an ordering assertion (`['conduct','prewarm','conduct']`), which is the only shape
  that can fail for the right reason: the *what* was already covered, and only the *when* moved.
- **Threading the ids up through `nextQuestion`/`handover`/`endInterview` return values.** Four
  signatures, four chances for a path to forget one, and the handover's nested call would still
  have needed special handling. One query on the trace the rows already carry.
- **Letting the room's prefetch promise float bare.** `apiGetBlob` swallows transport failures
  but its `response.blob()` can still reject, and nothing awaits the promise between `onstop` and
  the speak effect. `.catch(() => null)`, and `speak` falls through to a fresh fetch.
- **Calling the task done.** Its point is a measured before/after; the measurement needs a
  microphone. The row is `in_progress` and STATE.md says whose job the rest is.
