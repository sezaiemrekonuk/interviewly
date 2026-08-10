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
### conductor

The ledger that exists because of a complaint no other ledger owned: *the interview feels
robotic*. Nothing was broken. interview-core progressed correctly, adaptive selected correctly,
speech spoke correctly — and the interviewer still had no turn of its own. It never greeted
anyone, never asked what someone meant, and could not decide a round was finished. Progression
was arithmetic: one answer, `current_index + 1`.

The design conversation is the part worth recording. The first instinct was to let the model
author every question live and delete the pre-generated batch. Three concrete dependencies
killed that: topic coverage is derived from the job listing and CV and *is* the product; the
#89 pause/resume repair regenerates a round and needs something to regenerate into; and ADR-I22
had already moved batch generation off the critical path so a handover is never a loading
screen. What shipped instead (ADR-C05) keeps the batch and changes what it holds — an `intent`
per slot saying what it is *for*, plus one askable sentence kept purely as the fallback for a
provider outage mid-round. The interviewer writes the real question from the intent.

The second decision worth recording is that the model is never the authority (ADR-C02). Its
action is derived from candidate text and it mutates interview state, so it is untrusted input
in the §7.1 sense — `injection-patterns.yaml` guards prompt *variables*, and nothing guarded
*actions*. Five guards are re-derived server-side on every turn, including a hard ceiling past
which the server advances without asking and writes a system row into the transcript saying so.
"End the interview now" is a sentence a candidate can type; the opening-turn refusal is what
makes typing it useless.

K4 survived. The instruction was to keep adaptive question generation, and there was a reading
that cost nothing: the conductor has the whole conversation, which beats three pre-generated
candidates, so D01–D03 stopped deciding *wording* and became the degradation path — still
scoring for the report, still supplying the next row's text when the conductor could not be
reached. Nothing was deleted.

## 5. What was hard

*The genuine friction, with the fix. Harvested from the `## Friction` sections. Not a
list of typos — the things that cost hours.*

**The opening turn had no question to advance past (C02).** Treating every interviewer reply as
"close this question, open the next" made the welcome consume question 1. The fix needed no
schema: *the first assistant message carrying a question's id is the asking of it*. When the row
is unasked, the turn writes the wording and does not advance, whatever action came back.

**An early handover asked the wrong questions (C02).** `currentQuestionRow` picks the round by
comparing `current_index` against `hr_question_count`. Handing over at question 3 of 5 left the
state saying `tech_round` while the index still pointed inside the HR block — so the *technical*
interviewer asked HR questions. The handover now jumps the index under the same compare-and-set.

**Truncation kept the wrong half of the conversation (C02).** The prompt builder trims an
over-long block with `slice(0, MAX_BLOCK_CHARS)`, which keeps the oldest text. For a listing
that is right; for a conversation it throws away the exchange the interviewer has to reply to.
Trimming moved into `conductor.ts`, from the front, marking the gap so the interviewer knows it
is missing the start.

**A query inside the budget lock (C02).** `withBudget` holds a `pg_advisory_xact_lock` for the
whole callback; resolving the remaining topics inside it sat on the interview's own lock.

## 6. What we rejected

*Generated code we threw away or rewrote by hand, and why. This is the section that shows the
code is owned rather than accepted.*

**The drift clamp, rewritten by hand (C02).** The first version rewrote `end_interview` and
`handover` into a forced advance whenever the per-question ceiling was spent. Drift exists to
stop an interviewer circling one question — applied to an action that already leaves the
question, it would have *resurrected an interview the interviewer had just ended*. There is now
a test named for exactly that.

**Conversation state in Redis (C01).** Rejected: the report is generated by a worker in another
process, possibly hours later, and Redis here holds only fan-out and rate-limit state. Losing
the key would lose the interview.

**Provider-native tool calling (C02).** ADR-I02 keeps every provider SDK out of this repo — both
transports are one hand-rolled `fetch`. Native tools would have to be built and kept in step
twice, in two wire formats, to buy a capability the call never needs.

**Deleting D01–D03 (C05).** The first plan cut the adaptive ledger once the conductor owned
question wording. Kept instead as the degradation path — see §4.

**Returning `chat_messages` rows verbatim (C01).** Leaked `trace_id`, which joins a K6 log line
to a row and has no business in a browser. Rewritten to map explicitly.

## 7. Quality evaluation

*`npm run eval` output — the manual LLM-as-judge script (IDEA.md §5.5), run against real
models before the demo. Paste the run verbatim, with the date and the model set.*

```
(not run yet)
```
