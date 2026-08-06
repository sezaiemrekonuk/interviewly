# Speech — Recommended Model Per Task

Opus for anything that touches money, the time ceiling, or a state transition — those are the
three places where a plausible-looking implementation passes its happy-path test and is still
wrong. Sonnet for provider plumbing, routes with existing guards to copy, and UI. `S05` is opus
despite being mostly deletion: what it deletes includes the only enforcement of the spend cap.

EXECUTE.md §5 is the rule — the tier must match the model actually running, or the session
prints `TIER <ID> needs <tier>, running <model>` and ends.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| S01 | `SpeechProvider` seam, `FakeSpeechProvider`, env + error-code rewrite | `claude-sonnet-5` | Interface, fake, and a config edit against a pattern the repo already has three times (`storage.ts`, `voiceSeam`, the AI provider). The one judgement call — making `ELEVENLABS_API_KEY` fail at boot — is spelled out in the task |
| S02 | TTS route: question audio, storage-cached, ceiling-checked | `claude-sonnet-5` | A GET that returns bytes, with guards copied from the existing mint handler and a cache read/write over `storage.put`/`get`. The ceiling arithmetic is mechanical; S05 is where its survival is proven |
| S03 | STT route: audio upload → Scribe → `advanceWithAnswer` | `claude-sonnet-5` | multer limits copied verbatim from `uploads.ts`, then the **existing** `answerInputSchema` and `advanceWithAnswer`. The correctness that matters here is refusing to add a second answer path, which the non-negotiables state outright |
| S04 | Per-call `llm_calls` + `spent_usd` at both call sites | `claude-opus-5` | Money. The insert and the increment must share one transaction, the units must be the right kind for the right call, and a provider error must not bill. A row written outside `withBudget` is a silent budget leak that every green test still passes |
| S05 | Remove the convai + webhook + reconciliation surface; drop `voice_sessions` | `claude-opus-5` | Deletion across seven backend files, the worker, a queue, a migration, four error codes, two locales and the compose file — where the risk is not what gets deleted but what quietly goes with it. `isPastCeiling` is the only writer of `time_exhausted`; this task must prove the ceiling still fires after its gate is gone |
| S06 | Room turn loop: play → VAD-record → upload → advance | `claude-opus-5` | The state machine nobody wrote down: audio playback, recording, silence detection, upload and refetch, each with a failure that must land in text rather than a stuck room. Also the task most likely to invent a client-side index, which K11 forbids |
| S07 | Pre-join on resume, mic-denied downgrade, ADR-S07 copy | `claude-sonnet-5` | One routing ternary (`interview-row.tsx`), one call to the already-written `voiceDowngrade`, and a copy change in two locales. Small, but the copy change is a privacy claim — get the wording from ADR-S07, do not improvise it |
| S08 | Voice-first default + user-selectable duration | `claude-sonnet-5` | A default flip and a bounded select over a cap that is already enforced end to end. The server-side refusal above the ceiling is the only part that must not be skipped |
| S09 | `startedAt`/`expiresAt` in `/state` + room timer | `claude-sonnet-5` | Two fields onto an existing payload and a countdown that derives from them. Deliberately derives, never counts independently |
| S10 | Speech failure codes surfaced honestly in the room | `claude-sonnet-5` | Reading `minted.code` — which `ApiResult` has carried all along — and branching copy on it. The work is enumerating the failure modes, and the spec's table already does that |

## Summary

- **`claude-opus-5` (3 tasks):** S04, S05, S06
- **`claude-sonnet-5` (7 tasks):** S01, S02, S03, S07, S08, S09, S10

Rule of thumb: **if the task can be wrong in a way that still passes a green test — money,
ceilings, transitions, deletion — it is opus; if being wrong shows up immediately, it is
sonnet.** Never use haiku, mini, or flash for any speech task: three of these tasks spend real
money per request and two of them can strand a candidate mid-interview.
