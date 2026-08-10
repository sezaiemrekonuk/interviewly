# frontend

Next.js App Router, CSS Modules, next-intl. Root notes: [../AGENTS.md](../AGENTS.md).

**[DESIGN.md](DESIGN.md) is canonical.** If a screen and it disagree, the screen is the defect.
§2a is the route map and says which surface owns what — read it before adding a route or moving
a control. `PRODUCT.md` (repo root) holds product truth and what the marketing page may claim.

---

## The five rules that will bite you

**1. No inline `style` attributes. Ever.** The CSP is `style-src 'self' 'nonce-…'`
(`src/middleware.ts`), so a style attribute is **silently dropped in production** while working
perfectly in dev. `style={{ width: '50%' }}` shipped meters that rendered at zero width for real
users. Three sanctioned ways to express a dynamic value:

- a native `<progress value max>` — `components/shell/meter.tsx`, used for every bar in the app;
- a class per discrete state (scores are integers 0–5, so six classes, not a computed width);
- **SVG geometry attributes** — `points`, `d`, `x`, `width`. These are not style and are allowed,
  which is the only reason a line chart is possible here (`dashboard/modules.tsx`).

**2. No Tailwind, no UI library.** By specification, not by omission — DESIGN.md §1 gives three
binding reasons. Adding one breaks the CSP, defeats the token lint, and gives every value a
second home. Style with CSS Modules reading `var(--token)`.

**3. The token lint is a test, and it will fail your PR.** `src/ui-checks/tokens.test.ts` scans
every `.ts/.tsx/.css` under `src/`:
- no colour hex outside `styles/tokens.css`;
- `font-size` only from `13 / 14 / 16 / 20 / 28 / 40 / 56` px;
- spacing (`margin/padding/gap/top/left/right/bottom`) in multiples of 4;
- `box-shadow` only as `var(--shadow-…)`.
Author **px, not rem** — the lint only sees px, so rem slips past it and drifts.

**4. Both locales ship every key, in the same commit.** `messages/en.json` and `messages/tr.json`.
No English fallback is ever rendered to a Turkish user. Turkish is informal *sen* throughout and
is a native voice, not a transliteration — the one exception is quoted interviewer dialogue,
where a Turkish interviewer says *siz* to a candidate.

**5. Navigate through `src/i18n/navigation.ts`, never `next/link` or `next/navigation`.** The
language is a path segment (`/` English, `/tr/…` Turkish — issue 91), so a plain `<Link>` sends a
Turkish reader to the English URL and costs a redirect at best. `Link`, `useRouter`, `usePathname`
and `redirect` come from there; `useSearchParams` and `useParams` read the URL rather than write
it and still come from `next/navigation`. Write `href="/dashboard"` at the call site — never
`/tr/dashboard` — and the current locale turns it into an address.

## Where the locale lives

Every page is under `src/app/[locale]/`. `src/app/` itself holds only the document
(`layout.tsx`), the 404, and the metadata routes — `sitemap.ts`, `robots.ts`, `manifest.ts`,
`icon.tsx`, `opengraph-image.tsx` — which are single artefacts at fixed addresses and therefore
answer in the default locale. `not-found.tsx` is up there because Next renders a not-found
outside the matched route's layouts, and an unmatched URL has no `[locale]` to read.

- `src/i18n/routing.ts` is the one description of the scheme. `localePrefix: 'as-needed'`, so
  the default locale keeps the bare URL and every link already in the wild still resolves.
- `src/middleware.ts` negotiates an unprefixed request from the cookie, then `Accept-Language`,
  and carries the CSP nonce through next-intl's own response.
- Public routes declare `alternatesFor(route, locale)` from `lib/site.ts` in their
  `generateMetadata` — canonical plus the reciprocal `hreflang` pair. A route that skips it has
  no canonical at all, which is better than inheriting a wrong one.
- A test that mocks `next/navigation` must spread `serverNavigation` from `src/test/navigation.ts`
  into the factory, or every component importing the wrappers fails to import.

## Architecture facts you cannot read off the file tree

- **The server owns interview state.** The client never derives round, question index or active
  persona locally. SSE is a *nudge* to refetch, not a payload — `lib/use-interview-events.ts`.
- **Every screen is the split shell** (`components/shell/split-shell.tsx`): a dark context rail
  against a light working surface. Signed-in browsable surfaces use `components/shell/app-rail.tsx`
  for it, which is also where navigation and sign-out live. There is no top navigation bar and
  adding one would be a second navigation system.
- `/privacy`, `/terms` and `/not-found` are the deliberate exceptions — centred documents, no rail.
- **Query keys live once**, in `lib/query.ts` `queryKeys`. A key written by hand at a call site
  eventually becomes a *different* key and the SSE nudge invalidates a cache entry nobody reads.
- The anonymous landing must not pull React Query into its chunk — asserted by
  `src/app/[locale]/page.test.tsx`. `home-switch.tsx` uses a plain `apiGet` for its one boolean.

## Testing landmines

- **Mock `useRouter()` as one stable object.** `useRequireAuth` keys its effect on router
  identity, so a factory returning a fresh object per call re-fires the effect on every commit —
  an infinite render loop that presents as a five-second test timeout with no error. Use
  `vi.hoisted` and return the same object.
- **`src/test/setup.ts` answers `prefers-reduced-motion: reduce`,** so every authored animation
  resolves instantly and content tests never wait on one. A test *about* motion must stub
  `matchMedia` itself — see the typewriter test in `app/[locale]/interviews/[id]/room/page.test.tsx`.
- jsdom ships no `ResizeObserver` and no `scrollIntoView`; the setup file no-ops the first and
  components feature-detect the second.

## Where to be careful

- **`--live` is the interview room only.** Never a success state, never a CTA, never on the
  landing, dashboard, report or admin.
- **`--accent` is never a CTA fill.** It is the focus ring, chart series and section keys.
- **One `--primary` element per surface.** Two orange buttons in one viewport means the eye has
  to choose. A *disabled* primary still counts.
- **`Spec`** (`split-shell.tsx`) means "specified, not yet built" to an operator. It belongs on
  `/admin` and must never render on a candidate-facing screen.
- State is never carried by colour, width or motion alone. Every meter is `decorative` with a
  text sibling stating the number.
