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
- [x] **1. Write `language.ts`** — `trackLanguage` calling `detectLanguage`, the consecutive
  counter, the flip + `LANGUAGE_SWITCHED` log, the streak reset rule, and the
  candidate-regeneration hook.
- [x] **2. Call `trackLanguage`** from `answers.ts` after the transcript write.
- [x] **3. Confirm no `llm_calls` row** is written for classification (the heuristic is
  pure).
- [x] **4. Wire acceptance step-defs** for `language_detection.feature` @AC-13 (clear tr/en
  classify with `ambiguous` false and count; below-margin classifies `en` ambiguous true and
  does not count; a below-margin turn between two Turkish turns keeps `en`; two consecutive
  clear Turkish turns flip to `tr`; no `llm_calls` row for any classification).
- [x] **5. Run the `## Verification` command.**

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

**Shipped.** `backend/modules/interview/language.ts` —
`trackLanguage(interview, transcript, { question, traceId }) → Promise<string>` (the language
the interview runs in afterwards). Classifies through `aiClient().detectLanguage` (the seam,
not the bare function): `StubRecordingClient.detectLanguage` delegates without `audited()`, so
no `llm_calls` row exists by construction, in stub *and* live mode.

Switch rule: `Map<interviewId, { language, count }>` at module scope, `SWITCH_AFTER = 2`.
Reset on ambiguous **or** same-language **or** not-in `SUPPORTED = {en, tr}` — the third guard
matters because `detectLanguage` returns `ru`/`ja`/… by script ratio, and two Cyrillic turns
would otherwise write `language = 'ru'` (ADR-I35).

`answers.ts`: called after `ANSWER_RECORDED`, **before** `ensureTechBatch`, and its return is
assigned to `interview.language`. The request object is stale after the switch otherwise, and
ADR-I22's tech batch generates in the old language.

Regeneration hook: fire-and-forget `prepareNextCandidates` (D02), guarded on the N+1 row
already having `candidates`; failures log `CANDIDATE_REGENERATION_FAILED` and never fail the
turn. Nothing wires D02 into the answer flow yet, so the guard is false in practice today —
it is what keeps @AC-13's "no llm_calls row" true when D03 does wire it.

`cucumber.js` `default.paths` gained `.agents/features/language_detection.feature`;
`backend/features/step_definitions/language.steps.ts` is new.

### Verification output
```
npm run test:acceptance -- --tags "@language-detection"
4 scenarios (4 passed) · 25 steps (25 passed)
```
Red first: the outline's three rows passed from the start (they assert the classifier and the
absent row), `A below-margin turn does not advance a language switch` failed
`'en' !== 'tr'` until `trackLanguage` existed. Full rings 45/45 + auth 23/23, 122 unit,
lint + typecheck clean. Local runs need the host ports and, for the auth profile,
`DATABASE_URL` ending `interviewly_test`.

### For I11 / D03
- D03 promotes candidates: read them **after** `trackLanguage` has run for the turn, or a
  switch-turn promotion picks the old-language batch.
- The streak Map is process-local (ADR-I35). Any horizontal scale of `api` needs it in Redis.
