# Speech — State

Last updated: 2026-08-06
Last session ended: **S01 complete.** Created `backend/modules/speech/` with `SpeechProvider.ts`
(interface + module binding), `fake-speech.ts` (FakeSpeechProvider with failNext), and
`elevenlabs-speech.ts` (real driver: TTS + STT, 5 s timeout, 3 attempts, failure logging).
Rewrote `backend/src/lib/env.ts`: `ELEVENLABS_API_KEY` now `z.string().min(1)` (boot failure on
empty), added `ELEVENLABS_TTS_MODEL` (default `eleven_multilingual_v2`) and `ELEVENLABS_STT_MODEL`
(default `scribe_v1`). Added `SPEECH_AUDIO_INVALID` (400) and `SPEECH_TRANSCRIPTION_FAILED` (502)
to error-codes.ts; copy added to both locales. Added `.agents/features/speech_turn.feature`
(3 seam scenarios @speech @AC-1/@AC-3) and wired `cucumber.js`. Wrote step definitions in
`backend/features/step_definitions/speech.steps.ts`. Unit tests (5/5 green). Acceptance ring
requires Docker (Redis ECONNREFUSED in sandbox — same situation as V05's devlog).
Next: **S02** (TTS route), no new dependencies beyond S01 being done.

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

**S02** (TTS route: question audio, storage-cached, ceiling-checked)

## Environment

Every dependency of this ledger is already `done` — F01/F02/F03, A01, I03/I06/I07/I08, and
V03 (whose `downgradeToText` this ledger keeps). There is nothing to wait for.

```bash
docker compose up -d db cache
cd backend && npm install && npx prisma migrate deploy && npm run seed
```

No tunnel. No public ingress. ElevenLabs is called outbound from `backend` only, so the
acceptance ring runs entirely against `FakeSpeechProvider` with no network.

## Open blockers / decisions for the user

Owner-supplied values. **None blocks S01–S06 against the fake**, but every one of them blocks
the first real voice interview:

- **`ELEVENLABS_API_KEY` must be rotated.** `.env:39` holds a live key and `.env` is tracked in
  git. Under this architecture the key is billed per question and per answer, so a leaked key is
  a metered cost, not only an access problem. **Decides:** the owner, in the ElevenLabs console.
  **Blocks:** any real provider call. Not the acceptance ring.
- **Real `personas.voice_id` values.** `prisma/seed.ts:197,206` seeds
  `'placeholder-voice-hr'` / `'placeholder-voice-tech'`. **Decides:** the owner, by picking two
  voices in the ElevenLabs library. **Blocks:** S02 against the real driver only.
- **TTS and STT model ids** (`ELEVENLABS_TTS_MODEL`, `ELEVENLABS_STT_MODEL`). **Decides:** the
  owner. **Recommended default:** the current multilingual TTS model and `scribe_v1`; both are
  config, so a change is an `.env` edit, not a code change.

Spec Open questions 1–3 (Scribe language handling, the VAD threshold, TTS cache eviction) carry
recommended defaults and block nothing — adopt them unless the owner says otherwise.

## Task ledger (S01–S10)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo (backend/worker/frontend are workspaces in it). Dependency-sorted.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| S01 | `SpeechProvider` seam, `FakeSpeechProvider`, env and error-code rewrite | | done | F01, F03, I15 |
| S02 | TTS route: question audio, storage-cached, ceiling-checked | | todo | S01, I03, I07 |
| S03 | STT route: audio upload to Scribe to the guarded advance | | todo | S01, I03, I06 |
| S04 | Per-call usage accounting at both provider call sites | | todo | S02, S03, I08 |
| S05 | Remove the convai, webhook and reconciliation surface; drop `voice_sessions` | | todo | S02, S03, S04 |
| S06 | Room turn loop: speak, VAD-record, upload, advance | | todo | S02, S03, W10 |
| S07 | Pre-join on resume, mic-denied downgrade, transient-audio copy | | todo | S06, V03, W09 |
| S08 | Voice-first default and user-selectable duration | | todo | S01, W05 |
| S09 | `startedAt` and `expiresAt` in `/state`, and the room timer | | todo | S02, I03 |
| S10 | Speech failure codes surfaced honestly in the room | | todo | S06 |

**S02 and S03 are genuinely independent** — both depend on S01 but not on each other; either
order is safe for the single ledger owner. **S08 and S09 do not depend on S06**: the setup
control and the `/state` fields are server-and-form work that lands whether or not the room loop
is finished.

**S05 is last among the backend tasks on purpose.** It deletes the convai surface only after
S02–S04 have replaced it. A ledger that deletes first leaves the repo with no voice path for
several sessions and the acceptance ring red for a reason nobody can distinguish from a
regression.

## Critical path

S01 → (S02 ∥ S03) → S04 → S05, and S06 branches off S02/S03 in parallel with S04/S05.
S07 and S10 hang off S06; S08 and S09 are independent leaves.

## Cross-ledger dependencies (blocks this ledger)

| Ledger task | Provides | Needed by |
|---|---|---|
| F01 | `error-codes.ts` registry and `@interviewly/types` | S01 |
| F03 | `logger.ts`, `env.ts`, `compose.yaml`, the CI acceptance runner | S01 |
| I15 | the validated config surface the new `ELEVENLABS_*` keys join | S01 |
| I03 | ownership resolver and `GET /state` | S02, S03, S09 |
| I06 | `advanceWithAnswer` and `answerInputSchema` — the only answer path | S03 |
| I07 | `applyTransition` — `time_exhausted` and the downgrade route here | S02, S05 |
| I08 | `withBudget` and the `spent_usd`/`llm_calls` single-transaction contract | S04 |
| V03 | `downgradeToText` and `POST /:id/voice/downgrade` — kept, unchanged | S07 |
| W05 | the `/interviews/new` setup form S08 changes | S08 |
| W09 | the `/interviews/:id/pre-join` screen S07 changes | S07 |
| W10 | the room shell S06 rewires | S06 |

All of the above are `done`. **No speech task may be merged until its `Depends on` are green** —
which today means only the intra-ledger `S` dependencies actually gate anything.

## Cross-ledger dependencies (this ledger blocks)

**None.** No other ledger cites an `S0x` task in its `Depends on`. As with voice, nothing
downstream waits on speech.

## Supersession of the voice ledger

`.agents/ledgers/voice/` stays on disk, `done`, unedited except for a pointer in its
"Last session ended" line. Its `DECISIONS.md` is the honest record of a decision that was made,
built and then reversed by the owner — ADR-S01, ADR-S03 and ADR-S04 supersede ADR-V01, ADR-V02
and ADR-V04 by reference, never by edit.

What survives from voice, unchanged in code: `downgrade.ts` (`downgradeToText`), the
`POST /:id/voice/downgrade` route, `frontend/src/lib/voice/{device-check,active-speaker,
downgrade}.ts`, and the downgrade invariant itself.

## ⚠ Known tech debt

- **[S01] Three copies of the error-code registry.** `backend/src/lib/error-codes.ts` has stale
  compiled twins checked into `src/` (`error-codes.js`, `error-codes.d.ts`) and a third under
  `packages/types/dist/`. Editing the registry silently leaves the twins wrong. Not this
  ledger's to fix; promote when the next task touches the registry a second time.
- **[S06] `use-mic-permission.ts` and `voice/device-check.ts` both own an `AnalyserNode`.**
  `use-mic-permission.ts:4-5` already flags the duplication. S06 must pick one as the VAD
  source rather than adding a third audio graph.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **Streaming TTS and partial transcripts.** The turn loop is deliberately discrete (ADR-S06,
  PLAN Out of scope). Promote once a discrete loop is shipped and the pause after each answer is
  measured rather than guessed.
- **TTS cache eviction** (spec Open question 3). Cached question audio under `speech/{questionId}`
  is never deleted. Promote with the retention/soft-delete work, which is where an object
  lifecycle belongs.
- **Rate limits on the two speech routes.** Both spend money per request. Issue #120 already
  tracks the gap class for `/uploads`, token confirms, `/admin/stats` and SSE; promote these two
  into that task rather than opening a parallel one.
- **A second STT vendor behind the seam.** `SpeechProvider` makes it a driver swap. Promote only
  if Scribe's Turkish accuracy proves inadequate in practice — not before, and not on principle.
