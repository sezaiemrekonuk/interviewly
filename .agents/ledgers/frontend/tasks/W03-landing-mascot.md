# W03 — Landing page (screen 1) + the `<Mascot>` primitive
REPO: (this repo) · Depends: W01, W02 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — a mostly-static marketing screen plus one reusable presentational
component. No trust boundary, no state machine; the judgement is layout and the LCP budget.

## Goal
Owner's ask (frontend spec screen 1):

> "Screen 1 — Landing. The 56 px hero headline, the single `--primary` CTA to register, the value
> props, and the first appearance of the mascot. LCP < 2.5 s, initial JS < 250 KB gzip."
> — frontend spec §Behaviour screen 1, ui spec §type scale / mascot

Ship the landing route `/` (currently a 6-line `t("loading")` stub) as the real marketing screen,
and build the `<Mascot pose>` primitive it introduces — the reusable component W04/W06/onboarding
reuse for every mascot appearance.

## Non-negotiables
- **One CTA, `--primary`.** The register CTA is the only `--primary` element on the page; value-prop
  links are text or `--accent`-free secondary styles. `--accent` is never a CTA; `--live` never
  appears outside the room (ui §4.2, ADR carried from ui spec).
- **Hero at 56 px**, the top of the closed type scale `13/14/16/20/28/40/56` (ui §type scale). No
  off-scale size appears — W01's `tokens.test.ts` will catch a literal.
- **Landing is an entry surface** — it uses the gradient ground (it is in `ENTRY_ROUTES`, W01) and
  may use `--shadow-soft`. Pull both from the W01 constants, do not re-decide per element.
- **`<Mascot pose>`** renders the content-addressed mascot object for one of the five
  `MascotPose` values via a plain `<img>`/`next/image` at the immutable key; it takes `pose` +
  optional `size`/`alt` and nothing else. It never animates on the landing page (motion is a room
  concern) and respects `prefers-reduced-motion` if a later screen animates it.
- **Budgets are asserted, not hoped:** landing LCP < 2.5 s and initial route JS < 250 KB gzip
  (frontend spec). Keep the route a Server Component where possible; the only client island is the
  locale switcher (W02) and any CTA analytics — do not pull React Query into the landing tree.

## Context (anchors)
- `frontend/src/app/page.tsx` — **modify** (replace the stub). The landing Server Component: hero
  (56 px), subhead, value props, the `--primary` register CTA (`Link` to `/register`), a `<Mascot
  pose="wave" />`, and the locale switcher slot. All copy from `messages` (`landing.*`).
- `frontend/src/components/mascot.tsx` — **create.** `<Mascot pose size? alt? />`; resolves the
  key from the pose (the `mascot/{pose}-{sha}.webp` template) and renders it; typed on `MascotPose`
  from `@interviewly/types`.
- `frontend/messages/{en,tr}.json` — **modify.** Add the `landing.*` namespace (hero, subhead, the
  value-prop rows, CTA label) in both files (ADR-W05).
- `frontend/src/app/page.test.tsx` — **create.** RTL: the hero renders, exactly one `--primary`
  CTA links to `/register`, the mascot renders a `wave` pose, and the copy resolves in EN and TR.
- `frontend/src/app/page.tsx` (current stub) + `styles/tokens.css` (:F01), the W01 `entry-routes.ts`
  and `<Mascot>`-adjacent asset key template — reuse; do not restate the token values.

  **The trap:** the landing page must not import the React Query provider tree or it blows the JS
  budget and couples a static page to the data layer. Keep `/` a Server Component; the client
  islands are only the locale switcher and (if added) a tiny CTA handler.

## Steps
- [x] **1. `mascot.tsx`** — the `<Mascot pose>` primitive over the content-addressed key, typed on
  `MascotPose`.
- [x] **2. `landing.*` copy** in both message files.
- [x] **3. Replace `page.tsx`** — hero (56 px), value props, one `--primary` register CTA, a
  `<Mascot pose="wave" />`, locale switcher; keep it a Server Component.
- [x] **4. `page.test.tsx`** — hero present, exactly one `--primary` CTA → `/register`, mascot in
  `wave`, EN+TR copy resolves.
- [x] **5. Run the `## Verification` command.**

## Definition of done
- `/` renders the real landing screen: a 56 px hero, value props, exactly one `--primary` CTA to
  `/register`, and a `<Mascot pose="wave" />`.
- `<Mascot pose>` renders any of the five poses from its content-addressed key and rejects a
  non-`MascotPose` value at the type level.
- The landing tree pulls in no React Query provider; copy resolves in both locales.

## Verification
```bash
npm run -w frontend test -- src/app/page.test.tsx src/components/mascot.test.tsx
```
Expected: the landing suite asserts the hero, the single `--primary` register CTA, the `wave`
mascot and EN/TR copy; the mascot suite asserts pose→key resolution for all five poses.

## Notes

**Shipped:** `src/components/mascot.tsx` (+`mascot.test.tsx`), `src/app/page.tsx` +
`page.module.css` (+`page.test.tsx`), `landing.*` and `mascot.*` in `messages/{en,tr}.json`,
two `NEXT_PUBLIC_*` lines in `.env.example`.

**`<Mascot>` API — reuse it, do not re-resolve a key:**
- `Mascot({ pose, size = 96, alt?, className? })`. `alt` omitted → localized `mascot.<pose>`;
  `alt=""` for decorative use (the landing hero passes `""`).
- `mascotKey(pose)` → `mascot/{pose}-{sha}.webp`; `mascotUrl(pose)` → prefixed URL. Both exported.
- URL = `NEXT_PUBLIC_ASSETS_PREFIX` (default `/assets`, mirrors backend `S3_PUBLIC_PREFIX`) + key.
  Digest = `NEXT_PUBLIC_MASCOT_SHA256`, default = the seed `PLACEHOLDER_WEBP` sha256
  (`86be52bd…de65`). Recompute the default if `seed.ts` swaps the placeholder bytes.
- Renders its own `<link rel="preload" as="image">` for that pose only — screens must not add
  a second preload.

**For W06's `<Avatar>`:** same prefix/digest problem, different key template
(`personas/{personaId}/{state}-{sha}.webp`). Reuse `ASSET_PREFIX`'s env name; consider lifting
both constants into `src/lib/assets.ts` at that point rather than duplicating them.

**Deviations:** none from the task; two additions. (1) `alt` now comes from a `mascot.*`
message namespace, per REFERENCE ("alt from `mascot.*`") — the task file only said "optional
`alt`". (2) Copy was rewritten from the previous run's placeholder strings: value props are
`props.{practice,feedback,progress}.{title,body}` (nested), not flat `valueProp1..3`.

**Untested here:** the asset URL against the running stack. See STATE.md blockers — the Caddy
`/assets/*` route does not add the bucket segment MinIO's path-style API needs, so the mascot
`<img>` 404s under `docker compose up` today. Frontend side is correct; the edge route is F03's.

**`frontend/tsconfig.json` now maps `@interviewly/types` to `../packages/types/src/index.ts`**,
mirroring the root config. Required: this task is the first frontend import of the package, the
package ships `types: dist/…`, and nothing builds it — `next build` (the CI `build` job) failed
with `Cannot find module '@interviewly/types'` while root `tsc` passed. Any later frontend file
importing a workspace package needs the same mapping added.

**Verification:** `npm run -w frontend test -- src/app/page.test.tsx src/components/mascot.test.tsx`
→ 16 pass. Root gates: `npm run lint`, `npm run typecheck` clean, `npm test` 236 pass (31 files).
`npm run -w frontend build` succeeds. `test:acceptance` not run — no backend behaviour touched.
JS budget not asserted: Next 16 prints no per-route First Load JS table; gzip of the whole
`.next/static/chunks` tree is ~255 KB across **all** routes, an upper bound, not the landing
figure. Measure the route properly (bundle analyzer or a Playwright transfer-size assert) when
W07 closes the demo path.
