# Turn-taking — State

Last updated: 2026-08-11
Last session ended: **`T04` and `T05` done (Ahmet, 2026-08-11, opus-5) — the ledger is green.**
T04 rewired the room to probe rather than end: `use-voice-session.ts` (`stop(reason)`, the
restart-before-upload, the clock, `holding`), `query.ts` (`kind`, `force`, `pendingTurn`),
`ResumedNotice`, `voice-controls.tsx`, the room page, both locales. **Issue #219 is closed.**
`T05` followed the owner's first live run: the gate held three of four finished answers, so
ADR-T06 split the window (4 s with a fragment held, 13 s with nothing said) and prompt
`interview.turn.complete` v2 leads with the finished default. `CONDUCTOR_TURN_FORWARDED` now
carries the verdict, so the hold rate is countable.
**Two things the next session must know:** the T04 notice first shipped inside the voice-mode
transcript panel, which is closed and clipped — invisible, and the component test passed because
it asserted DOM presence; it is now `ResumedNotice` in the stage foot row. And T05's prompt half
is **unverified against a live model** — its tests assert the K9 contract, not the judgement.

**The gate costs 780 ms, measured (2026-08-11).** `gpt-4.1-nano`, warm median over n=5, min 556,
max 887 — which confirms ADR-T03's 3 s timeout as a ceiling rather than a target. It is a real
cost this ledger adds in exchange for not interrupting a candidate mid-thought, and it is paid
back in `.agents/ledgers/speech-latency/` (`L02` alone returns ~800 ms). The full budget —
~7.1 s from a candidate's last word to the interviewer's first sound — lives in that ledger's
REFERENCE.md. Do not re-measure it here.

## Execution protocol (follow exactly)

Do not start from this file. `.agents/EXECUTE.md` is the prompt, and its § 4 decides which task
is yours — not the "Current task" pointer below, which is a human-readable summary and can lag.

Read this file → read `REFERENCE.md` once → read only the task § 4 gave you → check `MODELS.md`
for the required tier and stop if it is not yours → do the work, ticking checkboxes → run the
task's `## Verification` command verbatim → fill in the task's `## Notes` → update this file's
ledger row, "Current task" pointer, and "Last session ended" line → write
`.agents/devlogs/{ID}-<slug>.md` (EXECUTE.md § Devlog) → **do not commit** → re-apply
EXECUTE.md § 4 and continue with what it gives you.

## Current task

**None — every row is `done`.** What is outstanding is not a task but a measurement: `T05`'s
manual check in the real room, which is the only thing that can say whether prompt v2 actually
lowered the hold rate. Next work on these files is speech-latency `L02`/`L03`.

## Ledger

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| T01 | The completeness gate: prompt, schema, seam method, chainless, fail-open | | done | C02, I02 |
| T02 | The held partial: `pending-turn.ts`, atomic take, the two caps | | done | F03, S03 |
| T03 | Turn paths: gate + join + hold, the silence turn, `pendingTurn` on `/state` | | done | T01, T02, C01, C02 |
| T04 | The room: probe-vs-final stop, the 13 s clock, the recovery notice | | done | T03, S06 |
| T05 | Gate accuracy: two clocks (4 s held / 13 s silent) and prompt v2 | | done | T04 |

## Dependency graph

T01 ∥ T02 → T03 → T04 → T05. Nothing else in the project waits on any of them.

`T01` and `T02` are deliberately independent so two sessions can run them in parallel without
touching the same files. `T03` is the only task that edits `conductor.ts` and `state.ts`; `T04`
is the only task that edits the room.

## Environment

Every dependency of this ledger is `done` — F03, I02/I03/I06/I07/I08, S01–S10, C01–C06. There is
nothing to wait for.

```bash
docker compose up -d db cache
cd backend && npx prisma generate && npx prisma migrate deploy
```

One migration is added by this ledger, at T03: `20260811120000_conductor_silence`, one
`ALTER TYPE … ADD VALUE 'silence'` on the `ConductorAction` enum. The "no migration" line this
paragraph used to carry was wrong; see T03's Notes.

`REDIS_URL` must be set and reachable for `T02` onward — the held partial has no in-memory
fallback, and the acceptance suite must run against a throwaway Redis rather than a shared one
(see REFERENCE.md).

## Cross-ledger dependencies (blocks this ledger)

| Ledger task | Provides | Needed by |
|---|---|---|
| I02 | the `AiClient` seam, the provider chain, the cost audit | T01 |
| C02 | `conductor.ts`, `turnInputSchema`, `clampAction`, the drift ceiling | T01, T03 |
| C01 | `chat_messages` with `question_id` / `action`, and the replay index | T03 |
| I06 | `recordAnswer`'s `current_index` CAS — consumed, never reimplemented | T03 |
| I07 | `applyTransition` — the only writer of `interviews.state` | T03 |
| I08 | `withBudget` and the single-transaction spend contract | T01, T03 |
| S03 | `POST /turns/audio`, `transcribeRecording`, the multer limits | T02, T03 |
| S06 | the room turn loop this ledger rewires | T04 |
| F03 | `env.ts`, `logger.ts`, the shared Redis client in `auth/rate-limit.ts` | T02 |

All of the above are `done`.

## Cross-ledger dependencies (this ledger blocks)

| Ledger task | Waits on | For |
|---|---|---|
| L02 | T03 | the turn path it moves the seconds inside of |
| L03 | T04 | `VAD_SILENCE_MS`, revisited once the gate's accuracy is known |

Both are `todo` and both are now unblocked.

## Supersession

ADR-T01 supersedes **ADR-S06**'s silence rule and closes the speech spec's Open question 2 ("VAD
threshold and silence window") with an answer that ADR-S06 could not have reached: the window was
never the problem. The speech ledger stays `done` and unedited except for a pointer; ADR-S06
otherwise stands in full — the manual stop is still always visible, and it is now the only path
that skips the gate.

ADR-T02 is an exception to **ADR-C01**'s "nothing durable lives there", argued rather than
assumed: the held partial is not durable and is not the conversation. ADR-C01 is not superseded.

## ⚠ Known tech debt

- **[T01] The gate is the first prompt to opt out of the fallback chain.** `buildChain` appends
  tier-2 to everything; T01 adds a per-prompt exemption. Shipped as `buildSoloChain` in
  `providers.ts`, passed by `LiveAiClient.turnComplete` as `call`'s optional `chainFor`. If a
  second prompt ever needs it, this should become a field on the prompt YAML rather than a
  second special case in `live-client.ts`.
- **[T04] ~~Issue #219~~ closed.** Every `waitFor`/`findBy` in `voice.test.tsx` now carries an
  explicit 5 s `SETTLE` ceiling instead of inheriting the 1 000 ms default. Nothing was moved to
  fake timers there — the file drives real `userEvent`, and the hook's own T04 tests are where
  the clock is faked.
- **[T04] `holding` has one source and the notice has another.** The pause line reads the last
  upload's `pendingTurn` (hook state); the recovery notice reads `GET /state` once at mount. So a
  candidate who reloads mid-pause sees the notice but no pause line until they speak again. It is
  the cheap correct version — seeding the hook from `/state` means two sources for one fact —
  but if the pause line is ever wanted on that first breath, that is the seam.
- **[T02] The held partial has no in-memory fallback.** Redis down means every fragment is gated
  alone — correct, but silently more expensive and more interrupt-prone. There is no metric for
  it yet.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **Streaming STT (#266).** Would make the gate unnecessary: a live partial transcript carries its
  own end-of-utterance signal, and the provider does the semantic turn detection. ⚠️ It would
  **obsolete this ledger outright** — the gate, the held partial, the 13 s clock and the recovery
  notice all stop existing. If it is ever wanted, this work should be **paused, not built and then
  discarded**. Declined by the owner 2026-08-10; see `speech-latency` ADR-L05.
- **Latency generally.** Not this ledger's job. `.agents/ledgers/speech-latency/` owns the
  seconds, including the one number this ledger has a claim on: `VAD_SILENCE_MS`, which `L03`
  shortens once `T04` has shipped and the gate's accuracy is known. ADR-T01 made that argument;
  `L03` is where it gets followed through.
- **Gate accuracy telemetry on Turkish** (spec Open question 1). **Partly promoted into `T05`**
  (step 5: log the verdict beside the length, both branches). What stays here is the tuning that
  the data would justify — a threshold, a different model, a per-language prompt.
- ~~**`FORCE_SUBMIT_MS` to config.**~~ **Promoted to `T05` 2026-08-11.** The stated trigger fired:
  the owner ran the room and said 13 s was wrong. It is still not config — ADR-T06 splits it into
  two constants instead, because the two situations wanted different numbers, not a knob.
- **Rate limits on `/turns/audio`.** Each fragment is a paid STT call, and a turn can now make
  several. Fold into issue #120's existing gap-class task rather than opening a parallel one.
