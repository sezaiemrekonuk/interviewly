# S08 — Voice-first default and user-selectable duration
REPO: (this repo) · Depends: S01, W05 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — a default flip and a bounded select over a cap already enforced end
to end. The server-side refusal above the ceiling is the only part that must not be skipped.

## Goal
Owner's ask:

> "mod hep ses olsun, ses yoksa metine otomatik fallback" · "sesli seçenek elle seçilebilir
> olsun, max-capped"
> — the owner's notes; issues #102 and #103; speech spec AC-11

Voice becomes the default interview mode with an automatic fall back to text, and the candidate
picks how long a voice interview runs, up to the platform ceiling.

## Security boundaries
- **The cap is enforced server-side.** A duration arriving above `VOICE_MAX_INTERVIEW_SECONDS`
  is refused with `VALIDATION_ERROR`, not clamped silently. A clamped value the user did not
  choose is a lie about what they asked for; a client-trusted value is an uncapped spend.

## Non-negotiables
- **Voice-first means the default, not the only option.** Text stays explicitly selectable —
  a candidate without a quiet room needs it, and the downgrade is one-directional (§3.8), so a
  wrong default costs them the whole interview.
- **The automatic fallback must cover more than one failure class.** Today exactly one exists:
  a failed mint downgrades server-side (`modules/voice/session.ts:81`). S02, S03 and S07 add the
  others; this task's job is to make the default safe *given* they exist, so do not flip the
  default if S02/S03's downgrade branches are not in place.
- **The duration bounds the interview, not the round.** `VOICE_MAX_ROUND_SECONDS` stays fixed;
  the user's choice caps `VOICE_MAX_INTERVIEW_SECONDS` for that interview, downward only.
- **The mode control explains itself.** Today it is an unlabelled two-option `<Select>`
  (`interviews/new/page.tsx:129-141`) with no statement of what changes. Voice-first makes that
  worse, not better, unless the control says what voice mode means.

## Context (anchors)
- `frontend/src/app/interviews/new/page.tsx:35` — `useState<'text' | 'voice'>('text')`, the
  default to flip.
- `frontend/src/app/interviews/new/page.tsx:129-141` — the mode `<Select>` to replace with a
  labelled control.
- `backend/modules/interview/setup.ts:10` — `mode: z.enum(['voice','text'])`; the duration field
  joins this schema.
- `backend/src/lib/env.ts:43-44` — the two ceilings.
- `backend/modules/voice/downgrade.ts:21` — the one-directional downgrade the default relies on.
- `frontend/messages/{en,tr}.json:168` — `setup.modeVoice`; the new copy goes beside it.

## Steps
- [x] **1. Test red** — a create with no mode yields `mode='voice'`; a duration above the ceiling
  is refused; a duration below it is honoured. See them red.
- [x] **2. Default flip** to `'voice'`, with the mode control labelled and explained in both
  locales.
- [x] **3. Duration field** — a bounded control at setup, persisted per interview, defaulting to
  the configured ceiling.
- [x] **4. Server validation** — refuse above the ceiling with `VALIDATION_ERROR`; never clamp.
- [x] **5. Wire it to the ceiling** — S02 and S03's elapsed check reads the interview's chosen
  duration where one was set, the config ceiling otherwise.
- [x] **6. Unit test** — the default, the refusal, and that a chosen duration shortens the
  effective ceiling rather than extending it.

## Definition of done
- speech AC-11 green.
- A new interview with no explicit choice is voice.
- A duration above the platform cap is refused, not clamped.
- The chosen duration is what the TTS and STT ceiling checks measure against.

## Verification
```bash
npm run -w frontend test -- interviews/new
npm test -- --project node interview/setup
npm run test:acceptance -- --tags "@speech"
```
Expected: all green, including a refused over-ceiling duration.

Ran green: frontend 18, `interview/setup` 38, `@speech` 20 scenarios / 127 steps. The
acceptance line needs host overrides outside compose — `.env` names `db:5432`:
`DATABASE_URL=…@localhost:15432/interviewly REDIS_URL=redis://localhost:16399 S3_ENDPOINT=http://localhost:9001`.

## Notes

**Step 2 was already done.** `new/page.tsx` defaulted to `'voice'` since f01217e (W-side setup
rework), and the mode control is a labelled `Segmented`, not the unlabelled `<Select>` the task
anchors describe. All `Context (anchors)` line numbers in this file are stale by ~80 lines.
What this session added on that axis: `setup.modeNote` in both locales, saying the interview
falls back to text on its own — the owner's "ses yoksa metine otomatik fallback", which the
control never stated.

**The default now lives server-side too.** `mode` is `z.enum([...]).default('voice')`
(`setup.ts:31`), so a body that omits it is a voice interview. Previously omitting it was a 422.

**New column: `interviews.max_duration_seconds Int?`** + migration
`20260809210000_interview_max_duration_seconds` (nullable column + a `> 0` CHECK — what
ADR-F02 lets a feature ledger add). **Null means "no choice"**, which is what keeps
`VOICE_MAX_INTERVIEW_SECONDS` in charge; there is deliberately no column default, because one
would freeze today's config value onto every future row.

**The upper bound is not in Zod and not a CHECK.** It is config, and both of those read it once
— at module load / at migration time. `setup.ts:180` compares against `config.VOICE_MAX_INTERVIEW_SECONDS`
per request and throws `VALIDATION_ERROR`. Never clamps.

**`isPastSpeechCeiling(startedAt, maxDurationSeconds?)`** (`speech/tts.ts:22`) — the choice
joins the same `Math.min` as the two config ceilings, so it can only shorten. Both callers
(`tts.ts:75`, `stt.ts:89`) pass `interview.max_duration_seconds`; `activeInterview` returns the
full row, so no select changed.

**For S09:** `expiresAt` must be computed from `max_duration_seconds` where set, not from
`config.VOICE_MAX_INTERVIEW_SECONDS` alone, or the room timer will disagree with the 403 the
server issues. Same `Math.min` as `isPastSpeechCeiling`.

**Frontend:** `DURATIONS` offers full / 10 / 15 / 20 min; "full" sends no `durationSeconds` at
all. The control renders only for `mode === 'voice'` and a switch to text drops the value.
`VOICE_MAX_INTERVIEW_SECONDS = 1500` is exported from `new/page.tsx` as a bound on what may be
offered — mirrored the way `MAX_HR`/`MAX_TECH` already are, never as the enforcement.

**Unrelated local repair:** `env-drift.test.ts` was red on a clean tree — local `.env` was
missing `WORKER_HEALTH_PORT`, which `.env.example:18` documents. Added to `.env` (untracked).
