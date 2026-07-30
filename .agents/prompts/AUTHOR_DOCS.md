# Authoring prompt — specs, features, ledgers

The chain from `IDEA.md` to executable task files has three stages. Each stage has a
pasteable prompt below. Run one stage per session, one area per session.

```
.agents/docs/IDEA.md              the reference. Never rewritten by these prompts.
.agents/docs/USER_STORIES.md      user-facing flows. Superseded by IDEA.md §15.2 where they conflict.
   ↓  Stage 1
.agents/specs/YYYY-MM-DD-<area>.md      one per area, ends with Acceptance Criteria
   ↓  Stage 2
.agents/features/<area>.feature         criteria as Gherkin — the single source of truth
   ↓  Stage 3
.agents/ledgers/<slug>/                 PLAN, DECISIONS, STATE, REFERENCE, MODELS,
                                        EXECUTION_PROMPT, tasks/
   ↓
code + tests                            see EXECUTE.md
```

**Stage 1 and Stage 2 write no code.** Stage 3 writes no code either. Code happens in
`EXECUTE.md`.

---

## Area registry

One spec per area. Own the sections listed; do not re-decide anything IDEA.md settled.
Overlap column names the neighbour you must not contradict.

| Area | Spec file | IDEA.md sections it owns | Overlaps with |
|---|---|---|---|
| `db` | `YYYY-MM-DD-db.md` | K13, §5.2 migration protocol, §8.1 indexes | every area |
| `backend` | `YYYY-MM-DD-backend.md` | K1, K2, K5, K8, K8.5, K10, §7.2, §7.3, §8.3 | `db`, `ai` |
| `ai` | `YYYY-MM-DD-ai.md` | K9, K15, §3.3, §3.4, §3.7, §7.1, §9 | `backend` |
| `frontend` | `YYYY-MM-DD-frontend.md` | K11, §3.8, §3.9, §4.3, §4.5 | `ui`, `backend` |
| `ui` | `YYYY-MM-DD-ui.md` | §4.1, §4.2, §4.4, §3.6 avatar states | `frontend` |
| `infra` | `YYYY-MM-DD-infra.md` | K6, K12, K14, §9.3, §10, §11 | all |
| `voice` | `YYYY-MM-DD-voice.md` | K3, §3.2, §3.5, §3.6 drivers | `backend`, `frontend` |

`voice` is authored after the MVP areas — it is the second scope band (§12). Write it
last; do not let it block anything.

---

## Stage 1 — Write one spec

### Prompt (copy from here down, replace `<AREA>`)

You are authoring the **`<AREA>` spec** for Interviewly. Output exactly one file:
`.agents/specs/YYYY-MM-DD-<AREA>.md`, dated today. You write no code and touch no other
file.

**Read first, in this order:**

1. `.agents/docs/IDEA.md` — in full. This is the reference document. Every decision in it
   is settled; your job is to make it *implementable*, not to revisit it.
2. `.agents/docs/USER_STORIES.md` — the user-facing flows. **IDEA.md §15.2 rules on every
   conflict between the two.** Where §15.2 marks a story superseded, the story is wrong;
   do not spec it.
3. `.github/copilot-instructions.md` — repo layout and conventions.
4. Any spec already in `.agents/specs/` whose area appears in your Overlaps row.

**The rule that makes this work:** if you find yourself deciding something, stop. Either
IDEA.md already decided it (find the section, cite it) or it is a genuinely new fork —
in which case add it to `## Open questions` at the bottom of your spec and keep going.
Do not invent requirements. An invented requirement becomes a Gherkin scenario, becomes a
task, becomes shipped code nobody asked for.

**Hard constraints that apply to every area:**

- Everything authored is **English** — headings, prose, identifiers, scenario names.
- **The API never returns display strings.** It returns stable codes from the shared
  error-code registry (IDEA.md §4.5). Every failure you spec names its code in
  `SCREAMING_SNAKE_CASE`. If the code does not exist yet, define it in your spec's error
  table; F01 owns the registry file and will collect them.
- **No environment-conditional business logic** (§11.3). Configuration may be env-driven;
  behaviour may not.
- Every external call has a timeout, a retry policy and a bounded wait (§8.3).
- Every log line you specify is `logger.<level>({structured}, "EVENT_NAME")` with both
  `traceId` and `interviewId` (K6). Free-form sentences are banned.
- No secrets, PII, tokens or PDF content in any log line, error body or test fixture.

**Spec skeleton — follow it:**

```markdown
# <Area> — spec

**Date:** YYYY-MM-DD
**Status:** draft | approved
**Derives from:** IDEA.md §… , K…
**Supersedes:** — (or the spec this replaces)

## Scope

What this spec covers, in 3–5 sentences. Then a bulleted **Not in this spec** list
naming the area that owns each excluded thing.

## Contracts

The concrete surface: endpoints, module interfaces, event names, table columns,
component props — whatever this area exposes to a neighbour. Request shape, response
shape, error codes. This is the section a neighbouring area reads instead of asking you.

## Behaviour

The rules, stated so two implementers produce the same thing. Numbers, not adjectives:
"hard-truncated to 12 000 characters", never "reasonably limited". State machines get a
transition table. Anything with an ordering gets the ordering.

## Failure modes

| Condition | Code | HTTP | Recovery |
|---|---|---|---|

Every row is a scenario candidate in Stage 2.

## Observability

The log events this area emits, and what an admin searches by to debug it.

## Security

The trust boundary this area sits on, and what crosses it. Delete if genuinely none —
but read §7 before deciding that.

## Open questions

Forks IDEA.md did not settle. Each one names who decides and what it blocks. This
section must be empty before the spec is marked `approved`.

## Acceptance criteria

Numbered, testable, each one phrased as an observable outcome. Every criterion becomes
at least one Gherkin scenario in Stage 2. A criterion that cannot be phrased as a
command or an observation is not a criterion — rewrite it until it is.
```

**Before you finish, self-review:**

- [ ] Every claim traceable to an IDEA.md section, or listed in `## Open questions`.
- [ ] No requirement present in the spec but absent from IDEA.md and from Open questions.
- [ ] Every failure row has a code; no code is a display string.
- [ ] Every acceptance criterion is observable from outside the code.
- [ ] Nothing in `## Contracts` contradicts a spec in your Overlaps row — you read them.
- [ ] No `TBD`. Unknowns go in `## Open questions`, named, with an owner.

Then stop. Report the file path and the Open questions list. Do not write feature files
in the same session.

---

## Stage 2 — Turn acceptance criteria into Gherkin

### Prompt (copy from here down, replace `<AREA>`)

You are converting the acceptance criteria of `.agents/specs/YYYY-MM-DD-<AREA>.md` into
Gherkin. Output goes to `.agents/features/`. You write no step definitions and no
production code.

**Read first:** the spec, then IDEA.md §5.3, §5.4 and §5.5. §5.4 holds worked examples in
the exact register expected — match it.

**The driver determines what you may write.** Cucumber drives the **HTTP API** with a live
Postgres and Redis and a **stubbed AI module**. Not a browser. Therefore:

- A scenario asserts on **status codes, error codes and API state**. Never on copy — a
  scenario asserting English text fails under a Turkish locale and asserts something the
  API never returns (§4.5).
- A scenario must be runnable against `curl`-level affordances. "The user clicks the
  submit button" is not a step; "I submit an answer for question 3" is.
- Anything only observable in a browser is **out of the acceptance ring**. Note it in the
  spec's Backlog wording; a handful of Playwright smokes may exist, they are not the
  source of truth.
- LLM behaviour is stubbed. A scenario phrased "then a good question is generated" is
  green whether or not the code works — it asserts the stub. Assert **structure**: how
  many rows, what order, which prompt name was recorded, which payload was sent.

**Test seams available** (IDEA.md §5.5) — a scenario needing a seam not on this list is a
scenario you cannot write; say so instead of writing it:

| Seam | Fake | Use for |
|---|---|---|
| `AiClient` | `StubAiClient`, canned schema-valid responses | most scenarios |
| `VoiceSession` | `FakeVoiceSession`, can be told to fail | voice fallback |
| `PromptBuilder` | none — asserted directly | prompt-injection defence |
| `Clock` | fixed | budget and timeout scenarios |

**File rules:**

- One file per behaviour cluster, not one per spec: `interview_flow.feature`,
  `question_generation.feature`, `admin_auth.feature`. Existing names in IDEA.md §5.4 are
  reserved — extend those files rather than creating a near-duplicate.
- `Feature:` line is the capability, not the area. Scenario names are outcomes, not steps.
- Prefer `Scenario Outline` with an `Examples` table over three near-identical scenarios.
- **Every scenario carries its negative case.** A scenario that only proves the happy path
  does not prove the change caused the outcome.
- Tag with `@<area>` and, where the mapping matters, `@AC-<n>` pointing at the numbered
  criterion.

**Coverage check before you finish:** every numbered acceptance criterion in the spec maps
to at least one scenario, and every scenario maps back to a criterion. Print the mapping
table in your report. An unmapped scenario is scope you invented; an unmapped criterion is
a hole.

Then stop.

---

## Stage 3 — Decompose into a ledger

Ledgers are **not** written by a prompt in this file. Use the `plan-initiative` skill —
it interrogates, decides, gets approval, and writes the folder. This section only records
the repo-specific overrides the skill does not know.

### Overrides

- **Path:** `.agents/ledgers/<slug>/`, not `.<slug>/` at the repo root.
- **Input:** the ask is the approved spec plus its feature files, not a chat description.
  Point the skill at them in Phase 1 so it does not re-interrogate settled decisions.
- **A ledger is a vertical slice** (IDEA.md §5.2): schema → API → UI → tests → criteria
  green. "Backend of feature X" is not a ledger. "Feature X, working" is.
- **Team model — put this in the skill's Phase 1 input.** Three AI-native generalists
  (Sezai, Ahmet, Fatih), no service owner. The parallel unit is the **ledger, not the
  task**: decompose so one person can own a ledger end to end. Tasks are fine-grained —
  one session each (read STATE → one task → verify → commit → stop) — and each declares
  its dependencies, so the slice reads as one ordered chain, **not** backend/frontend/db
  carved up across three people. Independence lives *between* ledgers; `F01`–`F03` are the
  only tasks built independent *within* a scope so three people start day one.
- **Decompose one-by-one, never in bulk.** Each task is the smallest thing that ends with
  one runnable `## Verification`. Never fold two behaviours into one task to "save a
  session," and never emit a placeholder task to fill later — an unwritten task is not a
  claim, it is a hole someone else falls into. When two tasks in the same ledger genuinely
  have no dependency between them, say so on both so either order is safe; otherwise they
  are a chain with a single owner. A dependency that crosses into *another* ledger is a
  scheduling fact — record it in `STATE.md` so the waiting ledger blocks on a green task,
  never on someone's half-done branch.
- **`## Verification` on every task runs the feature file.** The literal command, e.g.
  `npm run test:acceptance -- --tags @interview-flow`. Not "confirm the flow works".

### ID registry — claim before you write

Task prefixes and ADR prefixes must be unique across every ledger in the repo. Append your
row here in the same commit that creates the ledger folder.

| Ledger slug | Task prefix | ADR prefix | Scope band (§12) | Status |
|---|---|---|---|---|
| `foundations` | `F` | `ADR-F` | blocks everything | written |
| `auth` | `A` | `ADR-A` | MVP | written |
| `interview-core` | `I` | `ADR-I` | MVP | unclaimed |
| `report` | `R` | `ADR-R` | MVP | unclaimed |
| `admin` | `N` | `ADR-N` | MVP | unclaimed |
| `voice` | `V` | `ADR-V` | differentiation | unclaimed |
| `adaptive` | `D` | `ADR-D` | bonus | unclaimed |

IDEA.md §5.2 names the three foundations tasks `F-a`, `F-b`, `F-c`. In the ledger they are
`F01`, `F02`, `F03` in that order — the skill's IDs are zero-padded numerals. Record the
mapping in the foundations `PLAN.md` so §5.2 stays readable.

`foundations` is written first and its three tasks must be genuinely independent — three
people start them the same day. If your decomposition makes F02 depend on F01, the
decomposition is wrong, not the plan.

### The one thing that will bite

`schema.prisma` is a single file. **The entire schema lands in `F02`**, including tables no
feature ledger has reached. Feature ledgers may add **indexes and nullable columns only**,
each in its own migration, rebased before merge. Any structural change is a change to
F02's scope and gets discussed, not merged. Every ledger you write must state this in its
PLAN.md `Out of scope` section — it is the week-one collision that breaks
`docker compose up` on a fresh clone, which §10 calls the one unacceptable failure.
