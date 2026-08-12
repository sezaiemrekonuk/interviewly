# AI_DEVLOG

How Interviewly was actually built. Three of us — Sezai, Ahmet, Fatih — in two weeks, 640 commits,
84 tasks, 139 recorded decisions.

Compiled, not written from memory: one devlog per task in
[`.agents/devlogs/`](.agents/devlogs/), written in the session that did the work, plus the ADRs in
[`.agents/ledgers/`](.agents/ledgers/). Everything below links to its source.

## The tools

**Copilot, in agent mode, for essentially all of the code.** Not as autocomplete — the unit of
work was a ledger task, and the model was expected to read the spec, write the failing test first,
and come back with a diff we could argue with.

No MCP servers: the useful ones duplicated the terminal. What earned its place was a set of
reusable prompt files in `.agents/skills/`, invoked by name — *brainstorming* (design conversation
before code), *test-driven-development* (red before green), *systematic-debugging* (reproduce,
hypothesise, kill the hypothesis, fix), *verification-before-completion* (no "done" without pasted
output). Checklists, basically; their value was consistency across three people.

**Model choice for the agent** was tiered by task: the strongest reasoning model for architecture,
prompt design and the interview state machine, a cheaper and faster one for renames, i18n sweeps
and scaffolding. Each devlog records both the recommended and the actual model — they disagree on
30 of 84 tasks, usually because the first pass showed the work was more mechanical than it looked.

**Model choice inside the product** is a separate argument:

| Call | Model | Why |
|---|---|---|
| questions, scoring, report, conductor turn | `gpt-4.1-mini` | The quality floor we needed at a price that lets an interview cost cents. Larger models wrote nicer prose and no better questions. |
| turn-complete gate, listing validation, title | `gpt-4.1-nano` | The gate runs on every pause in a conversation: latency is the requirement, the decision is binary. Language switching needs no model at all — a heuristic over two consecutive turns. |
| fallback tier | `gemini-2.5-flash` | A second vendor, so an OpenAI incident degrades an interview instead of ending it. |
| speech | `eleven_turbo_v2_5` / `scribe_v1` | ~3× faster than the multilingual model, indistinguishable to our ears in EN and TR. Settled by listening, not a benchmark ([ADR-L03](.agents/ledgers/speech-latency/DECISIONS.md), [L01](.agents/devlogs/L01-tts-model.md)). |

## How we worked

**Spec-driven, one direction, one stage per session.**
[`IDEA.md`](.agents/docs/IDEA.md) → [spec](.agents/specs/) → [Gherkin](.agents/features/) →
[ledger task](.agents/ledgers/) → code, under the contract in
[`AUTHOR_DOCS.md`](.agents/prompts/AUTHOR_DOCS.md). The rule that made it work: *a stage that
finds itself deciding something stops and records an open question instead of inventing a
requirement.* Half the value of the ledgers is the list of things a spec did not say.

**ATDD per task.** Acceptance criterion → scenario → run it red → implementation → green →
refactor. 24 feature files, Cucumber against a real Postgres and Redis. A verification command
that passed before any code existed meant the test was wrong, and we treated that as a defect.

**One owner per area**, assigned in [`EXECUTE.md`](.agents/EXECUTE.md) — task IDs carry the prefix.
Two people editing `schema.prisma` in the same week is the expensive way to learn that.

**Every task leaves an ADR and a devlog** with four fixed sections: what we asked for, the
methodology trace, the friction, what we rejected. The friction section is where this file comes
from. Iterations, from the frontmatter: 32 tasks landed in one pass, 26 took two, 13 three, 9 four
or more — the last group almost all conductor and turn-taking, exactly where the requirements were
ours to invent.

## What was hard

**The interviewer had no turn of its own**
([C05](.agents/devlogs/C05-agenda-shaped-batches.md)). Nothing was broken — questions generated,
answers scored, speech spoke — but progression was arithmetic, one answer and `current_index + 1`.
It never greeted anyone, never asked what you meant, could not decide a round was finished. The
fix was a whole ledger: the batch became an *agenda* of intents rather than a script, and the
interviewer writes the real question from the intent, keeping the pre-written sentence as the
outage fallback ([ADR-C05](.agents/ledgers/conductor/DECISIONS.md)).

**The opening turn had nothing to advance past**
([C02](.agents/devlogs/C02-conductor-turn-loop.md)). Treating every reply as "close this question,
open the next" made the welcome consume question 1. Fixed with no schema change: *the first
assistant message carrying a question's id is the asking of it.*

**An early handover asked the wrong questions** (same devlog). Handing over at question 3 of 5 left
the state saying `tech_round` while the index still pointed inside the HR block — so Turing asked
Ada's questions. The handover now jumps the index under the same compare-and-set.

**Truncation kept the wrong half of the conversation** (same devlog). `slice(0, MAX)` keeps the
oldest text: right for a job listing, wrong for a conversation, where it throws away the exchange
the interviewer has to reply to. It now trims from the front, with a marker.

**MinIO read `/assets` as the bucket name** ([F05](.agents/devlogs/F05-asset-serving.md)), 404'ing
every avatar, then 403'ing because nothing granted anonymous read. Fixed in the edge config and
the seed — and the obvious bucket-wide public-read policy was rejected, because candidate CVs live
in the same bucket.

## What we threw away

Because the code is owned, not accepted.

- **The drift clamp, rewritten by hand** ([C02](.agents/devlogs/C02-conductor-turn-loop.md)). The
  generated version forced an advance whenever the turn ceiling was spent — including on
  `end_interview`, which would have resurrected an interview that had just ended. There is now a
  test named for exactly that.
- **Conversation state in Redis** ([C01](.agents/devlogs/C01-conversation-persistence.md)). The
  report is generated by another process, hours later; losing the key would lose the interview.
- **Returning `chat_messages` verbatim** (same devlog). Leaked `trace_id`, which has no business
  in a browser.
- **Deleting the adaptive ledger** once the conductor owned question wording
  ([C05](.agents/devlogs/C05-agenda-shaped-batches.md)). Kept as the degradation path instead.
- **`docker compose run api npm run seed`**, an instruction that sat in our own docs for weeks
  ([F05](.agents/devlogs/F05-asset-serving.md)). The image is built `--omit=dev`, so no `tsx`.
  [SETUP.md](SETUP.md) has the path that works.

## Honest limits

Report quality was judged by reading them. There is no automated LLM-as-judge run in this repo,
and we would rather say so than paste numbers we did not produce.
