# Platform — Execution Prompt

Paste this verbatim as the prompt for each new session working the `.agents/ledgers/platform/`
ledger. `.agents/EXECUTE.md` is the prompt; its §4 picks the task and its §6 drains the chain. The
session has no memory of prior sessions — everything needed lives in these files.

---

## Prompt (copy from here down)

You are executing one task from the Platform ledger in `.agents/ledgers/platform/`. Follow this
protocol exactly, in order. Do not skip steps, do not batch multiple tasks, do not improvise scope
beyond the task file.

1. **Read `.agents/ledgers/platform/STATE.md` in full** — the ledger, the statuses, the Open
   blockers section, the "Current task" pointer, and the tech-debt list.

2. **Do not pick the task yourself.** Apply `.agents/EXECUTE.md` Part 1 §4. Work the ID it gives
   you. If a rule ends the run, print its line and stop. Note that P05 and P06 need a Fly account
   with billing and P01 needs GHCR package visibility — both are in STATE.md's Open blockers, and
   an unresolved one means `blocked`, not "try it and see".

3. **Task selection already happened in step 2.** Do not re-derive it.

4. **Read `.agents/ledgers/platform/REFERENCE.md` once.** It carries the service/port/probe map, the
   SSE anchors this whole ledger is about, the provider-stub map, the env keys that move per target,
   and the Caddyfile's four load-bearing behaviours. Nothing in it needs re-deriving from the code.

5. **Read only the current task's file** (e.g. `tasks/P02-*.md`).

6. **Check `MODELS.md`** for this task's tier. P02, P05 and P09 require opus. If you are not running
   that tier on one of them, print `TIER <ID> needs opus-tier, running <your model>` and end the
   run.

7. **Do the work.** Tick each `## Steps` checkbox as you go. Stay in scope.

8. **Run the `## Verification` command exactly as written.** If it fails, fix the code — never the
   command.

9. **Mark it done:** fill the task file's `## Notes` — **including the machine every measurement
   ran on** — flip the STATE.md row, repoint "Current task", rewrite "Last session ended".

10. **Write your devlog:** `.agents/devlogs/<same basename as the task file>.md`. Contract in
    `.agents/EXECUTE.md` § Devlog.

11. **Do not commit.** Report the files you changed and the verification output.

12. **Re-apply `.agents/EXECUTE.md` Part 1 §4** and continue with what it gives you.

### If blocked mid-task

Set the row to `blocked`, write the blocker into STATE.md's Open blockers section (what is needed,
which tasks it unblocks), and stop. Do not guess at cloud credentials, do not create billing
accounts, and do not substitute a different provider because the named one needs a card.

### Guardrails that apply regardless of task

- **Fakes are all-or-nothing, and the guard has no override.** Fake speech with a live LLM produces
  a real, scored, billed report about answers the candidate never gave, and nothing downstream can
  detect it — the transcript is well-formed and the score is plausible. `SPEECH_PROVIDER=fake`
  requires `AI_ENABLED=false` **and** `LOADTEST=1`, enforced at boot (ADR-P07, P02). Never add an
  escape hatch to this, and never leave a load-test profile applied to a live app at the end of a
  run.
- **The traffic is fake; the routing is not.** Real replicas, real balancers, real long-lived
  connections. If a task starts to look like simulating the routing layer, stop — the number stops
  meaning anything and the whole ledger's output is the number.
- **Every figure is a file.** Measurements land in `loadtest/results/` and are transcribed from
  there, never from a terminal or from memory. A number without a file behind it does not go in
  `SCALE.md` (P09 verifies this mechanically).
- **Name the machine, name the binding resource.** "It got slow" is not a finding. Which resource
  ended the run, and what observation identified it.
- **Do not tune to make a number better.** Not Postgres, not Redis, not `REPORT_CONCURRENCY`, not
  resource limits between levels. A tuned run is a different experiment; it goes in the Backlog with
  its own trigger.
- **Replicas are not the knob.** Concurrent interviews are bounded by Redis connections, one per
  open stream (`sse.ts:180`). Check the store before reporting that the app stopped scaling
  (ADR-P09).
- **`/healthz` is liveness and touches no dependency; `/readyz` is readiness and checks both.**
  Wiring liveness to `/readyz` recreates exactly the restart loop I14 split them to prevent.
- **`NEXT_PUBLIC_*` are build arguments.** Supplied at run time they are already too late and the
  image ships the source fallbacks — a broken mascot and the wrong locale, on the first page load
  and on no test.
- **Nothing here changes application behaviour.** If a scale finding demands one, it is a finding:
  it goes in `SCALE.md` and the Backlog, not into a task in this ledger. The one exception is P02's
  boot-time provider selection, and its whole design is about being unable to fire in production.
- **Verification is not negotiable.** A skipped ring is reported as skipped, never as green.

---

## Why this file exists

`STATE.md`'s "Execution protocol" is the source of truth (keep them in sync). This file is the same
protocol shaped as a standalone pasteable prompt, and it front-loads the guardrails specific to this
ledger — all-or-nothing fakes, real routing, every figure traceable to a file, and the ceiling that
is not the replica count — because those are the four ways this work produces something that looks
finished and is wrong.
