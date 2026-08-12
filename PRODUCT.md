# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Job candidates preparing for a specific interview they have already been invited to, or are
about to apply for. They arrive holding one thing: the job listing. They practise alone, usually
in the evening, usually the night or two before the real round, and usually nervous about a
particular kind of question rather than about interviews in general.

Turkish and English speakers at full parity. Turkish is a native voice throughout — informal
*sen* to the candidate — not a translation layer over an English product.

A second, much smaller audience: operators using `/admin` to watch cost, quota and failure rates.

## Product Purpose

Practise the interview before it counts, and leave with a written account of how it went.

A candidate pastes the job listing. The role is classified from it and the questions are written
from it. Two interviewers take a round each — **Ada**, HR, then **Turing**, technical. The
candidate answers by voice or by typing. Every answer is scored with a written reason, and a
report lands at the end.

Success is a candidate who knows *which* answer was weak and *why*, not one who has been told
they did well.

## Positioning

The mechanism a neighbouring product cannot truthfully copy: **the questions come from the
candidate's own listing, and two different interviewers want different things from the same
person.** Ada is listening for whether the story is yours — a decision, a consequence, a name.
Turing is listening for method — measure before you change, ordered fixes, the step you would
actually take on Monday morning. The same answer scores differently in the two rounds, and the
report says so per question.

Not a question bank. Not a chatbot with an interview prompt. A conducted session with server-held
state, an adaptive next-question choice, and a scored, exportable record.

## Operating Context

- The candidate's real scene: a laptop, a browser tab, headphones, a job listing in the
  clipboard, and a deadline measured in days.
- Entry is `/` → account → onboarding (profile + CV) → paste listing → pre-join device check →
  the room → the report.
- The room is a real meeting room, audio-first: mic, captions, leave. The candidate's own camera
  is optional, off by default, never recorded and never uploaded.
- Interviews pause and resume; the server owns round, question index and active persona. The
  client never derives them.
- Reports are downloadable as PDF; the file is named for the practice, not the row id.

## Capabilities and Constraints

**Shipped:** listing validation and role classification · question generation per round ·
two personas with three expressions each · voice answers (speech-to-text) and typed answers ·
ElevenLabs voice *generation* only (no agent, no webhooks) · per-answer scoring with written
reasons · STAR adherence on HR answers only · overall and per-round scores · strengths and gaps ·
full transcript · PDF export · pause/resume · mid-interview language switching · EN/TR parity ·
email/password and Google sign-in, email verification, password reset · admin console with cost,
quota, security and failure aggregation · rate limits and per-account budget enforcement.

**Constraints that bind future work:**

- An interview runs six, eight or ten questions across both rounds.
- Deletion is soft everywhere; every foreign key is `ON DELETE RESTRICT`.
- CSP is `default-src 'self'` with `style-src 'self' 'nonce-…'`. No external origin for fonts,
  images, scripts or styles. No inline `style` attribute survives production.
- No Tailwind and no UI library, by specification. CSS Modules reading design tokens.
- Both locales ship every key in the same commit. No English fallback is ever shown to a Turkish
  reader.
- `answers.scores` (the four-axis breakdown) is `null` on every interview taken before ADR-ADD16.
  `report_questions` is the per-question grade that exists for all of them.
- `ended_reason='cut_short'` is never written, so the admin's cut-short figure is always zero.

**Undecided / not claimed:** pricing. The product is free while in preview and no paid tier,
plan or price has been decided.

## Brand Commitments

- **Name:** Interviewly. **Personas:** Ada (HR) and Turing (technical) — named, never
  "the AI" or "the assistant".
- **Voice:** plain, specific, never congratulatory. The product says what happened and what to
  do about it. It does not celebrate an ordinary click, and it does not thank a candidate for an
  answer it could not read.
- **Turkish is a native voice**, informal *sen* — except quoted interviewer dialogue, where a
  Turkish interviewer says *siz* to a candidate.
- **`--live` green is in-session only.** Never a success state, never a CTA, never on the
  landing page.
- **One `--primary` element per surface.**
- Design authority is `frontend/DESIGN.md`, enforced mechanically by
  `frontend/src/ui-checks/{tokens,contrast,grounds,assets}.test.ts`.

## Evidence on Hand

- **Real:** the running product itself — the room, the report, the admin console, the PDF.
- **Real artwork:** three photographic expressions per persona, seeded at
  `personas/{personaId}/expr-{n}-{sha}.png` and served through the edge at `/assets/…`.
- **Authored demonstration content**, already written and labelled as samples in
  `frontend/src/components/home/demo-content.ts`: three roles (frontend engineer, product
  manager, data analyst), each with an HR and a technical question, three candidate answers per
  question, and a written mark for each. This is the strongest asset the marketing surface has.
- **Absent, and must not be fabricated:** customers, logos, testimonials, user counts,
  benchmarks, funding, awards, prices, accuracy claims, hiring outcomes, and any statement that
  practising here improves a real interview result.

## Product Principles

1. **Show the mechanism, do not describe it.** Anyone can claim they score answers. Marking a
   visitor's answer in front of them is the only version that is believable.
2. **The criticism is the product.** A score without a written reason is a number, and the
   reason is the thing a candidate can act on.
3. **The server owns the truth of a session.** The client renders state; it never derives it.
4. **Two locales, one product.** A Turkish candidate is never a second-class path.
5. **Never claim an outcome.** The product can prove what it does inside a session. It cannot
   promise anything about the interview that counts.

## Accessibility & Inclusion

- WCAG AA is a mechanical floor, not an aspiration: every token pair is pinned by
  `ui-checks/contrast.test.ts` and the tightest shipped pair is 4.68:1.
- **State is never carried by colour, width or motion alone.** Every meter is decorative with a
  text sibling stating the number.
- `prefers-reduced-motion: reduce` resolves every authored animation instantly, including the
  landing page's typing effect — the information is the question, and withholding it is not
  something the product does.
- Keyboard completeness is expected on every interactive surface; native disclosure, progress and
  form elements are preferred over authored substitutes.
- Inputs are never below 16px, because iOS zooms.
