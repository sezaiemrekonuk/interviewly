# AI_DEVLOG — how Interviewly was built with AI

Required deliverable (IDEA.md §13). Covers: which AI tools we used and why, the software
development methodologies we followed and how, what was hard and how we solved it, and the
skills/MCPs in the loop.

**This file is compiled, not journalled.** The raw material is one devlog file per task in
`.agents/devlogs/`, written in the session that did the work by the person who did it.
Nothing here is reconstructed from memory. See `.agents/EXECUTE.md` § Devlog for the
contract.

Team: Sezai, Ahmet, Fatih — three AI-native generalists, one owner per ledger.

---

## 1. Tooling

*What we used, and the reasoning. Written once, revised when the answer changes.*

| Tool | Where it ran | Why |
|---|---|---|
| | | |

Model tiering is recorded per ledger in `.agents/ledgers/<slug>/MODELS.md`, and the
*actual* model per task in that task's devlog frontmatter. Where the two disagree, the
devlog prose says why we switched — those disagreements are the interesting part.

## 2. Methodology

*Spec-Driven Development and ATDD, as actually practised — not as aspired to.*

The chain is `IDEA.md` → spec → Gherkin → ledger task → code, one stage per session
(`.agents/prompts/AUTHOR_DOCS.md`). The rule that made it work: a stage that finds itself
*deciding* something stops and records an open question instead of inventing a
requirement.

ATDD ordering, enforced per task: acceptance criterion → Gherkin → **run it red** →
step definitions + implementation → green → refactor. A verification command that passes
before any code was written means the test is wrong.

*Fill in: where this held, where it didn't, and what it cost.*

## 3. Session log

*Regenerated from `.agents/devlogs/*.md` frontmatter when a ledger goes green. Do not
hand-edit rows.*

<!-- BEGIN GENERATED: session-table -->
| Task | Author | Model used | Recommended | Iterations | Devlog |
|---|---|---|---|---|---|
| — | — | — | — | — | *no tasks complete yet* |
<!-- END GENERATED: session-table -->

## 4. Per-ledger narrative

*One subsection per ledger, written when that ledger goes green, from its tasks' devlogs.*

*Order follows the scope bands of IDEA.md §12, not the order they were merged.*

### foundations
### auth
### interview-core
### report
### admin
### voice
### adaptive

## 5. What was hard

*The genuine friction, with the fix. Harvested from the `## Friction` sections. Not a
list of typos — the things that cost hours.*

## 6. What we rejected

*Generated code we threw away or rewrote by hand, and why. Harvested from the
`## What I rejected and rewrote by hand` sections. This is the section that shows the
code is owned rather than accepted.*

## 7. Quality evaluation

*`npm run eval` output — the manual LLM-as-judge script (IDEA.md §5.5), run against real
models before the demo. Paste the run verbatim, with the date and the model set.*

```
(not run yet)
```
