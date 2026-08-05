---
task: W08
author: Sezai
sessions: [2026-08-05]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 2
tools: [superpowers:test-driven-development, cavecrew-investigator]
---

## Session 1 — 2026-08-05

### What I asked for / what came back
- Asked for the dashboard over `GET /me/interviews` + `DELETE /interviews/:id`. First pass came
  back with all five source files but every string was the literal `"TODO"` and every component
  carried a `TODO(W08 sketch)` comment — a scaffold, not a screen.
- The generated `InterviewListItem` invented `overallScore: number | null`. Reading
  `backend/modules/interview/my-interviews.ts` showed the endpoint never returns a score. The
  whole "score summary" half of the acceptance criterion was hallucinated into existence.

### Methodology trace
task step 6 → `page.test.tsx` (7 cases) → green on first run, so the tests proved nothing →
mutated `useDeleteInterview.onSuccess` to a no-op → red (`delete calls DELETE and drops the row`)
→ reverted → green. Tests were written after the sketch, so the mutation check is what stands in
for red-first here; recorded rather than dressed up.

### Friction
- Copy went in with a trailing-newline strip on both `messages/*.json`. Rewrote both through a
  `JSON.parse`/`stringify` pass instead of hand-editing, which also got EN/TR key parity for free.
- W01's `ui-checks/tokens.test.ts` caught two things eslint did not: `color: #fff` (raw hex) and
  `padding: 8px 14px` (14 is not a multiple of 4). Full-suite run, not the task's filtered one,
  is what surfaced them — the task's verification command would have stayed green.
- `t(\`outcome.${key}\`)` does not typecheck against next-intl's compile-time message tree; the
  `as Parameters<typeof t>[0]` cast follows what `use-error-message.ts` already does for codes.

### What I rejected and rewrote by hand
- `overallScore` on the list item — deleted. Rows now render occupation + outcome + date; the
  score stays on the report. Logged the endpoint gap in `STATE.md` → `## Open blockers` (N01,
  Fatih) rather than papering over it client-side.
- `alt={t('empty.mascotAlt')}` on `<Mascot>` — deleted along with its message key. `Mascot`
  already falls back to the `mascot` namespace; a second alt string is a second thing to translate.
- `apiDelete<T>` — dropped the generic to `apiDelete(): Promise<ApiResult<never>>`. A `204` has
  no body; a type parameter there only invites `apiDelete<Something>`.
- Added `useInterviewList(enabled)`, which the sketch had no notion of. Without it the list query
  fires before `useRequireAuth` resolves and burns a 401 on every load — `useProfile(enabled)`
  had solved this three tasks ago.
