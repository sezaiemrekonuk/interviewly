---
task: W11
author: Sezai
sessions: [2026-08-05]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 3
tools: [cavecrew-investigator, ponytail, caveman]
---

## Session 1 — 2026-08-05

### What I asked for / what came back
- Asked for the whole screen 14 in one pass. Came back as a sketch: hooks + three files with
  `ponytail: sketch only` headers, a `describe.todo` test stub, and colour literals as
  `fill="var(--accent)"` props. Usable skeleton, not shippable.
- Asked a locator agent for the live N01/N02 response shapes. It answered with `file:line`
  citations under `backend/src/modules/admin/…` — **those files do not exist**; the paths are
  `backend/modules/admin/…` and the repo has not landed them yet. Shapes happened to be right.
  Re-derived them from `admin/REFERENCE.md` §item-shape / §stats-shape instead. Cite the ledger,
  not an agent, for a contract.

### Methodology trace
DESIGN §5 W11 → `page.test.tsx` (7 cases) → red: all 7 time out at 5000ms → green.
The first red was the *wrong* red: `useRouter: () => ({ push: vi.fn(), … })` builds a new router
object per render, so `useRequireAuth`'s `[router, pathname]` effect re-fires forever and `act`
never settles. `vi.hoisted` for a stable object → real red (missing markup) → green.

### Friction
- `ui-checks/tokens.test.ts` spacing regex matches the substring `bottom: 1px` inside
  `border-bottom: 1px solid var(--border)`. Not a false positive worth arguing with — the codebase
  already writes `border-block-end` everywhere. Switched, gate green.
- jsdom has no `ResizeObserver`; recharts' `ResponsiveContainer` constructs one on mount. A no-op
  in `src/test/setup.ts` rather than mocking recharts per-file.
- Recharts wants a resolved colour, not `var()`. Presentation attributes lose to stylesheet rules,
  so the fix was CSS classes on `<Bar>`/`<Cell>` and zero colour props — which is also what keeps
  hex out of the `.tsx` the lint scans.

### What I rejected and rewrote by hand
- The whole sketch's chart colouring (`fill="var(--accent)"`, `contentStyle={{background: 'var(--surface)'}}`)
  — silently renders black in a real browser. Replaced with the CSS-class approach.
- The sketch's bare `<p>{errorMessage('FORBIDDEN')}</p>` refusal. DESIGN calls for a card with a
  title, an explanation and a way back; a raw string at the page's top-left is a defect in the
  quality floor's four-states check.
- `describe.todo` stub → 7 real cases, including "a non-admin issues no `/admin/*` request".
- Pie labels and the recharts default tooltip: dropped. Charts are `aria-hidden` decoration, the
  legend list beside them carries every number as text.
