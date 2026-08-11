# Speech-latency — State

Last updated: 2026-08-11
Last session ended: **Ledger opened (Ahmet, 2026-08-11, opus-5). No code written yet.** The room
takes ~7.1 s from a candidate's last word to the interviewer's first sound, measured against live
providers rather than estimated (REFERENCE.md carries the table and the method). The spec
(`.agents/specs/2026-08-11-speech-latency.md`), PLAN, five ADRs and four task files are in place;
the ownership row is in `.agents/EXECUTE.md`.

Three things were settled by measurement rather than argument: connection pooling is **not** the
problem and the hypothesis is recorded dead (ADR-L02); the TTS model is 3.3× faster in config but
the swap is the owner's ear to decide, not a benchmark's (ADR-L03); and `VAD_SILENCE_MS` — the
single largest line in the whole budget — can only shorten behind turn-taking's gate (ADR-L04).
Streaming is #266 and stays out (ADR-L05).

`L01` and `L04` are unblocked and independent of everything. `L02` and `L03` wait on turn-taking.

## Execution protocol (follow exactly)

Do not start from this file. `.agents/EXECUTE.md` is the prompt, and its § 4 decides which task
is yours — not the "Current task" pointer below, which is a human-readable summary and can lag.

Read this file → read `REFERENCE.md` once → read only the task § 4 gave you → check `MODELS.md`
for the required tier and stop if it is not yours → do the work, ticking checkboxes → run the
task's `## Verification` command verbatim → fill in the task's `## Notes`, **including the
measured before and after** → update this file's ledger row, "Current task" pointer, and "Last
session ended" line → write `.agents/devlogs/{ID}-<slug>.md` (EXECUTE.md § Devlog) → **do not
commit** → re-apply EXECUTE.md § 4 and continue with what it gives you.

## Current task

**`L01`** — the biggest cheap win, blocked on nothing, and it needs a human's ears rather than a
green test. `L04` is equally unblocked if you would rather measure than listen.

## Ledger

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| L01 | The TTS model: measure, listen, then swap or reject | | todo | S02 |
| L04 | The conductor's real prompt: production-sized TTFT, then prefix caching or not | | todo | C02 |
| L02 | Assistant ids on the turn response, synthesis begun when the row is written | | todo | T03, S02 |
| L03 | Shorten `VAD_SILENCE_MS` behind the gate | | todo | T04, L01 |

## Dependency graph

`L01 ∥ L04` today. `L02` after turn-taking `T03`; `L03` after turn-taking `T04`.

Rows are listed in the order they can actually be started, not by number — `L02` and `L03` are
numbered for the sequence they were designed in, but both wait on another ledger.

**`L03` depends on `L01`** so the two latency changes land separately and each keeps its own
measured before/after. Shipping a model swap and a window change together makes both
unattributable.

## Why L02 and L03 wait on turn-taking

Not politeness — file conflicts and a correctness dependency:

- `turn-taking` T03 adds `pendingTurn` to the turn response; **L02 adds `spokenIds` to the same
  shape**. Sequencing them avoids two ledgers editing `TurnResult`, `stt.ts` and `turns.ts` in
  the same window.
- `turn-taking` T04 rewrites the room's `onstop`; **L02 reads `spokenIds` inside it.**
- **L03 is correctness-dependent, not just conflict-dependent.** Without T04's
  restart-before-upload, extra probes land *on* the critical path instead of off it, and a
  shorter window would make the room slower rather than faster.

## Environment

```bash
docker compose up -d db cache
cd backend && npx prisma generate && npx prisma migrate deploy
```

No migration in this ledger. `L01` needs a live `ELEVENLABS_API_KEY` and speakers — it cannot be
done against the fake provider, because the entire question is what the audio sounds like.

## Cross-ledger dependencies (blocks this ledger)

| Ledger task | Provides | Needed by |
|---|---|---|
| S02 | the TTS route, the storage cache, the double-checked read inside the budget lock | L01, L02 |
| C02 | `conductor.ts`, the conduct prompt, `TurnResult` | L02, L04 |
| I08 | `withBudget` and the single-transaction spend contract | L02 |
| T03 | the turn response shape L02 edits again | L02 |
| T04 | restart-before-upload, without which a shorter window is a regression | L03 |

S02, C02 and I08 are `done`. **T03 and T04 are `todo`** in `.agents/ledgers/turn-taking/`.

## Cross-ledger dependencies (this ledger blocks)

**None.** No other ledger cites an `L0x` task.

## Relationship to turn-taking

`turn-taking` adds 780 ms — its completeness gate — in exchange for not interrupting a candidate
mid-thought, and its STATE.md says so plainly. This ledger is where that is paid back and then
some. Neither ledger should be read as contradicting the other: one buys correctness with
latency, the other buys the latency back somewhere cheaper.

## ⚠ Known tech debt

- **[L01] No automated guard on voice quality.** If the model swap lands, nothing stops a future
  `.env` edit from silently regressing the interviewer's voice. A quality check is not
  automatable in a unit test; the mitigation is that the model id is config and the ADR says why
  it was chosen.
- **[baseline] The conductor's 1 180 ms was measured with a toy prompt.** The real one carries a
  persona brief, job listing, CV and up to 7 000 characters of conversation. The production figure
  is worse by an unmeasured amount. L04 exists to close this, and until it does the baseline
  table understates the total.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **Streaming (#266).** Pipelined conductor→TTS is ~1 700 ms and wants its own ledger. Streaming
  STT is ~1 650 ms and would obsolete `turn-taking` rather than improve it. Both declined
  2026-08-10; see ADR-L05.
- **Shorter conductor replies.** TTS time scales with output length, and a `next_question` reply
  carries the whole question. Promote if L04 shows the prompt is already tight and the remaining
  TTS time is dominated by length rather than model.
- **Pre-synthesising the next question during the current answer.** The row's text exists before
  it is asked, but the conductor rewrites it at delivery, so this is only sometimes knowable.
  Promote after L02, which is the cheap half of the same idea.
- **A latency budget in CI.** Nothing currently notices if a change adds a second. Promote when
  there is a stable number worth regressing against — not before L01–L04 have moved it.
