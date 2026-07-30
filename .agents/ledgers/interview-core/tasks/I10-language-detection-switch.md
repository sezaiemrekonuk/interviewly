# I10 — Language detection + two-consecutive-turn switch counting
REPO: (this repo) · Depends: I06 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — a deterministic no-LLM heuristic (built in I01) plus a consecutive-turn counter over the answer flow. No trust boundary, no cost path. If the margin edge cases surface, code-review with `claude-opus-4.8`.

## Goal
Owner's ask:

> "Apply `AiClient.detectLanguage` per answered turn, with no LLM call, and switch
> `interviews.language` only after two consecutive turns in the other language, emitting
> `LANGUAGE_SWITCHED`. A below-margin turn breaks the streak. Scenario AC-13 in
> `language_detection.feature` green."
> — interview-core decomposition (§3.4, ADR-I09)

The heuristic itself (`detectLanguage`, the `en`/`tr` stop-word lists, the script-ratio and
stop-word margins) lives in `@interviewly/ai` (I01). This task applies it in the answer flow
and implements the two-consecutive-turn switch counter. It adds no new endpoint.

## Security boundaries
- **No LLM call for classification** (`language_detection.feature` @AC-13 asserts no
  `llm_calls` row is recorded for the language classification). `detectLanguage` is a pure
  function; do not route it through the provider chain.

## Non-negotiables
- **Per answered turn**, call `detectLanguage(transcript, interview.language)`; a clear
  Turkish turn classifies `tr` (ambiguous false, counts), a clear English turn `en`
  (counts), a below-margin turn returns `{ language: current, ambiguous: true }` and **does
  not** count toward a switch.
- **Switch only on two consecutive turns** in the other language. A below-margin turn
  between two Turkish turns breaks the streak (`interview.language` stays `en`); two
  consecutive clear Turkish turns flip it to `tr` and log `LANGUAGE_SWITCHED (from, to)`.
- **On a switch, ask `ai` to regenerate any pre-generated K4 candidates** (wrong language) —
  a hook call, not a blocking step; the adaptive ledger owns the regeneration content.

## Context (anchors)
- `backend/modules/interview/language.ts` — **create.** `trackLanguage(interview, transcript)`:
  call `detectLanguage`, maintain a per-interview consecutive-other-language counter (derive
  it from the last answers' classifications, or a small `language_streak` held in memory/
  Redis keyed by interview id — no schema change), flip `interviews.language` and log
  `LANGUAGE_SWITCHED` on the second consecutive turn, reset the streak on a below-margin or
  same-language turn.
- `backend/modules/interview/answers.ts` — I06. Call `trackLanguage` after the answer +
  chat_message write, before the response. A switch updates `interviews.language`.
- `packages/ai/src/detect-language.ts` — I01. `detectLanguage(text, current)`; reuse, do not
  reimplement. It makes no LLM call.
- `backend/src/lib/db.ts` — F02 `prisma`. `interviews.language` is the only column written.
- `backend/src/lib/logger.ts` — F03. `LANGUAGE_SWITCHED`.

  **The trap:** the counter is *consecutive*, not cumulative. Two Turkish turns separated by
  a below-margin turn must **not** switch. Reset the streak on any turn that is not the
  target language *or* is ambiguous; only two back-to-back target-language turns flip it.

## Steps
- [ ] **1. Write `language.ts`** — `trackLanguage` calling `detectLanguage`, the consecutive
  counter, the flip + `LANGUAGE_SWITCHED` log, the streak reset rule, and the
  candidate-regeneration hook.
- [ ] **2. Call `trackLanguage`** from `answers.ts` after the transcript write.
- [ ] **3. Confirm no `llm_calls` row** is written for classification (the heuristic is
  pure).
- [ ] **4. Wire acceptance step-defs** for `language_detection.feature` @AC-13 (clear tr/en
  classify with `ambiguous` false and count; below-margin classifies `en` ambiguous true and
  does not count; a below-margin turn between two Turkish turns keeps `en`; two consecutive
  clear Turkish turns flip to `tr`; no `llm_calls` row for any classification).
- [ ] **5. Run the `## Verification` command.**

## Definition of done
- Each answered turn is classified via `detectLanguage` with no `llm_calls` row written for
  classification.
- `interviews.language` switches only after two consecutive turns in the other language, and
  a below-margin turn breaks the streak; a switch logs `LANGUAGE_SWITCHED`.

## Verification
```bash
npm run test:acceptance -- --tags "@language-detection"
```

## Notes
_(fill in when the task is done)_
