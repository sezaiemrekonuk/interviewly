# Speech-latency — Execution Prompt

Paste this verbatim as the prompt for each new session working the `.agents/ledgers/speech-latency/`
ledger. `.agents/EXECUTE.md` is the prompt; its § 4 picks the task and its § 6 drains the chain.
The session has no memory of prior sessions — everything needed lives in these files.

---

## Prompt (copy from here down)

You are executing one task from the Speech-latency ledger in `.agents/ledgers/speech-latency/`.
Follow this protocol exactly, in order. Do not skip steps, do not batch multiple tasks, do not
improvise scope beyond the task file.

1. **Read `.agents/ledgers/speech-latency/STATE.md` in full** — ledger, statuses, cross-ledger
   dependencies, the "Current task" pointer, and the tech-debt list.

2. **Do not pick the task yourself.** Apply `.agents/EXECUTE.md` Part 1 § 4. Work the ID it gives
   you. If a rule ends the run, print its line and stop. Note that `L02` and `L03` depend on tasks
   in **another ledger** (`turn-taking` T03 and T04) — if those are not `done`, § 4 rule 3 applies
   and you print `BLOCKED` rather than working around it.

3. **Task selection already happened in step 2.** Do not re-derive it.

4. **Read `.agents/ledgers/speech-latency/REFERENCE.md` once.** It carries the measured baseline,
   the method, and two warnings that will mislead you if skipped.

5. **Read only the current task's file** (e.g. `tasks/L01-*.md`).

6. **Check `MODELS.md`** for this task's tier. `L02` requires opus — it spends money outside the
   request that serves its bytes. If you are not running that tier on it, print
   `TIER L02 needs opus-tier, running <your model>` and end the run.

7. **Do the work.** Tick each `## Steps` checkbox as you go. Stay in scope — consume S02's TTS
   route, I08's budget transaction and C02's conductor through their published surfaces.

8. **Run the `## Verification` command exactly as written.** If it fails, fix the code — never the
   command.

9. **Mark it done:** fill the task file's `## Notes` — **including the measured before and
   after** — flip the STATE.md row, repoint "Current task", rewrite "Last session ended".

10. **Write your devlog:** `.agents/devlogs/<same basename as the task file>.md`. Contract in
    `.agents/EXECUTE.md` § Devlog.

11. **Do not commit.** Report the files you changed and the verification output.

12. **Re-apply `.agents/EXECUTE.md` Part 1 § 4** and continue with what it gives you.

### If blocked mid-task

Set the row to `blocked`, write the blocker into STATE.md, and stop. Do not guess at a latency
number, and do not decide on the owner's behalf whether a synthesised voice sounds acceptable —
that is L01's whole point and ADR-L03 says so.

### Guardrails that apply regardless of task

- **Measure warm, or do not claim.** Every latency figure is a warm median over n≥5 with a
  **discarded warm-up call**. The first call in a process measured 1 883 ms against a 780 ms warm
  median; a benchmark that skips this overstates by more than a second and has already nearly sent
  this work in the wrong direction (ADR-L01).
- **A change that does not move latency is reverted, not kept.** Record the before and after in
  `## Notes`. "It should be faster" is not a result.
- **Never buy latency with the interviewer's voice.** ADR-L03: the model swap is decided by
  listening, in both languages, by a human. If it sounds worse, the ~700 ms stays on the clock and
  the task says so rather than swapping anyway.
- **Never create a second synthesis path.** Extract and share. `tts.ts:100-106` documents the
  double charge this prevents, and it does not go red when you get it wrong.
- **Every provider call is billed inside `withBudget`** — the `llm_calls` insert and the
  `spent_usd` increment share one transaction (I08, K13). A failed call bills nothing. Eager
  synthesis is a provider call.
- **Eager work never fails a candidate's turn.** Budget exhausted, provider down, storage down —
  logged and swallowed. The client's own `GET` remains the path that reports failure, with S10's
  copy.
- **K11 holds.** Assistant ids on the turn response are a latency shortcut, not a second source of
  truth. `GET /state` still reconciles, and if the two disagree `/state` wins.
- **Streaming is out of scope** (ADR-L05, #266). If a task starts to look like streaming, stop —
  it belongs to a different ledger, and streaming STT in particular would obsolete `turn-taking`
  rather than improve it.
- **Verification is not negotiable.** A skipped ring is reported as skipped, never as green.

---

## Why this file exists

`STATE.md`'s "Execution protocol" is the source of truth (keep them in sync). This file is the
same protocol shaped as a standalone pasteable prompt, and it front-loads the four guardrails
specific to this ledger — measure warm, revert what does not move, never trade the voice for
milliseconds, never fork the synthesis path — because those are the ways this work goes wrong
quietly.
