# L04 — The conductor's real prompt: measure first, then decide whether there is anything to do
REPO: (this repo) · Depends: C02 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — measurement first and possibly no change at all. The one hazard is
§7.1, and the builder enforces it mechanically: moving a candidate-influenced value into the
system block fails outright with `AI_PROMPT_BUILD_FAILED`.

## Goal
The baseline says the conductor takes 1 180 ms. **That number is wrong and known to be wrong** —
it was measured with a toy prompt. Production carries the persona brief, job listing, candidate
profile, CV and up to 7 000 characters of conversation, and time-to-first-token scales with input
length. The real figure is worse by an unmeasured amount, which means the whole baseline table
understates the total.

Find the real number. Then decide whether prompt-prefix caching is worth doing, or whether there
is nothing here.

## Non-negotiables
- **Measure before changing anything.** This task is allowed to conclude "no change needed" and
  that is a successful outcome, not a wasted session. What is not allowed is reordering a prompt
  on the theory that it will help.
- **§7.1 is not negotiable for a cache hit.** The system block has **zero** placeholders and the
  builder rejects otherwise. Prefix caching wants stable content first and volatile content last;
  every candidate-influenced value must nonetheless stay a bound value in the user block.
  Reordering *within* the user block is safe. Moving anything into the system block is not,
  whatever it does for the cache.
- **A reordered prompt is a changed prompt.** If the order moves, the prompt gets a new `version`
  in its filename and the registry picks it up — prompts are versioned, never edited in place.
  A behaviour check comes with it: the conductor must still clarify a vague answer and still
  refuse what `clampAction` refuses.
- **Warm medians, n≥5, warm-up discarded** (ADR-L01).
- **Record the corrected baseline** in REFERENCE.md whatever the outcome. That number is wrong in
  the table today and someone will plan against it.

## Context (anchors)
- `packages/ai/prompts/interview.conduct.turn.prompt.yaml` — the prompt. The header comment
  explains the model choice; `:63-66` carries the untrusted-data clause.
- `packages/ai/src/prompt-vars.ts:107` `conductVars` — what gets bound, and in what order.
- `packages/ai/src/prompt-vars.ts:126` `formatConversation` — the volatile block, and the biggest.
- `backend/modules/interview/conductor.ts:69-80` — `MAX_HISTORY_CHARS = 7_000`,
  `HISTORY_ROW_OVERHEAD = 17`, drop-oldest with an elision marker. The comment explains why
  trimming happens here rather than in the builder, and it is load-bearing.
- `packages/ai/src/AiClient.ts:34` — `TIMEOUT_MS.conductTurn = 10_000`, and the comment on why it
  is 10 s rather than 15 s: this is the call a candidate waits on with nothing on screen.
- `packages/ai/src/prompt-builder.ts` — the §7.1 enforcement that will stop you if you get this
  wrong.
- OpenAI prompt caching applies automatically above a token threshold and discounts cached input.
  Confirm the current threshold and discount against the provider's documentation rather than
  from memory before building a plan on it.

## Steps
- [ ] **1. Reconstruct a production-sized prompt.** Real persona brief, a real job listing, a real
  CV, and a conversation at the `MAX_HISTORY_CHARS` ceiling. Take it from a seeded interview
  rather than inventing one — an invented prompt measures an invented latency.
- [ ] **2. Measure it, warm.** n≥5, warm-up discarded. Compare against the toy-prompt 1 180 ms and
  record both. This alone justifies the task.
- [ ] **3. Correct REFERENCE.md's baseline table** with the real figure and a note that the
  earlier number was toy-sized.
- [ ] **4. Establish whether the prefix is stable.** Persona brief, job listing and CV do not
  change within an interview; the conversation changes every turn. Check the order they are
  actually bound in — a stable prefix only caches if it *is* a prefix.
- [ ] **5. Measure the cache effect before committing to it.** Two calls with the same long prefix
  and different tails, warm, and compare to two with different prefixes. If the difference is
  inside the noise, stop here and write that down — that is the result.
- [ ] **6. Only if step 5 showed a real win:** a new prompt version with the stable blocks first,
  plus the behaviour check (clarifies a vague answer; `clampAction` still refuses what it
  refused).
- [ ] **7. Check the trimming interaction.** `trimHistory` drops from the front of the
  conversation. If the conversation sits behind the stable prefix, trimming no longer disturbs it
  — confirm that is true rather than assuming it.

## Definition of done
- The real production-sized conductor latency is measured and REFERENCE.md is corrected.
- The prefix-caching question is answered with a number, in either direction.
- If the prompt changed: new version, behaviour check green, measured before/after.
- If it did not: `## Notes` says why, with the measurement that settled it.

## Verification
```bash
npm test -- --project node packages/ai interview/conductor
npm run lint && npm run typecheck
```
Plus the measurement output pasted into `## Notes`. A green test suite is not the deliverable
here — the number is.

## Notes
_(fill in when done — the toy-vs-real figures, the caching measurement, and the decision either
way)_
