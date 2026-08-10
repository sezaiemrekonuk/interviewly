# Speech — State

Last updated: 2026-08-10
Last session ended: **S09 complete.** `GET /state` carries `startedAt` and `expiresAt`
(`interviewWindow` in `state.ts`). The arithmetic moved to `modules/speech/ceiling.ts` —
`speechExpiresAt` is the instant, `isPastSpeechCeiling` is "now is past it", `tts.ts` re-exports
the guard so `stt.ts` and `tts.test.ts` are untouched (ADR-S09). Text reports
`expiresAt: null`: only the two speech routes enforce the ceiling and both refuse non-voice.
`VoiceControls` gained a required `expiresAt` prop and a countdown that re-derives every tick,
warns in words at 60s, and announces once from a fixed `role="status"` line. `room-rail.tsx`'s
arrival clock now derives from `startedAt`, closing its ponytail. Both read the new
`lib/use-clock.ts` (`useNowMs`, one `useSyncExternalStore` interval) — the frontend eslint config
allows neither `Date.now()` in render nor a `setState` seed in an effect, and it runs in the
pre-commit hook but **not** in root `npm run lint`. Lint + typecheck, unit 810, frontend 455,
acceptance 111/111. Next: **S10**.

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

**S10** (speech failure codes surfaced honestly in the room — sonnet tier). Note S09's
hand-off: the copy lands in the same `VoiceControls`, and the room's `status: 'lost'` banner is
still untested (tech debt below).

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

- ~~**`ELEVENLABS_API_KEY` must be rotated.**~~ **Closed 2026-08-09, was never true.** `.env` is
  gitignored (`.gitignore:4`), `git ls-files .env` is empty, and no commit in `--all` history
  ever added it — only `.env.example` (f721f60), whose key fields are blank. The live key sits
  on the owner's disk and nowhere else. Key probed live the same day: `GET /v1/user` 200.
- ~~**Real `personas.voice_id` values.**~~ **Closed 2026-08-10.** The seed carries
  `EXAVITQu4vr4xnSDxMaL` (Sarah) and `JBFqnCBsd6RMkjVDRZzb` (George), both probed 200 with real
  MP3 bytes, overridable via `SEED_VOICE_ID_HR` / `SEED_VOICE_ID_TECH`. Premade library voices,
  identical for every account and not credentials, so they belong in the seed and not in `.env`.
  A placeholder was a 400 from `POST /v1/text-to-speech/{voiceId}`, retried 3×
  (`elevenlabs-speech.ts:52`) and then a `VOICE_UNAVAILABLE` downgrade — on every fresh clone,
  voice looked broken rather than unconfigured. **Anyone whose database predates this must
  reseed**; the column is written by the seed, so a pull alone does not fix it.
- ~~**TTS and STT model ids**~~ **Closed 2026-08-09.** `.env` carries
  `eleven_multilingual_v2` / `scribe_v1`; both probed live (TTS 200 + MP3, STT 200 with a
  transcript). Config, so a change stays an `.env` edit.

Spec Open questions 1–3 (Scribe language handling, the VAD threshold, TTS cache eviction) carry
recommended defaults and block nothing — adopt them unless the owner says otherwise.

## Task ledger (S01–S10)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo (backend/worker/frontend are workspaces in it). Dependency-sorted.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| S01 | `SpeechProvider` seam, `FakeSpeechProvider`, env and error-code rewrite | | done | F01, F03, I15 |
| S02 | TTS route: question audio, storage-cached, ceiling-checked | | done | S01, I03, I07 |
| S03 | STT route: audio upload to Scribe to the guarded advance | | done | S01, I03, I06 |
| S04 | Per-call usage accounting at both provider call sites | | done | S02, S03, I08 |
| S05 | Remove the convai, webhook and reconciliation surface; drop `voice_sessions` | | done | S02, S03, S04 |
| S06 | Room turn loop: speak, VAD-record, upload, advance | | done | S02, S03, W10 |
| S07 | Pre-join on resume, mic-denied downgrade, transient-audio copy | | done | S06, V03, W09 |
| S08 | Voice-first default and user-selectable duration | | done | S01, W05 |
| S09 | `startedAt` and `expiresAt` in `/state`, and the room timer | | done | S02, I03 |
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
- **[S06] `voice/device-check.ts` is still an unimported second `AnalyserNode`.** S06 picked
  `use-mic-permission.ts` as the room's mic and VAD source and added no third graph, so the
  duplication is now dead code rather than a live divergence (#107).
- **[S05→S10] Nothing tests `status: 'lost'` in the room.** `voice.test.tsx`'s dropped-session
  reconnect test went with the socket S05 deleted. S07 covered mic denial at *pre-join*, which is
  a different surface — the room's lost banner + `reconnect` are still untested. S10 owns the
  room's failure copy and is where this gets covered.

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
