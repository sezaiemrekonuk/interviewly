# Interviewly — design system and execution principles

## 0. What in here is binding

**Canonicity is per section, not blanket.** The 2026-08-06 redesign ("Direction B") replaced the
visual system this document was written against, and for a while §0 still claimed the document
won any disagreement with a screen. It does not. Read the table before you file anything.

| Section | Status |
|---|---|
| §1 Identity | **Canonical.** Rewritten for Direction B. |
| §2 Tokens | **Canonical**, and quoted from `styles/tokens.css`. That file is the source; if the two disagree, the file wins and this table is the defect. |
| §3 Composition | **Canonical for the shell and the rules**; the per-pattern values are described from the shipped modules and may lag them. |
| §4 Voice and copy | **Canonical.** Untouched by the redesign — see the note in that section. |
| §5 Per-surface briefs | **Pre-redesign. Not canonical.** Written against the retired gradient/flat system. Kept for the interaction and accessibility intent, which mostly survived; every visual value in them is stale. Read the surface's own CSS module first. |
| §6 Quality floor | **Canonical.** |

**A discrepancy against §5 is not a defect report.** That inversion produced three issues — #146,
#136 and #135 — each filed by correct procedure against a section describing deleted code, and
each closed as obsolete after the code was traced. If a screen disagrees with §5, the screen is
almost certainly right.

Sources: `frontend/styles/tokens.css` (the shipped values — this document quotes **shipped**, not
spec, values), `frontend/src/components/shell/` (the one layout), and the surfaces built under
`frontend/src/app` and `frontend/src/components`. `.agents/specs/2026-07-29-ui.md` is the
*original* spec and predates the redesign; it is history, not a reference.

Enforced mechanically by `frontend/src/ui-checks/{tokens,contrast,grounds,assets}.test.ts`.
Passing those tests is the floor, not the standard.

---

## 1. Identity

**A working console, split.** Every screen is a fixed context column — the rail, a dark material
that says where you are and what is true right now — against a working surface that holds
exactly one subject. The two columns are different *materials*, not a tint and its border,
because a tint does not read as a split at a squint. The product is learned once and then used
everywhere: the same shell carries onboarding, the room, the report and the console.

The ink is near-black on an indigo-biased neutral, never pure grey and never pure white. One
burnt orange means *do this now* and means nothing else. Corners are near-square (2–6px) —
a track or a tile with a large radius stops reading as one thing. Motion is near-zero,
especially in the room, where the subject is the conversation.

> **Superseded 2026-08-06.** The previous identity was "a warm coach studio": a lavender→cream→
> peach gradient on entry routes, flat cream elsewhere, generous air, and a hand-drawn mascot on
> entry surfaces. All of it is gone. The gradient and its three stops are deleted and two checks
> keep them deleted (`ui-checks/tokens.test.ts`, `ui-checks/grounds.test.ts`); `components/mascot.tsx`
> still exists but is **imported by no screen**, only by its own test. Anything describing warm
> cream, a gradient ground or a mascot is describing the retired system.

**No UI library, no Tailwind.** Three reasons, all binding:

- **CSP is `default-src 'self'`** (`infra` §7.4). No external CSS, font or icon origin exists to
  load a component library's assets from, and fonts are self-hosted through `next/font/local`.
- **The token lint** (`ui-checks/tokens.test.ts`) scans every `.ts/.tsx/.css` under `src/` for
  stray hex, off-scale `font-size`, non-multiple-of-4 spacing and raw `box-shadow`. A library's
  compiled utility classes or a Tailwind arbitrary value defeats the check that keeps the system
  honest.
- **Single home for values.** Every value lives once, in `styles/tokens.css`, and is read by name.
  A theme mapping layer would give each value two homes and one of them would drift.

Styling layer: **CSS Modules**, one `*.module.css` per surface family, importing nothing but
token names. This settles ui spec Open question 1.

---

## 2. Tokens

`frontend/styles/tokens.css` is the only place a value is written. Everything else reads
`var(--name)`. A literal outside that file is a defect, not a shortcut.

### Colour (shipped)

Direction B kept every token **name** and re-pointed the values, so the whole app moved onto the
new palette in one step. A value below that disagrees with `tokens.css` is this table's bug.

| Token | Shipped | Role |
|---|---|---|
| `--bg` | `#F1F2F7` | page ground — a neutral biased toward the indigo, never a pure grey |
| `--surface` | `#FBFBFD` | the working surface, and cards on it |
| `--surface-sunken` | `#E7E9F1` | inset: meter tracks, status chips, banner beds |
| `--text` | `#12131C` | body ink — near-black, never black |
| `--text-muted` | `#565C71` | secondary text. 4.68:1 on `--stage`, the darkest ground — **the system's floor** |
| `--primary` | `#B2400A` | the single action colour; white on it is 5.78:1 |
| `--primary-soft` | `#FBEFE7` | primary tint: hovers, informational beds |
| `--primary-deep` | `#8F3407` | primary **as text on light**, where the fill tone is too bright |
| `--accent` | `#4046CC` | informational — section keys, chart series, and the focus ring. **Never a CTA fill** |
| `--accent-deep` | `#383DB0` | accent as text on light |
| `--live` | `#0C6F33` | **in-session only**: `LIVE` badge + active-speaker ring; white on it is 6.29:1 |
| `--success` | `#0E7A3A` | success |
| `--warning` | `#8A5A00` | warning |
| `--danger` | `#B52519` | error / destructive. 5.34:1 as 13px copy on the sunken bed |
| `--border` | `#CBCEDD` | hairline borders (1px, always) |
| `--stage` | `#D5D8E7` | the interview stage — the ground the participant tiles sit on |

**The rail is a second ink ramp, not a tint of the surface.** It is the context column's own
material and its text tokens are the only ones legible on it.

| Token | Shipped | Role |
|---|---|---|
| `--rail` | `#191B2B` | the context column's ground |
| `--rail-raised` | `#232640` | the current nav item, and raised beds inside the rail |
| `--rail-border` | `#343954` | hairlines inside the rail |
| `--rail-text` | `#F2F3F9` | rail body ink |
| `--rail-text-muted` | `#A9AECB` | rail secondary |
| `--rail-text-faint` | `#8A90B4` | rail tertiary — the tightest pair in the system, on `--rail-raised` |

| Token | Shipped | Role |
|---|---|---|
| `--series-1` … `--series-6` | `#4046CC` `#B2400A` `#186972` `#63389A` `#0E6E33` `#7A4E00` | chart series; all clear AA as text on `--surface` |
| `--spec-hatch` | `repeating-linear-gradient(135deg, #DDDFEA 0 5px, #F1F2F7 5px 11px)` | "specified, not yet built" — one neutral convention, never a warning colour |

Every pair in `ui-checks/contrast.test.ts` clears AA 4.5:1, and the tightest is `--text-muted`
over `--surface-sunken` at 4.68:1. Do not lighten `--text-muted` or deepen `--surface-sunken`
without re-running it. The values are already darkened against the original spec literals, which
failed the AA floor that same spec set — do not "restore" a brighter orange.

**The entry gradient is deleted.** `--gradient-entry`, `--grad-lavender`, `--grad-cream` and
`--grad-peach` no longer exist in `tokens.css`, and two checks keep it that way:
`ui-checks/tokens.test.ts` fails if any is redeclared, `ui-checks/grounds.test.ts` fails if any
is referenced from `src/**`. There is no route left that paints a wash.

### Non-colour (shipped)

**Radius is near-square now.** The old scale (24 / 16 / 12 / 999px) is gone; a track or a tile
with a large radius stops reading as one thing.

| Token | Value | Use |
|---|---|---|
| `--radius-panel` | `6px` | full-width panels: question panel, report header |
| `--radius-card` | `3px` | cards, tiles, transcript turns, table shell |
| `--radius-input` | `2px` | inputs, textareas, banners |
| `--radius-button` | `2px` | buttons, pills, badges, meter fills — **not** a pill any more |
| `--shadow-hairline` | `0 1px 2px rgba(18,19,28,.07), 0 10px 26px -14px rgba(18,19,28,.30)` | genuine lift off the working surface |
| `--shadow-soft` | `0 2px 3px rgba(18,19,28,.05), 0 30px 60px -26px rgba(18,19,28,.42)` | the deeper of the two tiers |
| `--duration-default` | `200ms` (→ `0ms` under `prefers-reduced-motion`) | every transition |
| `--easing-default` | `ease-out` | every transition |
| `--container-max` | `1440px` | the widest any content column gets, on every screen |
| `--font-heading` | Outfit 500–700, `next/font/local`, `display: swap` | headings, wordmark, numerals-as-display |
| `--font-body` | Inter 400–600, `next/font/local`, `display: swap` | body, UI, labels, data |

Two shadow tiers, nothing else, and both are used for real lift rather than decoration. The old
"soft on entry, hairline everywhere else" split died with the entry routes.

Font delta: the spec says `next/font/google`; shipped is `next/font/local` over
`public/fonts/*.woff2`. Same outcome (self-hosted, no external origin), stricter under CSP.

### Hard rules

1. **`--primary` is the only CTA colour.** One primary action per surface — the eye must not
   choose. Secondary actions are text buttons in `--text-muted`, or bordered `--surface` buttons.
2. **`--accent` is never a CTA.** Section keys, chart series, informational emphasis. That is all.
3. **`--live` is in-session only** — the `LIVE` badge and the active-speaker ring on exactly one
   tile, or none. Never a success state, never a CTA, never on report, dashboard or admin.
4. **There is one ground, and it is the split shell.** No route paints a wash and no route opts
   into a different page background. `src/lib/entry-routes.ts` — the closed gradient route list
   and its `SURFACE_SHADOW` map — **was deleted with the rule it encoded**; nothing imports it and
   nothing should reintroduce a per-route ground decision. The rail is `--rail`, the working
   surface is `--surface`, a card on it is also `--surface` with a `--border` hairline.
5. **The rail's ink ramp is not optional.** Text on `--rail` or `--rail-raised` uses
   `--rail-text{,-muted,-faint}`. `--text` and `--text-muted` are tuned for the light grounds and
   fail AA on the rail — that is exactly how a `role="alert"` node shipped at 2.57:1 for months
   (#200), and why `ui-checks/contrast.test.ts` pins all six rail pairs.
6. **Type scale is exactly `13 / 14 / 16 / 20 / 28 / 40 / 56` px.** 13 = meta/labels/badges,
   14 = secondary + dense data, 16 = body and controls, 20 = section/question, 28 = page title,
   40 = big figure, 56 = landing/onboarding hero only. Inputs are never below 16px (iOS zooms).
7. **Spacing is multiples of 4.** 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 64.
8. **Author px, not rem.** The lint only sees `px`; rem values slip past it silently. Older modules
   (`auth.module.css`, `setup.module.css`, `onboarding.module.css`) still carry rem — legacy, do
   not copy. New CSS is px so the lint can hold it.
9. **Motion is 150–250ms `ease-out`**, always via `var(--duration-default) var(--easing-default)`
   so reduced-motion zeroes it in one place. Near-zero inside the room. One authored motion moment
   per surface; the rest is state change, not animation.

---

## 3. Composition patterns

These are the patterns already shipped. Reuse them by shape, not by copy-paste of values.

### 3.1 The split shell — the one layout

```
.shell  display grid; grid-template-columns: var(--rail-width) minmax(0, 1fr);
        min-height 100vh; background var(--surface)
.rail   background var(--rail); color var(--rail-text); padding 24px 20px;
        sticky to the viewport above 60rem, so the account control never falls below the fold
.work   background var(--surface); flex column; min-width 0
```

Reference: `src/components/shell/split-shell.tsx` and `shell.module.css`. Every screen goes
through it — onboarding, the room, the report, the console — so the product is learned once.

Rail width is a **variant class**, never an inline style: the CSP is `style-src 'self' 'nonce-…'`,
so a style attribute is dropped in production and the rail would collapse to zero there.
`narrow` 212px · `default` 240px · `wide` 340px.

`contain` is opt-in and the room is the only caller: it bounds `.work` to the viewport so the
room keeps its own internal scroll regions instead of growing the page past a sticky rail.

> **Retired:** the entry panel on `--gradient-entry` with `--shadow-soft`, and the closed list of
> routes that got it. There are no gradient surfaces.

### 3.2 Form field stack

```
.form    display flex; flex-direction column; gap 16px
.field   display flex; flex-direction column; gap 4px
.label   13px / 500 / var(--text)            (14px acceptable on airy surfaces)
.input   16px; padding 12px; border 1px var(--border); border-radius var(--radius-input);
         background var(--surface)
:focus-visible  outline 2px solid var(--accent); outline-offset 2px
[aria-invalid]  border-color var(--danger)
.fieldError     13px var(--danger), directly under the field, id-linked by aria-describedby
```

Reference: `src/components/auth/auth.module.css`. Single column at every width — the form never
becomes a grid, so 390px needs no branch.

### 3.3 Buttons

| Kind | Shape |
|---|---|
| Primary | `--primary` bg, `--surface` label, 600, `--radius-button`, padding 12px 20px (16px 28px hero); `:disabled` → `opacity .5–.6`, cursor `progress` when it means "working" |
| Secondary | `--surface` bg, 1px `--border`, `--text` label, 500, `--radius-button`; hover → `--surface-sunken` |
| Tertiary / text | no bg, no border, 14px, `--text-muted` (or `--primary` when it is a real action link) |
| Badge / pill | 13px, `--radius-button`, padding 4px 8px |

Minimum hit target 44×44 including padding. `transition: opacity var(--duration-default) var(--easing-default)` — never a transform bounce.

### 3.4 Content surfaces

```
.card   background var(--surface); border 1px var(--border);
        border-radius var(--radius-card); box-shadow var(--shadow-hairline); padding 12–20px
```

Reference: `src/components/room/room.module.css`, `src/components/report/report.module.css`.
Prose blocks (narratives, recovery copy, empty-state explanations) cap at **65–75ch** regardless
of container width.

> **Retired:** the `.page` wrapper — `min-height 100dvh; background var(--bg); max-width 880px;
> margin 0 auto` — as the ground for room, report, dashboard and admin. Those screens are built on
> `SplitShell` (§3.1); the ground is the shell's, and 880px is now one column measure among several
> rather than *the* pattern. What replaced it is the cap below, which holds for every screen at
> once instead of being restated per surface.

**Every container is capped at `--container-max` (1440px) and centred.** `shell.module.css`
does it once, for every screen, on `.workTop` and `.workBody`:

```
padding-inline: max(24px, calc((100% - var(--container-max)) / 2));
```

Padding rather than `max-width` + `margin-inline: auto`, so `.workTop`'s bottom rule still runs
edge to edge while its title lines up with the body underneath it.

A page column narrower than the cap — 880px of settings, 76ch of report — **must** carry
`margin-inline: auto` (and `width: 100%`) of its own. `max-width` alone centres nothing: it
pins the column to the inline-start edge and leaves the rest of the monitor empty to the right,
which is what this rule exists to stop. A narrower measure is still correct; an off-centre one
is not.

### 3.5 Chrome

**Inside the product there is no header.** The rail carries the wordmark, the navigation and the
account control (`components/shell/app-rail.tsx`); a screen that adds a header of its own is
duplicating the rail.

`SiteHeader` / `SiteFooter` (`components/chrome/`) survive on the **public** surfaces only — the
landing page and the legal pages, which are signed-out and have no rail to carry them. Header:
wordmark in `--font-heading` 20/600, actions right, no shadow, no border unless the page scrolls
under it. Footer: 14px `--text-muted`, centred, links `--primary` 600.

### 3.6 Do / don't

| Do | Don't |
|---|---|
| One `--primary` element per surface | Two orange buttons competing in one viewport |
| `--accent` for a chart series or a section key | `--accent` on a button that submits something |
| `outline: 2px solid var(--accent); outline-offset: 2px` for focus | A `--primary` ring, or removing the outline because the border already changed |
| `--surface-sunken` for a meter track or status chip | A new grey invented at the call site |
| `box-shadow: var(--shadow-hairline)` in the room | A second shadow layer to fake elevation |
| `gap` on a flex/grid parent | Margins stacked on children to fake a gap |
| `font-size: 14px` | `font-size: 0.9375rem` (15px — off scale, invisible to the lint) |
| `--rail-text-muted` on the rail | `--text-muted` on the rail (fails AA — see §2 rule 5) |
| The shell's ground, unmodified | A gradient, a wash, or a per-route page background |
| Empty state as a designed block inside the card | A bare `<p>No data</p>` at the top-left of a blank page |
| `min-width: 0` + `overflow-x: auto` on a wide table | A page body that scrolls sideways at 390px |

---

## 4. Voice and copy

**Canonical, and untouched by the redesign.** Direction B changed the visual system, not the
product's voice; the redesign-era strings follow these rules and were written to them. #112 was
adjudicated against the filler rule, the *sen* rule and the one-term rule below, and that
adjudication stands. Unlike §5, a string that disagrees with this section **is** a defect report.

Copy lives in `frontend/messages/{en,tr}.json`. Both files ship every key, always, in the same
commit. No English fallback rendered to a Turkish user.

Rules:

- **Sentence case everywhere.** Buttons, headings, labels, table headers. No Title Case, no CAPS
  (the `LIVE` badge is a proper noun of the product, and is the one exception).
- **Verbs name the action, and the confirmation names the result.** `Create account` → `Account
  created`. `Send reset link` → `Sent. Check your inbox.` Never `Submit`, never `OK`, never `Done!`.
- **Errors state the problem and the recovery, in that order, in one or two sentences.** No error
  code shown to the user, no "Oops", no "Something went wrong" when we know what went wrong.
- **No filler.** Cut "please", "simply", "just", "in order to", exclamation marks, and any sentence
  that only reassures. Cut the second sentence if the first one did the job.
- **Numbers are numbers.** "Resend in 30s", not "Please wait a little while".
- **Turkish is a native voice, not a translation.** Turkish carries the same warmth with fewer
  words; do not transliterate English syntax. **TR is informal *sen* everywhere** — marketing,
  instructions, states, errors alike. One register, no *siz* mixing; the product talks to one
  person, not an audience. The single exception is quoted interviewer dialogue — a Turkish
  interviewer says *siz* to a candidate, and that line is the character speaking, not the product.
  The redesign renamed those keys and there are now **six**, not two:
  `landing.demo.roles.{frontend,product,data}.{hr,tech}.question`. (`landing.preview.hrQuestion`
  and `techQuestion`, cited here until 2026-08-11, have not existed since the redesign — anyone
  verifying the exception at that path found nothing.)
- **One term per concept, both languages.** interview → *mülakat* (never *görüşme*), report →
  *rapor*, job listing → *ilan*, round → *tur*, answer → *cevap* (never *yanıt*), HR → *İK*.

| Situation | EN | TR |
|---|---|---|
| Hero | Practise the interview before it counts | Gerçeğinden önce mülakata hazırlan |
| Action → result | Send reset link → Sent. Check your inbox. | Bağlantıyı yeniden gönder → Gönderdik. Gelen kutuna bak. |
| Problem + recovery | That link is no longer valid. Request a new one. | Bu bağlantı artık geçerli değil. Yeni bir bağlantı iste. |

Three tests before a string ships: does it name a thing the user can do; would you say it out loud
to someone sitting next to you; is the Turkish shorter than the English (it usually should be).

---

## 5. Per-surface briefs

> **Pre-redesign. Not canonical — see §0.**
>
> These three briefs were written against the retired gradient/flat system and none has been
> rewritten for Direction B. **Every visual value in them is suspect**: they name a gradient
> ground, `--shadow-soft` on entry, pill radii, the 880px/1120px `.page` measures and mascot
> poses, all of which are gone. Where a brief and a screen disagree, the screen is right.
>
> They are kept because what mostly survived the redesign is the part underneath the values —
> which states are designed, what carries meaning for a screen reader, what is never
> colour-only, what must not move. Read a brief for that, then read the surface's own CSS module
> for what it looks like.

### W09 — Pre-join device check (`/interviews/[id]/pre-join`)

**Mode: entry.** Pre-join **is** in `ENTRY_ROUTES` — gradient ground, `--shadow-soft`, `--radius-panel`.
It is the last calm breath before the room, and it should feel like the setup screen, not the room.

| Element | Spec |
|---|---|
| Ground | `.ground` per §3.1; single centred panel, `max-width 480px`, padding 32px (24px ≤480px) |
| Title | 28px `--font-heading` 600; subtitle 16px `--text-muted`, ≤65ch |
| Device row | label 13/500, `<select>` styled per §3.2 at 16px, full width — never a native unstyled select |
| Level meter | track: height 8px, `--surface-sunken`, 1px `--border`, `--radius-button`. fill: `--accent`, width driven by the analyser, **`transition: none`** (a 200ms ease on a realtime signal reads as lag). Never `--live` (room-only), never `--primary` (reserved for the CTA) |
| Level status | the meter is `aria-hidden`; a sibling 14px `--text-muted` line carries the truth: "We can hear you" / "We're not picking anything up — say something". Level is never colour-or-motion-only |
| Enter CTA | the one `--primary` button, full width, 16/600, disabled until `granted`; disabled = `opacity .5`, `aria-disabled`, and a 13px `--text-muted` line saying why |
| Denied | inline block inside the panel: `--surface-sunken` bed, 1px `--danger`, `--radius-input`, padding 12–16px; 14px problem sentence + numbered recovery steps + a secondary "Try again" button. The Enter CTA stays visible and disabled — do not swap the layout out from under the user |
| Unavailable (no device) | same block, no retry button, and the CTA is gone rather than disabled |
| Mascot | none in the default/granted state (no pose is assigned to pre-join). `shrug` only inside the denied/unavailable block, 96px, above the message — preload that pose only, and only when rendered |
| Loading | skeleton of the panel at its final height (panel + two grey `--surface-sunken` bars), so granting does not jump the layout |
| Motion | one authored moment: the CTA enabling — `opacity`/`background` over `--duration-default`. Nothing else animates |
| 390px | already single column; the panel goes edge-padded at 16px and the CTA stays above the fold |

### W10 — Voice room (`/interviews/[id]/room`, `mode: 'voice'`)

**Mode: room.** Flat `--bg`, `--shadow-hairline` only, no gradient, no mascot, near-zero motion.
Reuse `room.module.css` and W06's tiles/transcript/avatar — voice adds controls, not a second room.

| Element | Spec |
|---|---|
| Shell | `.room` unchanged: 880px, gap 16px, `100dvh`, tiles 1fr/1fr → single column ≤480px |
| Tiles | `.tile` / `.tileLive` unchanged. `--live` appears on **exactly one tile or none**: 2px outline + the `LIVE` badge, always paired with the lit name/role label so it survives colour blindness |
| Question panel | `.question`: `--radius-panel`, `--shadow-hairline`, 20px text (16px ≤480px), min-height 96px so the panel does not resize per question |
| Transcript pane | reuse `Transcript`: `--radius-card` turns, question 14px `--text-muted` above answer 16px `--text`, gap 12px. In voice it is **live** — `aria-live="polite"` on the list, and it scrolls within its own container rather than growing the page. Empty = `transcriptEmpty` line, not a spinner |
| Voice controls | sticky bottom bar on `--bg` (mirrors `.composer`): mic mute toggle, speaker toggle, session status chip. Icon buttons ≥44px, `--radius-button`, `--surface` bg + 1px `--border`; muted state = `--surface-sunken` fill + a text label, never a red icon |
| Mic level | the same meter shape as W09 (`--surface-sunken` track, `--accent` fill), 4px tall inside the control bar. Not `--live` |
| Session status | 13px chip, `--surface-sunken` bed, `--text-muted` label: connecting / live / reconnecting. Text, always — the status is never conveyed by a coloured dot alone |
| Session lost | inline banner above the control bar: `--surface-sunken`, 1px `--danger`, `--radius-input`, 14px; problem + a `--primary` "Reconnect" button. This is the surface's single `--primary` (voice has no submit button) |
| Waiting beat | `currentQuestion: null` → 14px `--text-muted` line in the question panel's place, same min-height |
| Motion | one authored moment: the `--live` ring/badge crossfading between tiles at `--duration-default`. No pulsing ring, no waveform animation, no typing animation in voice. Static under reduced motion |
| Forbidden | mascot, gradient, `--shadow-soft`, `--live` anywhere but the active tile, any second shadow layer |

### W11/W12 — Admin console (`/admin`, `/admin/interviews/:id`)

**Mode: admin, compact (Jotform) density.** Flat `--bg`, `--shadow-hairline`, no gradient, no
mascot, no `--live`. Density tightens: 13/14px type, 8–12px cell padding, hairline row rules.

| Element | Spec |
|---|---|
| Page | `max-width 1120px`, padding 24px 16px 32px, gap 24px between the stats panel and the table |
| Figures row | `averageDurationMs` and `totalTokens` as two `--surface` cards: label 13px `--text-muted`, value 40px `--font-heading` 600, `font-variant-numeric: tabular-nums`. Grid `repeat(auto-fit, minmax(240px, 1fr))` → stacks at 390px |
| Table shell | `--surface`, 1px `--border`, `--radius-card`, `--shadow-hairline`, `overflow: hidden`; the `<table>` sits in an inner `overflow-x: auto` wrapper so the page body never scrolls sideways |
| Header row | 13px/600 `--text-muted`, sentence case, `border-bottom: 1px var(--border)`, sticky, padding 12px 16px. No uppercase, no letter-spacing tricks |
| Data rows | 14px `--text`, padding 12px 16px, `border-bottom: 1px var(--border)` (no zebra fill). Numeric columns right-aligned with `tabular-nums`. The row itself is **not** a click target — it carries ids an operator selects and copies, and a clickable row fights that. The drill-down is one `Open` link in a trailing column whose `<th>` is visually hidden |
| `deleted` flag | 13px pill, `--surface-sunken` bed, `--text-muted` label, `--radius-button`. Not `--danger` — a soft-deleted row is a fact, not an error |
| Load more | secondary button (bordered `--surface`) centred under the table, shown only while `nextCursor` exists. Not the page's `--primary` |
| Primary action | at most one on the whole surface; if none exists, the surface has no orange. Do not promote "Load more" to fill the slot |
| Bars, not charts | a quantity that is one value against one ceiling is a `Meter` (`components/shell/meter.tsx`), never a chart library. A native `<progress>` carries its value as a **DOM property**, which is the only kind of bar that survives the production CSP (`style-src 'self' 'nonce-…'` drops the style attribute a width-in-a-prop bar needs). See ADR-W09 — the dependency is installed and deliberately unimported. The Costs section is the one place a `Meter` cannot say what is being asked; see **Cost charts** below |
| Bar colour | the informational family only: `--accent` (primary series), `--warning` (cut short), `--text-muted` (baseline). **Never `--primary`** — that slot belongs to the surface's one primary action. No hex literals in TSX; the lint scans `.tsx` |
| Legibility | every bar states its number as text beside it; nothing on this surface is readable by colour or length alone. A `Meter` beside its own printed figure passes `decorative`, because announcing "progress bar 41%" next to the 41% it duplicates is noise |
| `weakestQuestions` | a list, not a chart: `--surface` card, question text 14px, score 14/600 right-aligned, hairline rules between rows |
| Empty platform | zeroed charts (axes drawn, series at 0) plus a 14px `--text-muted` line "No interviews yet" inside the table card. Never a spinner, never a blank region |
| Loading | table skeleton: header row plus 5 rows of `--surface-sunken` bars at final row height; chart areas hold their final height |
| `FORBIDDEN` | a centred `--surface` card on flat `--bg`: 20px title, 14px `--text-muted` explanation, one secondary link back to the dashboard. No mascot (admin exclusion), no table shell behind it |
| Sections | eight, in the left rail, all answered by an endpoint (W12). Section is client state, not a route — swapping it must not remount the shell. The one real route is the drill-down, because it is a link target, and a link into client state is not a link (ADR-W10) |
| Filters | **inside the card of the table they filter**, in its `.head` under the heading — never in the page's header strip, and never floating on `--bg` above a card they only appear to reach. A filter that sits over a whole section claims scope it does not have: on Costs it would sit above charts fed by `/admin/costs`, which ignores the filter bag entirely. One container, read top-down: heading, note, controls, rows. The drill-down already did this; the console now matches it. Options come from the data (`perOccupation`, the call facets, the audit action counts), never a hardcoded list that drifts. Every filter narrows on the **server** — a client-side filter over one loaded page silently answers a different question |
| Filter builder | one control per table, and it covers **every** field the table has — the three hand-written dropdowns it replaced covered three of fifteen and had to be extended by hand for each new one. A plain box for words; an `Add filter` row of three selects (field, condition, value) that emits a removable chip. The value control is typed to the field: an enum is a list of exactly what the server accepts, a date is `<input type="date">`, a number is `<input type="number">`. Nothing is typed as syntax, and nothing has to be looked up — **a control whose first job is to explain itself is a control that failed**, which is why the `Syntax` panel that preceded this is gone |
| Chips | each filter reads as a sentence — `State is Completed`, not `state:completed` — with the field, the condition and the value all translated. Removable individually. A jump from another section ("this account's interviews") lands as a chip too, never as an invisible parameter: a filtered list that does not say it is filtered is the failure this whole control exists to avoid |
| Ignored terms | a term the server did not recognise is named back to the operator in `--warning`, never `--danger` and never silently dropped. The page worked; the list is simply wider than it looks |
| Sortable header | the whole `<th>` carries `aria-sort`, and the label is a `<button>`. The direction arrow is one `<svg>` with both polygons always drawn — active in `--text`, inactive in `--border` — so an unsorted column still advertises that it is sortable. Attribute geometry, never a CSS transform: the CSP drops the style attribute that would need. Sized like the row's `Open` link, not 44px — a 44px control in every header doubles the header height of every table |
| Empty after a search | a different fact from an empty table, and never the same line. "Nothing was recorded" told to someone whose query simply matched nothing is a lie about the data |
| Drill-down | same shell, same rail, same not-authorized card. Summary as a `<dl>`, then the report's prompt uuid + version, then the call table, then the event timeline. Money prints the backend's six-decimal string verbatim; a voice call keeps its own per-second row rather than folding into a token count |
| 390px | figures stack; every table scrolls inside its own wrapper; the filter controls drop to one per line |

#### Cost charts (`/admin` → Costs)

A `Meter` answers "how much, against what ceiling". It cannot answer "is this rising", "is the
mix shifting", or "when does the money land", which is what a cost surface is for. These seven
graphics are the exception the rule above points at, and they carry their own rules.

| Element | Spec |
|---|---|
| Still no chart library | hand-rolled SVG, per ADR-ADD04. Every value is a geometry or presentation **attribute** — `points`, `x/y/width/height`, `d`, `r`, `stroke-dasharray`, `stroke-dashoffset`, `transform`, `fill-opacity`. **No `style` attribute anywhere**: the production CSP drops it, which is the whole reason `recharts` stays installed and unimported |
| One panel, one question at a time | seven cards stacked to 4400px, and six of them answered a question nobody had asked yet. They are now **one card**: a `Chart` select picks the question, a `Drawn as` select picks the form, and the range control shares the same strip. The seven questions are daily spend · daily cost per interview · spend by model over time · **compare chosen series** · this range against the last · share of range spend · when the money lands. A graphic that restates what another already said is still deleted, not kept for symmetry — which is why the per-model `Meter` list is gone and why the cost-per-interview view exists at all: it is the only one that separates price from volume |
| The table is never behind the dropdown | `Models in this range` stays permanently below the panel. It is the text counterpart of every drawing above it, so putting it behind a selection would leave a chart with no accessible form whenever another view is chosen |
| `Drawn as` offers only what fits | the type list is per-question, so the control cannot produce a pie of a time series or a line of a part-to-whole. A question with one honest form (this range against the last; when the money lands) hides the control entirely rather than showing a select with one option |
| The type is remembered per question | switching away from a view and back returns the drawing you left it on. Resetting to the default is a second decision the operator did not make |
| One plot shell | gutter, gridlines, ticks, axes and date labels live in `charts/plot.tsx`; a chart *type* is only the marks drawn inside it. Three charts each carrying their own copy of that chrome is how two of them drift apart |
| **Three hues, and only three** | the categorical palette is `--series-1`, `--series-2`, `--series-3` and stops there. `--series-4/5/6` clear AA as text but **fail categorical separation** against the first three (`--series-5`↔`--series-6` sit at ΔE 4.2 for deuteranopia and 14.2 for normal vision, below the 15 floor). `--text-muted` is not available either — it collides with `--series-3` at ΔE 0.3 deutan. Anything past three is separated by a **non-colour channel**, never by a fourth hue |
| Filled marks: three, then Other | on the stacked, share and against-the-last-range charts, every model past the third folds into one **Other** bucket — `--surface-sunken` fill with a `--border` hairline, separating by lightness and outline rather than hue |
| Stroked marks: three, then dashed | on **Compare series**, slots 4–6 reuse the same three hues with a dashed stroke. The dash is doing all the separating for the 1↔4 pair, whose ΔE is zero by construction, so the picker chip **is** the legend: it carries a 16×2 line swatch showing colour *and* stroke pattern beside the name it belongs to. Six is the ceiling; the seventh chip is `disabled` and says why, because a control that silently ignores a click is worse than one that refuses |
| The fold is the client's decision | `/admin/costs` returns **every** model, ranked, with a `truncated` count when its 24-model cap bites. Folding to three-plus-Other happens in `charts/fold.ts` at render time. The endpoint folding it was why two real models were unreachable by any chart, and why the model table used to hide them behind one row |
| Compare is unstacked, and its own view | picking a subset of a **stacked** chart makes its silhouette a lie about total spend, so the subset comparison is a separate view that never stacks. `Spend by model over time` keeps showing everything |
| One measure at a time | Compare switches between spend, calls, tokens and average latency — never two on one chart, because that is a second y-axis. The axis formatter follows the measure; money is the only one that prints as dollars |
| Say "not reported", never imply "free" | under Tokens, a per-second voice model draws a flat zero because it records no token count. A note names those series. A flat line an operator reads as "costs nothing" is the misreading this surface exists to prevent |
| Colour follows the model, not the rank | a model keeps its series slot across the area, the bars, the donut, the table swatch and its sparkline. Changing the range must not repaint a model that survived the change |
| The previous range is never a series | in the grouped bars it is `--surface-sunken` + hairline. It is a reference, not a fourth model, and a hue spent on it is a hue the models no longer have |
| Sparkline scale | **one max shared by every row**, never per-row. A per-row max draws a model that spent $0.001 and one that spent $10 with the same silhouette, which is a lie about the comparison the column exists for |
| Money | the backend's six-decimal string, printed verbatim in every figure card, table cell and caption. Axis ticks may carry fewer decimals — a tick is a scale, not a ledger figure. All client-side arithmetic goes through `microUsd`; a float sum of money drifts |
| Accessibility | every graphic is a `<figure>` whose `<svg>` is `aria-hidden`, with a `<figcaption>` stating the claim in words and numbers. The **model table is the accessible rendering** of the area, bars and donut — same figures as text — so announcing them a fourth time is the noise ADR-ADD04 already refused. The heatmap's caption names its peak bucket and value, because a colour ramp is the one encoding a caption cannot skip |
| Legend | always present for the model series, with the share printed beside each label. Identity is never colour-alone: the swatch sits next to the name it belongs to |
| Heatmap | the dashboard's practice grid, reused — a CSS grid of `data-tier` cells with the `color-mix` ramp off `--accent`, `activityTier` for the steps, `--surface-sunken` + hairline for the empty ground. Hours are UTC and labelled every third column; a row of 24 numbers is not a label |
| Fixed size, own scroller | the `<svg>` carries `width`/`height` in px inside an `overflow-x: auto` wrapper — **not** a scaled `viewBox`. Scaling a `viewBox` scales the 13px type with it, and the page body must never scroll sideways |
| Range | 7 / 30 / 90 days, whitelisted on the server, default 30. One control drives every graphic at once. No all-time option: an unbounded scan is the thing `stats.ts` deliberately refused |
| Empty range | axes and gridlines drawn, series flat on the baseline, and one `--text-muted` line saying nothing was spent. Never a spinner, never a blank region |
| Loading | the panel and the table hold their final height, so the section does not reflow under the operator's cursor when the range lands |

---

## 6. Quality floor — check before you call a screen done

- [ ] **Contrast AA (≥4.5:1)** on every text/background pair used — and the ground matters:
      `--rail`, `--rail-raised` and `--stage` each have their own correct ink, and the default
      text tokens are wrong on all three by construction. `ui-checks/contrast.test.ts` covers the
      token pairs; any new pairing you invent is on you to verify. Note what that check does
      *not* do: it asserts the pairs the design intends, never which token an element actually
      receives after the cascade — the gap #204 is open on.
- [ ] **`:focus-visible` ring on everything interactive** — buttons, links, inputs, selects, icon
      buttons, table controls. **One recipe, app-wide: `outline: 2px solid var(--accent);
      outline-offset: 2px`.** `--accent` is the informational hue and is the only ring that stays
      visible both on a `--primary` orange fill and on `--surface`/`--bg`; a `--primary` ring
      disappears into the primary button it is supposed to mark. This is the one place `--accent`
      touches a CTA and it is not a fill, so §2 rule 2 still holds. Never `outline: none` without a
      replacement ring in the same rule. A component may add to the ring (e.g. FileInput draws it on
      the wrapper via `:focus-within`) but never change its colour, width or offset.
- [ ] **Keyboard reachable, in visual order.** Tab through the whole screen. Nothing focusable is
      hidden; nothing visible is unreachable; no focus trap outside a real modal.
- [ ] **Four states designed, not defaulted**: loading (skeleton at final dimensions, not a
      spinner where content will be), empty (a composed block with a sentence that says what to do
      next), error (problem + recovery, inline where the failure happened), success/idle. A raw
      string dumped at the page's top-left is a defect in every one of these.
- [ ] **No native unstyled controls.** Every `input`, `select`, `textarea`, `button`, `checkbox`
      and `radio` goes through `components/ui` (built in the parallel primitives wave) or the
      §3.2/§3.3 patterns. A browser-default select in a card is visible from across the room.
- [ ] **No literal values outside `styles/tokens.css`** — no hex, no raw `box-shadow`, no
      off-scale `font-size`, no spacing that is not a multiple of 4. Author px so the lint sees it.
- [ ] **390px composes**: single column, no horizontal page scroll, wide content scrolls inside its
      own `overflow-x: auto` container, tap targets ≥44px, inputs ≥16px, primary CTA above the fold.
- [ ] **One authored motion moment** per surface, 150–250ms `ease-out` via the tokens, and it is
      gone under `prefers-reduced-motion`. Content animations resolve instantly, not faster.
- [ ] **Every image has developer-authored `alt`**; decorative meters/dots are `aria-hidden` with a
      text sibling carrying the meaning.
- [ ] **Both locales ship**, every key, same commit; nothing renders an untranslated key or an
      English fallback in Turkish.
- [ ] **Surface rules honoured**: the screen is on `SplitShell` and adds no ground of its own;
      rail text uses the `--rail-text*` ramp; one `--primary` per surface; `--accent` never a CTA
      fill; `--live` only while a session is live.
