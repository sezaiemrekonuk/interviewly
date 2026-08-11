# Turn-taking — State

Last updated: 2026-08-11
Last session ended: **`T01` done (Ahmet, 2026-08-11, opus-5 on a sonnet-tier task — owner
override, see the devlog).** The gate exists as a seam method only; nothing calls it yet.
Changed: `packages/ai/` (`AiClient.ts`, `live-client.ts`, `stub.ts`, `resolve-client.ts`,
`schemas.ts`, `prompt-vars.ts`, `providers.ts`, `index.ts`, new
`prompts/interview.turn.complete.prompt.yaml`, new `src/turn-complete.test.ts`,
`prompt-builder.test.ts` name list) plus one delegating method in
`backend/features/step_definitions/adaptive.steps.ts`.
For `T03`: `turnComplete` never rejects — no call site needs a catch — and the chain opt-out is
`buildSoloChain`, not a slice of `buildChain`. Real nano verdicts (9/9 correct, both languages)
are in the task's `## Notes`; they are the only data spec Open question 1 has.

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

**`T02`** — the only unblocked `todo` row. `T03` still needs it.

## Ledger

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| T01 | The completeness gate: prompt, schema, seam method, chainless, fail-open | | done | C02, I02 |
| T02 | The held partial: `pending-turn.ts`, atomic take, the two caps | | todo | F03, S03 |
| T03 | Turn paths: gate + join + hold, the silence turn, `pendingTurn` on `/state` | | todo | T01, T02, C01, C02 |
| T04 | The room: probe-vs-final stop, the 13 s clock, the recovery notice | | todo | T03, S06 |

## Dependency graph

T01 ∥ T02 → T03 → T04. Nothing else in the project waits on any of them.

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

No migration is added by this ledger. `chat_messages.action` already exists and already carries
free-text values (`continue`, `drift`, `refused`); `silence` joins them without a schema change.

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

**None.** No other ledger cites a `T0x` task.

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
- **[T04] Issue #219 (flaky voice turn-loop test) is folded into T04.** `voice.test.tsx` races a
  real 1 000 ms `waitFor` and red-lights PRs that touch nothing near the room; T04 rewrites every
  timing assertion in that file anyway. If T04 slips, the standalone fix is one line —
  `testTimeout` in `frontend/vitest.config.mts` — and is worth doing alone: a red `unit` job that
  does not mean "you broke something" is how red builds start getting ignored.
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
- **Gate accuracy telemetry on Turkish** (spec Open question 1). Log verdicts against fragment
  length now; promote a tuning task only once there is data showing the error rate.
- **`FORCE_SUBMIT_MS` to config.** 13 s is a guess like the 2 s before it. Promote when a real
  candidate says it is wrong, not on principle.
- **Rate limits on `/turns/audio`.** Each fragment is a paid STT call, and a turn can now make
  several. Fold into issue #120's existing gap-class task rather than opening a parallel one.
