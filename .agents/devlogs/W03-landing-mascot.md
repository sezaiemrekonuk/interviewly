---
task: W03
author: Sezai
sessions: [2026-08-04]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 1
tools: [superpowers:test-driven-development, cavecrew-investigator]
---

## Session 1 — 2026-08-04

### What I asked for / what came back
- Asked for the landing screen + `<Mascot>` per the task file. First pass came back as a
  sketch: inline `style={{ fontSize: 56 }}`, `className="btn-primary"` (no such class), a
  `'__SEED_SHA__'` literal for the content-addressed key, a `TODO` where the locale switcher
  goes, and no tests — i.e. the DoD items were placeholders, not misses I could patch.
- Second pass: tests first, then a CSS-module page bound to F01 tokens.

### Methodology trace
- task DoD → `mascot.test.tsx` + `page.test.tsx` → red (9 failed / 2 passed; `page.module.css`
  did not exist, `mascotUrl` was not exported) → green (16 pass).
- Key shape asserted against the same regex `ui-checks/assets.test.ts` derives from `seed.ts`,
  so a seed template change fails both rings, not just W01's.
- Budget guard is a source assertion, not a hope: `page.test.tsx` reads `page.tsx` and fails if
  `@tanstack/react-query` or `./providers` is imported into the landing tree.

### Friction
- The content-addressed key has no runtime source on the client: the digest lives in `seed.ts`,
  the bucket has no manifest. Resolved with `NEXT_PUBLIC_MASCOT_SHA256` defaulting to the seeded
  placeholder digest — one env line beats a build-time manifest for placeholder artwork.
- Tracing the URL end to end turned up an infra defect: Caddy's `/assets/*` route hands MinIO a
  path with no bucket segment, and the bucket has no anonymous-read policy. Left the frontend
  correct, wrote it into STATE.md blockers rather than editing `Caddyfile` from a `W` task.
- W01's stray-literal scan rules out inline styles for anything sized or coloured — the page had
  to be a CSS module from the start. Worth knowing before writing the JSX, not after.

### What I rejected and rewrote by hand
- The `'__SEED_SHA__'` placeholder key — it renders a URL that cannot exist. Replaced with the
  real digest + env override.
- `style={{ fontSize: 56 }}` and `className="btn-primary"` — both invisible to the token lint
  (it scans `font-size:` in CSS, and the class is undefined anywhere). Replaced with
  `page.module.css` on tokens only.
- Flat `valueProp1..3` copy — rewrote as `props.{practice,feedback,progress}.{title,body}` so a
  value prop is a titled card, and the message keys say what they are.
- `alt=""` hardcoded in the component: kept for the decorative landing hero, but the default is
  now the localized `mascot.<pose>` string, per REFERENCE.
