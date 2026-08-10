---
task: S08
author: Ahmet
sessions: [2026-08-09]
model: claude-opus-5[1m]
model_recommended: claude-sonnet-5
iterations: 1
tools: [cavecrew-investigator, superpowers:using-superpowers]
---

## Session 1 — 2026-08-09

### What I asked for / what came back
- Tier mismatch reported first (EXECUTE.md §5: `TIER S08 needs sonnet-tier, running opus`) and
  the run ended. Owner waived it explicitly ("opus is fine"), so this session is opus by
  instruction, not by drift. `model_recommended` left as `MODELS.md` has it.
- Session started as "does voice work at all", which found the real answer before any code:
  all three provider keys are live (ElevenLabs `/v1/user` 200, OpenAI, Gemini), but every
  `personas.voice_id` in the DB is `stub-voice`/`placeholder-*`. Probed
  `POST /v1/text-to-speech/placeholder-voice-hr` → **400**, so voice silently downgrades to text
  on every interview. Two working ids recorded in STATE.md.

### Methodology trace
spec AC-11 → `speech_turn.feature:@AC-11` ×3 → red (3 scenarios, `VALIDATION_ERROR` on a
no-mode create; `max_duration_seconds` null; over-ceiling accepted) → green. Unit red first
too: `setup.test.ts` 6 failing, `tts.test.ts` 1 failing.
Red was proved by stashing only the three implementation files and re-running the tagged ring —
not by trusting that a new test must have been red.

### Friction
- **The task file's anchors are ~80 lines stale.** It says `new/page.tsx:35` still defaults to
  `'text'` and the mode control is an unlabelled `<Select>`; f01217e had already flipped the
  default and replaced the control. Half of step 2 was done before the session started. Said so
  in `## Notes` rather than claiming the work.
- **The same staleness in STATE.md's blockers**, and worse: it asserted `.env` is tracked in git
  and the key must be rotated. `git log --all -- .env` is empty and `.gitignore:4` covers it —
  never true. Closed the entry with the evidence instead of leaving a scary line nobody checks.
- `npm test` was red on a clean tree before any of my changes — local `.env` missing
  `WORKER_HEALTH_PORT` (`env-drift.test.ts`). Local repair, not a repo change.
- Acceptance from the host needs three env overrides; `.env` names `db:5432`, which resolves
  only inside the compose network. Recorded in the task's Verification block.

### What I rejected and rewrote by hand
- **A `.max(config.VOICE_MAX_INTERVIEW_SECONDS)` on the Zod field.** Concise, and wrong: the
  schema object is built at module load, so the bound would be whatever config held at import.
  Replaced with a per-request comparison in the handler.
- **A CHECK constraint for the upper bound.** Same defect one layer down — it would freeze the
  config value into the table at migration time. The migration carries only `> 0`, which is a
  real invariant of the column; the comment says why the other half is absent.
- **`durationMinutes` in the API.** Rejected: the env ceilings are seconds and the column is
  seconds, so a third unit on the wire buys one conversion and one rounding bug. Minutes stay a
  presentation detail of the form.
- **Rendering the duration control for text interviews.** Written, then removed: the ceiling it
  asks about is only measured on TTS/STT calls, so for a text interview it is a control with no
  effect. It now renders for voice only, and a switch to text drops the value.
