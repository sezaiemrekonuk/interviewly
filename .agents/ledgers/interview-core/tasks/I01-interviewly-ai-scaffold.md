# I01 — `@interviewly/ai` scaffold: `AiClient` seam, schemas, prompt registry, `PromptBuilder`, `StubAiClient`
REPO: (this repo) · Depends: F01, F02, F03 · Status: todo
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
- [ ] **1. Confirm the empty package entry** — `packages/ai/package.json` exists (F03). If
  not, set this task `blocked` in STATE.md and stop. Add `zod`, `yaml`, and `build`/`test`
  scripts; wire `tsconfig` to emit `dist/`.
- [ ] **2. Confirm F01 codes** — `AI_OUTPUT_INVALID`, `AI_PROMPT_BUILD_FAILED` in the
  registry; add any missing one as a registry edit.
- [ ] **3. Write `schemas.ts`** — the five schemas above, each exported with its inferred
  type. Unit-assert a valid and an invalid sample per schema.
- [ ] **4. Write the four `*.prompt.yaml` files** — distinct permanent `uuid`s, `version: 1`,
  labelled user blocks with `{{var}}` slots.
- [ ] **5. Write `registry.ts`** — glob-load, key by `(name, version)`, `resolve()`, throw on
  duplicate `uuid`.
- [ ] **6. Write `config/model-prices.yaml` + `config/injection-patterns.yaml`** and their
  loaders.
- [ ] **7. Write `prompt-builder.ts`** — the six-step pipeline. Emit `LISTING_TRUNCATED` and
  `SECURITY_PROMPT_INJECTION_SUSPECTED` through the injected logger; throw
  `AI_PROMPT_BUILD_FAILED` on an unbound var. Guarantee the system message equals the
  template byte-for-byte.
- [ ] **8. Write `detect-language.ts`** — the no-LLM heuristic; commit the `en`/`tr`
  stop-word lists.
- [ ] **9. Write `stub.ts`** — `StubAiClient`, canned schema-valid content honouring `count`.
- [ ] **10. Write `index.ts`** re-exports; `npm run -w @interviewly/ai build` succeeds.
- [ ] **11. Wire the acceptance step-defs** for `security.feature` to call `PromptBuilder`
  **directly** (the §5.5 seam with no fake) with a listing containing angle brackets and an
  injection phrase, asserting neutralisation, an untouched system prompt, a truncation log
  at the boundary, and a non-blocking injection log.
- [ ] **12. Run the `## Verification` command.**

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
_(fill in when the task is done: what landed, files changed, what the next task must know)_
