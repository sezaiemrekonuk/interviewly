---
task: I02
author: Sezai
sessions: [2026-07-31]
model: claude-opus-5
model_recommended: claude-opus-4.8
iterations: 2
tools: [cucumber-js, vitest, tsc, eslint]
---

## Session 1 — 2026-07-31

### What I asked for / what came back

Ran `.agents/EXECUTE.md` cold. § 4 handed me I02 (I01 `done`, nothing of mine
`in_progress`). The first run ended immediately on § 5: `MODELS.md` says I02 is
`claude-opus-4.8` and the session was on Sonnet 5, so it printed
`TIER I02 needs claude-opus-4.8, running claude-sonnet-5` and stopped rather than proceeding
and noting it in the devlog. Relaunched on Opus and continued.

**On `model` vs `model_recommended`:** these differ and I have not aligned them. The tier
matches — `MODELS.md` asks for opus-tier and the run was opus-tier, which is what § 5 gates
on — but `claude-opus-4.8` is not the model that exists in this harness; Opus 5 is. Every
opus-tier row in this repo will have the same mismatch until someone re-runs the model
assignment. That is a `MODELS.md` refresh, not a per-task fudge, so the frontmatter records
what actually ran.

### Methodology trace

ATDD, in the order IDEA.md §5.3 requires:

```
ai spec AC-6/7/8/9/10
  → .agents/features/ai_provider.feature (already authored in Stage 2)
  → appended to cucumber.js `paths`, run FIRST
  → red: 11 scenarios (11 undefined), 70 steps (59 undefined, 11 skipped)
  → cost.ts, providers.ts, live-client.ts, resolve-client.ts, prompt-vars.ts,
    backend/modules/ai/index.ts, boot gate, step definitions
  → green: 11 scenarios (11 passed), 70 steps (70 passed)
```

The suite going green on the first implementation run made me distrust it, so I mutated
`runChain` — `const fellBackFrom = i === 0 ? null : chain[i - 1].model` forced to `null` —
and re-ran: 4 scenarios red, with the failure landing exactly on
`the second llm_calls row has attempt_no 2 and fell_back_from set`. Restored from a copy and
confirmed 11 green again. That is the second iteration: a test-of-the-test rather than a
fix, but it is the one that made the first green mean something.

Unit tests cover what the acceptance fake structurally cannot: a transport that honours
neither the abort nor anything else (the `Promise.race` is what bounds it), an empty chain,
six-decimal cost rounding, `null` vs `0`, and that a schema-failure message never carries the
offending body.

### Friction

**Three places where the ledger, the spec and the shipped code disagreed.** None was in the
task file's list of things that might go wrong, and each one cost more thought than the code
it guarded:

1. **`llm_calls.cost_usd` is NOT NULL** in F02's `schema.prisma` while AC-8 wants `null` for
   an unpriced model. Widening a column is F02's scope under the migration protocol, so I
   could not fix it and could not ignore it. Resolved by making the *package* contract
   `number | null` (which is what the acceptance suite asserts), storing `?? 0` at the Prisma
   boundary with the reason written at the call site, and filing it as an open blocker for
   Fatih. ADR-I20.
2. **`model-prices.yaml` said `unit_kind: tokens`; the db enum is `token`.** That value is
   copied straight onto the row, so it would have thrown on the first real insert — and
   nothing would have caught it, because no acceptance step writes to Postgres. The price
   file is this ledger's own config, so I changed the values to the enum verbatim rather than
   adding a mapping table that could only drift.
3. **`.env.example` shipped `AI_ENABLED=true` with empty keys.** My own boot gate would have
   made a fresh clone refuse to start — the exact failure IDEA.md §10 calls unacceptable.
   Flipped the example to `false` with the reason inline.

**Cucumber has one world constructor and one step registry.** `ai_provider.feature` and
`security.feature` both say `the HR round is generated`, and I01's hand-off note had
anticipated a second World for later tasks. There is no such thing: a second
`setWorldConstructor` silently replaces the first, and a second definition of a shared step
makes *both* files ambiguous under `strict: true`. Found it by reading `world.ts` before
writing rather than after, which is the only reason it cost minutes instead of a debugging
session.

### What I rejected and rewrote by hand

- **The two provider SDKs.** The task file says "the openai + gemini clients (SDKs kept
  internal to this file)" and I started to `npm i` them. Stopped: each provider is one JSON
  POST, `fetch` is native, and the non-negotiable being protected ("no provider SDK outside
  `packages/ai/`") is satisfied more completely by importing none at all — in a repo whose
  `audit` job already carries an unfixable high advisory, two more dependency trees are a
  cost with no return. Hand-wrote both transports plus their response types. ADR-I18.
- **`recordLlmCall` as a plain insert.** The task file says to write it that way so I08 can
  wrap it in a transaction. F02 had already shipped a better version — insert and
  `spent_usd` increment in one transaction, returning `exhausted` — which is precisely what
  I08 needs. Rewriting it to the task file's sketch would have deleted working code to
  satisfy a note written before F02 landed. Added an optional `tx` parameter instead: six
  lines, and I08 can still wrap it.
- **The stub audit row in `backend/modules/ai/index.ts`,** where I01's hand-off put it. The
  `recordLlmCall` writer is injected, so the wrapper does not need Prisma and belongs in
  `resolve-client.ts` beside the switch it decorates — otherwise `worker` re-implements
  stub-mode auditing to get the same rows. ADR-I21.
- **`Then('a {string} event is emitted')` as a cucumber expression.** Written, then deleted:
  it would have been ambiguous against both the existing `…is emitted (once|not at all)`
  regex and the `…is not emitted` variant AC-7 needs. Replaced with one regex,
  `/^an? "([^"]+)" event is (emitted|not emitted)$/`, which also covers the `an
  "AI_DISABLED_STUB_MODE"` phrasing in AC-9 that a `{string}` expression would have missed.
- **Validating the whole chain's keys at boot,** which is what I01's hand-off recommended.
  Wrote it, then read AC-10's example table: it boots successfully with only the openai key
  set. The feature file is the contract, and the two failures are genuinely different — no
  tier-1 key means no interview ever runs, no tier-2 key means the retry is gone. Downgraded
  tier-2 to a boot warning. ADR-I19.
- **Blocking the task.** § 9 exists and `cost_usd` was a real conflict with another person's
  file. I did not use it: none of I02's five deliverables depend on the widening, the chain
  is verified never to invent a price, and stalling a seat over a column that no shipped
  model can currently reach would have been the expensive kind of correctness.
