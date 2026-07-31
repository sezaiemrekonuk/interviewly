---
task: I01
author: Sezai
sessions: [2026-07-31]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 2
tools: [superpowers:brainstorming]
---

## Session 1 — 2026-07-31

### Model note

`MODELS.md` recommends `claude-opus-4.8`; this session ran on `claude-opus-4.8`. Both are
opus-tier, which is what EXECUTE.md § 5 actually gates on, so the run proceeded. Recording
the difference rather than aligning the two keys, per the devlog contract.

### What I asked for / what came back

The task file is unusually complete — it names every file to create and the trap to avoid —
so the interesting work was not "what do I build" but reconciling three documents that
disagreed with each other. Three collisions surfaced before any code:

1. **Schema shape.** The task file sketches `ReportPayload` in camelCase
   (`overallScore`, `starAdherence`); `.agents/specs/2026-07-29-ai.md` specifies snake_case
   with extra fields (`overall_impression`, `rounds[].summary`, `language`). Grepping the
   Stage-2 feature files settled it — `schema_validation.feature` asserts
   `the stored report overall_score is an integer in 0..5` and
   `every stored questions[].star_adherence is between 0 and 1`. The payload is stored
   verbatim in `reports.payload`, so the key casing is a stored contract, not style. Spec won.
2. **`uuid` uniqueness.** Task file: "duplicate `uuid` across files → throw at load". Spec:
   "`uuid` is stable across versions". Both cannot hold — under the task file's rule, v2 of a
   prompt is unpublishable. Resolved as one-uuid-one-*lineage* (ADR-I17).
3. **`security.feature` @AC-5** ends with `And the response status is 200` and
   `And exactly 3 questions exist for the HR round`. Neither is reachable at I01: there is no
   HTTP surface until I03/I04. But I01's Definition of Done says @AC-5 must pass, and the
   task's own step 11 describes only builder-level assertions ("a non-blocking injection
   log"). The spec's criterion 5 is package-level too. The Gherkin had overshot its own AC.

### Methodology trace

Used `superpowers:brainstorming` for (3) plus the "where does the runnable feature set live"
question, because both were decisions the team owns rather than things to guess at. Presented
the forks with a recommendation each; both recommendations were taken. Wrote them up as
ADR-I15/I16/I17 rather than leaving them in the transcript.

ATDD, seen red before green:

```
cucumber.js + world.ts + prompt-builder.steps.ts written against an API that did not exist
  → npm run test:acceptance
  → RED: 9 scenarios failed, "createPromptBuilder is not a function", 2 steps ambiguous
  → implement schemas → prompts → registry → config → builder → detect-language → stub
  → GREEN: 9 scenarios, 51 steps
```

spec §7.1 B1 → `security.feature:4` @AC-3 → red → green ·
spec AC-4 → `security.feature:16,40` (two Scenario Outlines, 6 examples) → red → green ·
spec AC-5 → `security.feature:52` → red → green.

The 2 ambiguous steps in the red run were a real finding, not noise: the cucumber expression
`a {string} event is emitted {}` also matches `…is emitted with a patternId`, so cucumber
refused both. Both cardinality steps became regexes.

Second red→green: the truncation unit test asserted a 12 000-char block and got 12 978. That
was **my test being wrong**, not the builder — I matched `<job_listing>…</job_listing>`
against the whole compiled prompt, and the *system template* names `<job_listing>` in its own
instructions, so the regex matched the wrong span. The Cucumber World had already scoped its
extraction to user messages, which is why acceptance was green while vitest was red. Fixed
the test, not the code.

### Friction

- **`--passWithNoTests` had nowhere clean to go.** EXECUTE.md § 7 says the first vitest
  session must drop it from `backend/package.json`. But my tests are in `packages/ai`, and
  dropping the flag from a backend script with zero test files just moves the red. Root
  `npm test` = `vitest run` over the whole tree instead, `backend`'s `test:unit` deleted, CI
  `unit` job repointed. One runner, cannot be green on an empty repo. Root `package.json` had
  no `test` script at all, which EXECUTE.md § 7's gate assumes exists — so that needed adding
  regardless.
- **Comments in `package.json`.** Wrote a `//` comment explaining the missing
  `--passWithNoTests` straight into the JSON. Caught it immediately, but it would have broken
  every `npm` command in the repo. The explanation went to `cucumber.js` and this devlog.
- **`zod` version skew.** Root `node_modules` hoists 4.4.3 (frontend), `backend`/`worker`
  declare `^3` and get 3.25.76 nested. Declared `^3` for `packages/ai` so the schemas share
  one zod instance with the modules that consume them, and stuck to v3-compatible syntax
  (`z.number().int()`, not `z.int()`).
- **Found a pre-existing break I did not fix:** `backend/package.json` has
  `"build": "tsc -p tsconfig.json"` and `backend/tsconfig.json` does not exist. Nothing in CI
  runs it today. Logged to STATE.md Backlog and flagged as foundations' rather than pulling it
  into a feature PR.

### What I rejected and rewrote by hand

- **A `lastPrompt` accessor on `StubAiClient`.** First design for @AC-5 hung the compiled
  prompt off the stub so the step definitions could assert against it. Threw it away: that is
  a test-only affordance bolted onto a production interface, and it would have shipped into
  `AiClient`'s shape for every consumer. Replaced with the honest version — `PromptBuilder` is
  pure, so the step definition compiles the same vars itself and asserts against that, while
  the stub's *return value* carries the "call still proceeded" half. No production API grew a
  test hook.
- **Scanning the whole compiled message for injection patterns.** The obvious reading of
  "match the bound user content" is to scan the compiled user message. Rewrote it to scan the
  bound *values* only, after noticing my own prompt templates say "system prompt" out loud in
  their instructions — every single call would have logged
  `SECURITY_PROMPT_INJECTION_SUSPECTED` against itself. An alarm that fires on every request
  is an alarm nobody reads.
- **`toLocaleLowerCase('tr')` in `detectLanguage`.** Looked correct for a Turkish-aware
  detector. It maps `I` → `ı`, which deletes the English stop-word `i` from every English
  answer that opens a sentence with "I" — actively worsening the thing the function exists to
  decide. Plain `toLowerCase()`, with a comment naming the trap.
- **A `detectLanguage` that only knew `en`/`tr`.** The spec's "non-Latin script ratio > 0.6 ⇒
  that script's language" rule is meaningless without a script→language map, and both MVP
  languages are Latin. Kept a deliberately small eight-entry map so the rule means something,
  rather than writing a branch that could never fire.
