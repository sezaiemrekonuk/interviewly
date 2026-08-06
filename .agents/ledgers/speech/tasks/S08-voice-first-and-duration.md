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
- [ ] **1. Test red** — a create with no mode yields `mode='voice'`; a duration above the ceiling
  is refused; a duration below it is honoured. See them red.
- [ ] **2. Default flip** to `'voice'`, with the mode control labelled and explained in both
  locales.
- [ ] **3. Duration field** — a bounded control at setup, persisted per interview, defaulting to
  the configured ceiling.
- [ ] **4. Server validation** — refuse above the ceiling with `VALIDATION_ERROR`; never clamp.
- [ ] **5. Wire it to the ceiling** — S02 and S03's elapsed check reads the interview's chosen
  duration where one was set, the config ceiling otherwise.
- [ ] **6. Unit test** — the default, the refusal, and that a chosen duration shortens the
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

## Notes
