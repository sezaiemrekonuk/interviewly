# I01 — `@interviewly/ai` scaffold: `AiClient` seam, schemas, prompt registry, `PromptBuilder`, `StubAiClient`
REPO: (this repo) · Depends: F01, F02, F03 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — this file *is* the prompt-injection trust boundary (§7.1) and the Zod schema contract every downstream caller trusts. A subtly weak `PromptBuilder` (role-mix, missed neutralisation, off-by-one truncation) is the exact regression the spec forbids, and it is invisible to a stubbed test unless the builder is asserted directly.

## Goal
Owner's ask:

> "The `@interviewly/ai` package: the single `AiClient` seam, the output Zod schemas, the
> versioned prompt registry, the `PromptBuilder` that is the prompt-injection boundary, and
> the `StubAiClient` fake. `worker` and the report ledger import this. Fill the empty
> package F03 wired."
> — interview-core ledger decomposition (K1, §5.5, §7.1)

This task fills the `packages/ai/` workspace entry F03 created. It defines the `AiClient`
interface (all five methods), the Zod output schemas, the `*.prompt.yaml` registry loader,
the config loaders (`model-prices.yaml`, `injection-patterns.yaml`), the `PromptBuilder`,
the no-LLM `detectLanguage` heuristic, and `StubAiClient`. It does **not** call a real
provider — I02 wires openai/gemini, cost and per-attempt `llm_calls` behind this interface.

## Security boundaries
- **User content never enters the system message.** Job listing, transcript and candidate
  profile appear only inside a labelled block in a *user* message (§7.1 role separation).
  The system message is byte-identical to the prompt-file template on every call.
- **Neutralise before embedding.** Inside every user block, `<` → `&lt;` and `>` → `&gt;`
  before insertion. `security.feature` @AC-3 asserts the angle brackets are neutralised and
  the system prompt is untouched.
- **Truncate hard.** Each user block is cut to 12 000 characters; a cut logs
  `LISTING_TRUNCATED`. No unbounded attacker text reaches the model.
- **An injection match logs, it does not block** (§7.1.5). A pattern hit from
  `injection-patterns.yaml` logs `SECURITY_PROMPT_INJECTION_SUSPECTED` and the call
  proceeds; the Zod schema is the real barrier. Blocking would kill legitimate interviews.
- **Every `AiClient` method returns a Zod-validated value or throws.** No raw provider text
  escapes the package. An unbound `{{var}}` is `AI_PROMPT_BUILD_FAILED`, never a silent gap.

## Non-negotiables
- **One seam.** `AiClient` is the only export a caller uses for AI work. No module outside
  this package imports a provider SDK (I02 keeps SDKs internal).
- **`prompt_uuid` is permanent.** A prompt file's `uuid` is never reused or edited; a new
  version is a new file with a new `version` and the *same* lineage `name`. The registry
  keys on `(name, version)` and exposes the `uuid`.
- **`StubAiClient` is schema-valid.** Every stub method returns content that passes its own
  Zod schema unchanged, so any scenario not asserting the provider chain runs against it.
- **`detectLanguage` makes no LLM call.** It is a pure function over `{ en, tr }` stop-word
  lists and a script-ratio test (ADR-I09). No network, no `llm_calls` row.

## Context (anchors)
- `packages/ai/package.json` — F03 created the empty entry (`name: "@interviewly/ai"`,
  `main`/`types` pointing at `dist/`). Add deps: `zod`, `yaml`. Add `build` (tsc) and
  `test` scripts. The root `package.json` `workspaces` array already includes `packages/*`.
- `packages/ai/src/AiClient.ts` — **create.** The interface:
  ```ts
  export interface AiCtx { interviewId: string; traceId: string; }
  export interface AiClient {
    generateRoundQuestions(a: { round: 'hr' | 'tech'; count: number; ctx: AiCtx;
      listing: string; profile: string | null; }): Promise<QuestionBatch>;
    generateReport(a: { interview: ReportInput; ctx: AiCtx }): Promise<ReportPayload>;
    scoreAnswer(a: { question: QuestionInput; answer: string; ctx: AiCtx }): Promise<Scores>;
    generateCandidates(a: { slot: SlotInput; ctx: AiCtx }): Promise<Candidate[]>;
    detectLanguage(text: string, current: string): { language: string; ambiguous: boolean };
  }
  ```
  `scoreAnswer`/`generateCandidates` are the K4 hook the `adaptive` ledger consumes —
  define the interface + stub here; real execution is I02, selection is adaptive's.
- `packages/ai/src/schemas.ts` — **create.** Zod schemas, all exported with inferred types:
  - `Question` — `{ text: string; kind: 'open'|'behavioral'|'technical'|'widget';
    difficulty: 'easy'|'medium'|'hard'; topic: string }`.
  - `QuestionBatch` — `z.array(Question)`; the *caller* asserts `length === count` (a
    length mismatch is `AI_OUTPUT_INVALID`, per `question_generation.feature` @AC-1).
  - `Candidate` — a `Question` plus `chosenReason?` metadata for K4.
  - `Scores` — `{ overall: int 0..5; perQuestion: { questionId: string; score: int 0..5;
    reason: string; starAdherence: number 0..1 }[] }`.
  - `ReportPayload` — K15 shape: `{ overallScore: int 0..5; summary: string;
    strengths: string[] (2..5); improvements: string[] (2..5);
    rounds: { type: 'hr'|'tech'; score: int 0..5 }[];
    questions: { questionId: string; score: int 0..5; reason: string;
    starAdherence: number 0..1 }[] }`.
- `packages/ai/prompts/*.prompt.yaml` — **create four** (one version each): `uuid`, `name`,
  `version: 1`, `provider`, `model`, `params`, `messages` (`system` + `user` templates with
  `{{var}}` slots and labelled blocks like `<candidate_profile>{{profile}}</candidate_profile>`).
  Names: `interview.question.generate` (`openai/gpt-4.1-mini`), `interview.report.generate`,
  `interview.answer.score`, `interview.question.candidates`.
- `packages/ai/src/registry.ts` — **create.** Loads every `prompts/*.prompt.yaml`, keys by
  `(name, version)`, exposes `resolve(name, version?)` (latest version if omitted) returning
  `{ uuid, name, version, provider, model, params, messages }`. Duplicate `uuid` across
  files → throw at load.
- `packages/ai/config/model-prices.yaml` — **create.** `(provider, model) → { input, output }`
  price per unit. A missing row is not an error (I02 records `cost_usd = null`).
- `packages/ai/config/injection-patterns.yaml` — **create.** A small list of case-insensitive
  patterns (e.g. `ignore (all )?previous instructions`, `system prompt`, `you are now`).
- `packages/ai/src/prompt-builder.ts` — **create.** `buildMessages({ promptName, version,
  vars })`: (1) resolve template; (2) for each user-block var — neutralise `<>`, truncate to
  12 000 chars logging `LISTING_TRUNCATED`, a null profile → literal `no profile provided`;
  (3) bind `{{var}}` from an allow-list, unbound → `AI_PROMPT_BUILD_FAILED`; (4) scan bound
  user content against `injection-patterns.yaml`, a hit logs
  `SECURITY_PROMPT_INJECTION_SUSPECTED` (non-blocking); (5) return
  `{ system, messages, promptUuid, promptVersion, provider, model, params }`. The system
  message equals the template verbatim.
- `packages/ai/src/detect-language.ts` — **create.** `detectLanguage(text, current)`:
  non-Latin script-char ratio > 0.6 → that script's language; else stop-word hit ratio over
  the `{ en, tr }` lists — the max-ratio language if ≥ 0.15, else `{ language: current,
  ambiguous: true }`.
- `packages/ai/src/stub.ts` — **create.** `StubAiClient implements AiClient`: canned
  schema-valid returns for all four LLM methods (respecting the requested `count`), and the
  real `detectLanguage`. `generateRoundQuestions` returns exactly `count` typed questions.
- `packages/ai/src/index.ts` — **create.** Re-export `AiClient`, schemas, `PromptBuilder`,
  `StubAiClient`, `detectLanguage`, `registry`.
- `backend/src/lib/error-codes.ts` — F01 registry. Confirm/add `AI_OUTPUT_INVALID`,
  `AI_PROMPT_BUILD_FAILED`. The package throws typed errors carrying these codes.
- `backend/src/lib/logger.ts` — F03 pino factory; the builder logs through it. The package
  takes a logger by injection (no direct import that couples `ai` to `backend`) — accept a
  minimal `{ info, warn }` logger param, defaulting to a no-op.

  **The trap:** `QuestionBatch` must not itself enforce `length === count` — the requested
  count is runtime data, not a schema constant. The *caller* (I04) compares
  `batch.length === count`; a mismatch is `AI_OUTPUT_INVALID`. If you bake the count into the
  schema you cannot reuse it for HR (3) and tech (5) from one definition.

## Steps
- [x] **1. Confirm the empty package entry** — `packages/ai/package.json` exists (F03). If
  not, set this task `blocked` in STATE.md and stop. Add `zod`, `yaml`, and `build`/`test`
  scripts; wire `tsconfig` to emit `dist/`.
- [x] **2. Confirm F01 codes** — `AI_OUTPUT_INVALID`, `AI_PROMPT_BUILD_FAILED` in the
  registry; add any missing one as a registry edit.
- [x] **3. Write `schemas.ts`** — the five schemas above, each exported with its inferred
  type. Unit-assert a valid and an invalid sample per schema.
- [x] **4. Write the four `*.prompt.yaml` files** — distinct permanent `uuid`s, `version: 1`,
  labelled user blocks with `{{var}}` slots.
- [x] **5. Write `registry.ts`** — glob-load, key by `(name, version)`, `resolve()`, throw on
  duplicate `uuid`.
- [x] **6. Write `config/model-prices.yaml` + `config/injection-patterns.yaml`** and their
  loaders.
- [x] **7. Write `prompt-builder.ts`** — the six-step pipeline. Emit `LISTING_TRUNCATED` and
  `SECURITY_PROMPT_INJECTION_SUSPECTED` through the injected logger; throw
  `AI_PROMPT_BUILD_FAILED` on an unbound var. Guarantee the system message equals the
  template byte-for-byte.
- [x] **8. Write `detect-language.ts`** — the no-LLM heuristic; commit the `en`/`tr`
  stop-word lists.
- [x] **9. Write `stub.ts`** — `StubAiClient`, canned schema-valid content honouring `count`.
- [x] **10. Write `index.ts`** re-exports; `npm run -w @interviewly/ai build` succeeds.
- [x] **11. Wire the acceptance step-defs** for `security.feature` to call `PromptBuilder`
  **directly** (the §5.5 seam with no fake) with a listing containing angle brackets and an
  injection phrase, asserting neutralisation, an untouched system prompt, a truncation log
  at the boundary, and a non-blocking injection log.
- [x] **12. Run the `## Verification` command.**

## Definition of done
- `AiClient` interface, five Zod schemas, four prompt files, registry, both config loaders,
  `PromptBuilder`, `detectLanguage`, `StubAiClient` all exist; the package builds.
- `PromptBuilder` role-separates, neutralises `<>`, truncates at 12 000 chars, marks a null
  profile `no profile provided`, throws `AI_PROMPT_BUILD_FAILED` on an unbound var, and logs
  (not blocks) an injection match.
- `security.feature` scenarios (@AC-3, @AC-4, @AC-5) pass against the builder directly.
- No provider SDK is imported anywhere in the package (that is I02, kept internal).

## Verification
```bash
npm run -w @interviewly/ai build && npm run test:acceptance -- --tags "@security"
```

## Notes

### What exists now

`packages/ai/` is a real workspace package (`main`/`types` → `src/index.ts`, `build` emits
`dist/` via its own `tsconfig.json`, `test` runs vitest). Everything is exported from
`src/index.ts`:

| File | Exports |
|---|---|
| `src/AiClient.ts` | `AiClient` (5 methods), the four `*Args` types, `TIMEOUT_MS` (15 s / 90 s, B6) |
| `src/schemas.ts` | `QuestionSchema`, `QuestionBatchSchema`, `CandidateSchema`, `ScoresSchema`, `ReportPayloadSchema` + inferred types |
| `src/registry.ts` | `PromptRegistry`, `loadPromptRegistry()`, `PROMPTS_DIR` |
| `src/prompt-builder.ts` | `PromptBuilder`, `createPromptBuilder({ logger })`, `MAX_BLOCK_CHARS` (12 000), `BuiltPrompt`, `AiCtx` |
| `src/config.ts` | `loadModelPrices()` → `ModelPrices.lookup(provider, model)`, `loadInjectionPatterns()` |
| `src/detect-language.ts` | `detectLanguage(text, current)`, `SCRIPT_MARGIN` 0.6, `STOPWORD_MARGIN` 0.15 |
| `src/stub.ts` | `StubAiClient` |
| `src/errors.ts` | `AiError` (carries an F01 code), `AiLogger`, `noopLogger` |

Four prompts at `packages/ai/prompts/*.prompt.yaml`, all `version: 1`, all
`openai/gpt-4.1-mini`. Config at `packages/ai/config/{model-prices,injection-patterns}.yaml`.

**F01 needed no edit** — `AI_OUTPUT_INVALID`, `AI_PROMPT_BUILD_FAILED`, `PRICE_MISSING`,
`LISTING_TRUNCATED`, `SECURITY_PROMPT_INJECTION_SUSPECTED` and `PROFILE_DOB_STRIPPED` were
all already in `backend/src/lib/error-codes.ts`.

### Deviations from this task file (all deliberate, all toward the spec)

1. **Schema field names are snake_case, not the camelCase this file sketched.**
   `.agents/specs/2026-07-29-ai.md` and the Stage-2 feature files are the authority:
   `schema_validation.feature` asserts `overall_score` and `questions[].star_adherence`
   literally. `ReportPayload` is also stored verbatim in `reports.payload`, so the JSON keys
   are a stored contract, not an internal style choice. The *call* interfaces in
   `AiClient.ts` stay camelCase like the rest of the TypeScript.
2. **`ReportPayload` is the spec's richer shape**, not this file's five-key sketch:
   `overall_impression`, `rounds[].summary`/`note` and `language` are present.
3. **`AiClient` method arguments follow the spec table**, which gained `candidateCv` and
   `language` in the 2026-07-30 revision — `{ roundType, count, jobListing, candidateProfile,
   candidateCv, language, priorTopics?, ctx }`, not `{ round, count, listing, profile, ctx }`.
4. **`QuestionBatch` is `{ questions: Question[] }`** (spec), not a bare array, and `Question`
   carries `orderIndex`.
5. **Duplicate-`uuid` rule is "one uuid, one *name*", not "one uuid, one file.** A uuid is
   stable across versions of one lineage (spec, prompt file format), so throwing on any
   repeat would make v2 of a prompt impossible. Two different lineages sharing a uuid throws;
   so does a duplicate `(name, version)`. See ADR-I01-b.
6. **Injection patterns are matched against the bound *values* only**, never the compiled
   message. The templates say "system prompt" in their own instructions, so scanning the
   whole message would log a false positive on every single call.

### The acceptance runner (new, and every later task depends on the shape)

**Read this before writing a `## Verification` that runs cucumber.**

- Root `cucumber.js` is the config. `npm run test:acceptance` at the repo root runs it
  directly — `backend`'s `test:acceptance` script is gone.
- `paths` is an **explicit allow-list**, currently `['.agents/features/security.feature']`.
  Feature files are read where Stage 2 authored them; there is no second copy under
  `backend/`. **Your task appends its own feature file to that array** when it wires the
  steps. A glob would make every unwired feature an undefined-step failure forever.
- Step definitions: `backend/features/step_definitions/**/*.ts`, loaded through `tsx/cjs`.
  `world.ts` holds `SecurityWorld` — log capture, the var bag, block extraction helpers.
  A later task that needs HTTP will want its own World; `SecurityWorld` is package-level only.
- `strict: true`, so an undefined, pending or ambiguous step fails the run.
- Cucumber-expression trap already hit once: `a {string} event is emitted {}` also matches
  `…is emitted with a patternId`, and cucumber calls that ambiguous. Both cardinality steps
  are regexes now.

### Both CI false greens are closed

- **`unit`** — root `npm test` = `vitest run` over the whole tree, no `--passWithNoTests`.
  `backend`'s `test:unit` script is deleted; the CI job runs `npm test`. 35 tests in
  `packages/ai/src/*.test.ts` are the first real ones.
- **`acceptance`** — `cucumber.js` + `backend/features/` now exist and the job runs 9 real
  scenarios. Seen red (9 failed / 2 ambiguous) before green.

Also: root `tsconfig.json` gained the `@interviewly/ai` path alias and `backend/features` in
`include`; `eslint.config.js` lints `backend/features/**/*.ts`; root `build` builds the ai
package. **`backend/tsconfig.json` does not exist**, so `npm run -w backend build` is broken
— pre-existing, not touched here, logged in STATE.md Backlog.

### For I02

- Implement `AiClient` for real behind the same interface. `PromptBuilder.build()` returns
  everything a provider call needs: `{ system, messages, promptName, promptUuid,
  promptVersion, provider, model, params }`. `system` is duplicated inside `messages` on
  purpose — OpenAI wants it as message[0], Gemini wants a separate `systemInstruction`.
- **`StubAiClient` writes no `llm_calls` row.** It cannot: that needs Prisma, and this
  package is shared by `api` and `worker` and depends on neither. The `cost_usd = 0` stub row
  and the `AI_DISABLED_STUB_MODE` log are **I02's**, in `backend/modules/ai/index.ts`.
- Cost: `loadModelPrices().lookup(provider, model)` returns `undefined` for a missing row —
  that is the normal path for `cost_usd = null` + `PRICE_MISSING`, not an error.
- Key validation (B7): `registry.providers()` returns every provider named by a loaded prompt
  file. Today that is `['openai']` only — tier-2 gemini is selected by the *chain*, not by a
  prompt file, so I02 must validate the chain's providers too, not just this list.
- The stub routes through the real builder deliberately. Keep that in the real client:
  `security.feature` @AC-5 only passes because generation crosses the trust boundary.

### For I04

- `batch.questions.length === count` is **your** check, not the schema's — a mismatch is
  `AI_OUTPUT_INVALID` (`question_generation.feature` @AC-1). The schema deliberately does not
  constrain length so one definition serves HR (3) and tech (5).
- Null markers are keyed by variable name in `prompt-builder.ts` (`NULL_MARKERS`):
  `candidateProfile` → `no profile provided`, `candidateCv` → `no cv provided`. Any *other*
  variable arriving null throws `AI_PROMPT_BUILD_FAILED` rather than compiling a gap.
- `candidateProfile` may be passed as an object; the builder JSON-stringifies it and strips
  `dateOfBirth`/`date_of_birth` recursively first, logging `PROFILE_DOB_STRIPPED`. That is
  defence in depth — **you still strip it upstream** (§3.3).
- `profiling.feature` and `question_generation.feature` are not in `cucumber.js` `paths` yet.
  Add them there when you wire their steps.

### For I10

`detectLanguage` is done and pure — no LLM, no network, no row. It classifies one text; the
two-consecutive-turn counting is yours. Below both margins it returns
`{ language: current, ambiguous: true }`, and an ambiguous turn must not count toward a
switch.

### Verification output

```
$ npm run -w @interviewly/ai build && npm run test:acceptance -- --tags "@security"
> tsc -p tsconfig.json
> cucumber-js --tags @security
...................................................
9 scenarios (9 passed)
51 steps (51 passed)
```

Gates: `npm run lint` clean, `npm run typecheck` clean, `npm test` 35 passed (3 files).
