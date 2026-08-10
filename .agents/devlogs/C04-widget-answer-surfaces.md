---
task: C04
author: Sezai
sessions: [2026-08-10]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 1
tools: [claude-code, subagents]
---

## Session 1 — 2026-08-10

### What I asked for / what came back
- `questions.widget` (JSONB) written by the conductor's `show_widget` action, validated by
  `WidgetSchema` — `{kind: 'textbox'|'choice', label, options?}` with a refine that a `choice`
  carries at least two options.
- `state.ts` returns it. The hardcoded `widget: null` and its `ponytail:` note are gone: the
  note said "widget question kind isn't built yet (I04/I06 scope)", and this is the task that
  built it.
- `AnswerComposer` takes an optional `widget`; a `choice` renders a native `<select>`, a
  `textbox` renders the existing textarea with the server's label.
- The room renders a composer in **voice** mode too, but only when a widget is present.

### Methodology trace
- The question the ledger owner actually opened with was "how do we show a textbox question in
  our interview room?" The honest answer was that we did not: `QuestionKind.widget` and
  `InputMode.widget` had been in the schema since the init migration with nothing to put in
  them. So this task is the original ask, and C02 is what made it answerable — a surface needs
  someone to decide to put it there.
- Native `<select>` over a hand-built listbox: rung 4 of the ladder, and `ui.test.tsx` already
  carries an assertion named "renders a native select, never a listbox widget".

### Friction
- Deciding where the widget lives. First instinct was the assistant message that announced it,
  which is wrong on refresh: the message scrolls away and the box has to still be there. It
  belongs to the question — that is the thing being answered.
- `voice.test.tsx` asserted `queryByRole('textbox')` is absent. That assertion is still right
  *without* a widget and deliberately wrong with one, so it was split rather than deleted: the
  no-widget case keeps it, and a new case asserts the composer appears when the interviewer put
  one on screen. Deleting it would have lost a real guarantee — a voice room must not sprout a
  keyboard on its own.

### What I rejected and rewrote by hand
- Rejected a separate `AnswerWidget` component. The composer already owns submit state, the
  disabled-with-a-reason hint and the "clear only once the server took it" rule (#90); a second
  component would have been a worse copy of all three.

### Verification (verbatim)
- `npm run typecheck` clean · `npm run lint` clean.
- Frontend design-system checks: `Test Files 6 passed (6)`, `Tests 89 passed (89)` — after
  fixing two real violations this task introduced (a `3px` border and a physical `border-left`;
  the repo requires 4px-grid spacing and logical properties).

### Follow-up left for the ledger (non-blocking)
- A widget answer during a voice interview is recorded with `input_mode: 'voice'`, because the
  window is stored under the interview's mode rather than per utterance. Noted in
  `conductor.ts`; fixing it means a column on `chat_messages`, not on `answers`.
