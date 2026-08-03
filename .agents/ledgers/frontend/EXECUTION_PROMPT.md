# Frontend — Execution Prompt

Paste this verbatim as the prompt for each new session working the
`.agents/ledgers/frontend/` ledger. `.agents/EXECUTE.md` is the prompt; its § 4 picks the task
and its § 6 runs it. The session has no memory of prior sessions — everything needed lives in
these files.

---

## Prompt (copy from here down)

You are executing one task from the Frontend ledger in `.agents/ledgers/frontend/`. Follow this
protocol exactly, in order. Do not skip steps, do not batch multiple tasks, do not improvise
scope beyond the task file.

1. **Read `.agents/ledgers/frontend/STATE.md` in full** — ledger, statuses, cross-ledger
   dependencies, critical path, the "Current task" pointer, and the Open blockers.

2. **Do not pick the task yourself.** Apply `.agents/EXECUTE.md` Part 1 § 4: the assignment map
   (frontend is **Sezai**, prefix `W`), the dependency dump, and the five rules. Work the ID it
   gives you. If a rule ends the run, print its line and stop. The "Current task" pointer is a
   human-readable summary and can lag behind the `Depends on` column, which is the truth.

3. **Read `.agents/ledgers/frontend/REFERENCE.md` once.** Trust it; patch it if stale.

4. **Read only the current task's file** (e.g. `tasks/W01-*.md`). Other task files belong to
   other sessions.

5. **Check `.agents/ledgers/frontend/MODELS.md`** for this task's tier. Four tasks (W02, W06,
   W07, W10) require `claude-opus-4.8` — the data/SSE layer, the text room, the report-wait, the
   voice room. If you are not running that model on one of them, print
   `TIER <ID> needs opus, running <your model>` and stop (EXECUTE.md § 5).

6. **Do the work.** Tick each `## Steps` checkbox as you go. Stay in scope — note adjacent work
   in the STATE.md Backlog section, don't fold it in.

7. **Run the `## Verification` command exactly as written.** It is a `vitest`/Playwright command,
   never Cucumber (ADR-W04) — do not touch `cucumber.js`. If it passes on the first run before you
   wrote any code, the test is wrong; fix the test. If it fails, fix the code, never the command.

8. **Mark it done:** fill the task file's `## Notes`; flip the STATE.md ledger row to `done`;
   repoint "Current task"; rewrite "Last session ended" with what landed, which files changed, and
   what the next task must know.

9. **Write your devlog:** `.agents/devlogs/<same basename as the task file>.md`. Full contract:
   `.agents/EXECUTE.md` § Devlog. Author is **Sezai** unless told otherwise.

10. **Do not commit.** Report the files you changed and the verification output; the human
    commits, pushes and opens the PR.

11. **Re-apply `.agents/EXECUTE.md` Part 1 § 4** and continue with what it gives you. Stop when a
    rule ends the run, or when § 5 says the next task needs a different tier.

### Guardrails that apply regardless of task

- **The client never owns interview truth.** `['interview', id, 'state']` refetched from the API
  is the sole room truth. Every SSE `{ type }` event and every reconnect only invalidates that
  key — the event payload is ignored (ADR-W02, K11). Never render the room from an SSE body, and
  never advance the UI optimistically on a submit — await the refetch.
- **No raw error code, ever.** Every API `{ error: { code } }` maps through `useErrorMessage`
  (`lib/use-error-message.ts`) to `errors.<CODE>`; an unknown code falls back to `errors.UNKNOWN`.
  The raw code string never appears in the DOM. The frontend introduces no new error code.
- **No server- or LLM-originated string is `dangerouslySetInnerHTML`.** Questions, report prose,
  transcript and persona copy are attacker-influenceable (the listing reaches the model) and are
  rendered as text only. `next-intl` interpolation over developer-authored keys is the only
  templating.
- **The SSE route is `GET /interviews/:id/events`** (ADR-W02) — the real path, not the frontend
  spec route map's `/events/interviews/:id`. Use the real one.
- **Same-origin only.** All calls go through `lib/api.ts` (the `/api` prefix, `credentials:
  'same-origin'`). No route hardcodes an origin (§11.3). The `httpOnly` session cookie is never
  read from JS, stored in `localStorage`, or put in a URL.
- **English + Turkish, both files, every screen** (ADR-W05). `messages/en.json` is the source;
  a key missing from `tr.json` is a failure, not a fallback. LLM content is rendered in the
  interview language, never through `next-intl`.
- **Tokens only, no literals.** No colour hex, px radius, shadow, font family, off-scale type
  size (`13/14/16/20/28/40/56`) or non-multiple-of-4 spacing outside `styles/tokens.css`. W01's
  token-lint enforces it; do not give it new violations to find.
- **Verification is Vitest/Playwright, never Cucumber.** `cucumber.js` is never edited by a
  frontend task (ADR-W04, prompt §5).

### If blocked mid-task

Set the row to `blocked`, write the blocker into STATE.md's "Open blockers" section (what's
needed, which tasks it unblocks), and stop. The two live gaps are already recorded there:
`GET /interviews/:id` (the report read handler, unowned) blocks a clean W07 close, and the
`POST /interviews` response gap blocks W05's occupation/language editor. Do not build a screen
against a phantom route.

---

## Why this file exists

`STATE.md`'s "Execution protocol" is the source of truth (keep them in sync). This file is the
same protocol shaped as a standalone pasteable prompt, front-loading the client-truth /
error-code / injection / SSE-route guardrails that apply to every frontend task.
